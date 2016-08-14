"use strict";
var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
var pg = require('pg');
function extract($elem) {
    return new Promise(function (resolve, reject) {
        var $td_list = $elem.children('td');
        var sem = parseInt($td_list.eq(0).html().trim());
        var attempt = parseInt($td_list.eq(1).html().trim());
        var marks = parseInt($td_list.eq(2).html().trim());
        var percentage = parseFloat($td_list.eq(4).html().trim());
        var subjectListLink = $td_list.eq(7).children('a').attr('href');
        request(subjectListLink, null, function (error, response, html) {
            if (error) {
                reject(error);
                return;
            }
            var subjectResults = extractSubjectResults(html);
            var subjectRecords = subjectResults.map(function (result) {
                return {
                    subjectCode: result.subjectCode,
                    internalMarks: result.internalMarks,
                    externalMarks: result.externalMarks,
                    sem: sem,
                    attempt: attempt,
                };
            });
            resolve(subjectRecords);
        });
    });
}
function extractSubjectResults(html) {
    var $ = cheerio.load(html);
    var subjectResults = $('table tr')
        .not('tr:first-child') // leave out header
        .filter(function (i, tr) { return $(tr).children('td').length >= 5; }) // leave out the spacer rows.
        .map(function (i, tr) { return getMarksFromSubjectRow($(tr)); }).get();
    return subjectResults;
}
function getMarksFromSubjectRow($tr) {
    var $td_list = $tr.children('td');
    var subjectCode = $td_list.eq(1).html().slice(1).trim();
    var internalMarks = parseInt($td_list.eq(2).html());
    var externalMarks = parseInt($td_list.eq(3).html());
    return {
        internalMarks: internalMarks,
        externalMarks: externalMarks,
        subjectCode: subjectCode
    };
}
function removeDuplicates(records) {
    var recordMap = new Map();
    for (var _i = 0, records_1 = records; _i < records_1.length; _i++) {
        var rec = records_1[_i];
        var subjectCode = rec.subjectCode, sem = rec.sem, attempt = rec.attempt;
        var id = subjectCode + "#" + sem + "#" + attempt;
        if (recordMap.has(id))
            continue;
        else
            recordMap.set(id, rec);
    }
    return Array.from(recordMap.values());
}
function toTitleCase(str) {
    return (str.split(' ')
        .map(function (s) { return s.charAt(0).toUpperCase() + s.substring(1).toLowerCase(); })
        .join(' '));
}
function flatten2dArray(arr) {
    var newArr = [];
    for (var _i = 0, arr_1 = arr; _i < arr_1.length; _i++) {
        var elem = arr_1[_i];
        newArr = newArr.concat(elem);
    }
    return newArr;
}
function saveToDb(pgClient, name, usn, records) {
    var STMNT_HEADER = "INSERT INTO results (usn, attempt, sem, subject_code, marks_external, marks_internal, percentage) VALUES";
    var values = records.map(function (rec) {
        return ("('" + usn + "'," + rec.attempt + "," + rec.sem + ",'" + rec.subjectCode + "'," + rec.externalMarks + "," + rec.internalMarks + "," + (rec.internalMarks + rec.externalMarks) / 125 * 100 + ")");
    }).join(',');
    return ((pgClient.query("INSERT INTO students VALUES ('" + usn + "', '" + name + "');"))
        .then(function (r) { pgClient.query(STMNT_HEADER + " " + values + ";"); })
        .catch(function (e) {
        throw new Error('Could not save to database');
    }));
}
function checkUsnExistsInDb(usn, dbClient) {
    var query = "SELECT * FROM students WHERE usn='" + usn + "';";
    return dbClient.query(query)
        .then(function (res) { return res.rows.length > 0 ? true : false; })
        .catch(function (e) { return false; });
}
function fetchResultsFromDb(usn, dbClient) {
    var query = "SELECT subject_code, marks_external, marks_internal, sem, attempt FROM results WHERE usn='" + usn + "';";
    return dbClient.query(query)
        .then(function (res) {
        if (res.rows.length > 0) {
            return res.rows.map(function (result) {
                return {
                    subjectCode: result.subject_code,
                    internalMarks: result.marks_internal,
                    externalMarks: result.marks_external,
                    sem: result.sem,
                    attempt: result.attempt
                };
            });
        }
        else {
            return null;
        }
    })
        .catch(function (e) {
        console.log(e);
        throw e;
    });
}
var app = express();
// debugger;
app.set('json spaces', 4);
app.get('/result/:usn', function (req, res) {
    var usn = req.params.usn.toUpperCase();
    var url = "http://www.fastvturesults.com/check_new_results/" + usn;
    console.log("Received request for USN " + usn.toUpperCase());
    checkUsnExistsInDb(usn, dbClient)
        .then(function (exists) {
        if (exists) {
            console.log("Found " + usn + " in database");
            fetchResultsFromDb(usn, dbClient)
                .then(function (records) { return res.json(records); })
                .catch(function (e) { return console.log("could not fetch results from database: " + e); });
            return;
        }
        console.log(usn + " not found in database.");
        return new Promise(function (resolve, reject) {
            return request(url, function (e, r, html) { return e ? reject(e) : resolve(html); });
        })
            .then(function (html) {
            if (!html) {
                console.log("html is undefined.");
                return;
            }
            var $ = cheerio.load(html);
            var studentName = toTitleCase($('head title').html().split('(')[0]);
            if (studentName.indexOf('Invalid') >= 0) {
                console.log("Invalid USN");
                res.send("Invalid username");
                return;
            }
            console.log(studentName);
            var $trList = $('table tr')
                .not('tr:first-child') // leave out header
                .filter(function (i, tr) { return $(tr).children('td').length >= 5; }); // leave out the spacer rows.
            var arr;
            arr = $trList.map(function (i, e) { return extract($(e)); }).get();
            return Promise.all(arr).then(function (records2dArray) {
                var dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                var uniqRecords = removeDuplicates(dupRecords);
                res.json(uniqRecords);
                return saveToDb(dbClient, studentName, usn, uniqRecords);
            })
                .then(function () { return console.log('saved to db'); })
                .catch(function (e) { return console.log('could not save to db bro'); });
        });
    });
    // request(url, function(error, response, html){
    //     if(!error) {
    //         var $ = cheerio.load(html);
    //         const studentName = toTitleCase($('head title').html().split('(')[0]);
    //         if (studentName.indexOf('Invalid') >= 0) {
    //             console.log("Invalid USN");
    //             res.send("Invalid username");
    //             return;
    //         }
    //         console.log(studentName);
    //         let $trList = 
    //             $('table tr')
    //             .not('tr:first-child')  // leave out header
    //             .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
    //         let arr: IterableShim<Promise<ISubjectRecord[]>>;
    //         arr = $trList.map((i, e) => extract($(e))).get() as any;
    //         Promise.all(arr).then(records2dArray => {
    //             const dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
    //             const uniqRecords = removeDuplicates(dupRecords);
    //             res.json(uniqRecords);
    //             return saveToDb(dbClient, studentName, usn, uniqRecords);
    //         })
    //         .then(() => console.log('saved to db'))
    //         .catch(e => console.log('could not save to db bro'));
    //     } 
    // });
});
app.get("/", function (req, res) { return res.send("hey"); });
var user = 'postgres';
var password = 'openplz13';
var host = 'localhost';
var dbName = 'vturesults';
var dbClient = new pg.Client("postgres://" + user + ":" + password + "@" + host + "/" + dbName);
new Promise(function (resolve, reject) {
    return dbClient.connect(function (e, c) { return e ? reject(e) : resolve(c); });
})
    .then(function (client) {
    console.log("connected to postgres database successfully");
})
    .catch(function (e) {
    console.log("ERROR:", e);
});
app.listen('8081');
console.log('Magic happens on port 8081');
debugger;
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = app;
