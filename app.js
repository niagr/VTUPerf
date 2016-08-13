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
var app = express();
app.set('json spaces', 4);
app.get('/result/:usn', function (req, res) {
    var url = "http://www.fastvturesults.com/check_new_results/" + req.params.usn;
    console.log("Received request for USN " + req.params.usn.toUpperCase());
    request(url, function (error, response, html) {
        if (!error) {
            var $ = cheerio.load(html);
            var studentName = toTitleCase($('head title').html().split('(')[0]);
            console.log(studentName);
            var $trList = $('table tr')
                .not('tr:first-child') // leave out header
                .filter(function (i, tr) { return $(tr).children('td').length >= 5; }); // leave out the spacer rows.
            var arr = void 0;
            arr = $trList.map(function (i, e) { return extract($(e)); }).get();
            Promise.all(arr).then(function (records2dArray) {
                console.log("ahoyy!");
                var dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                var uniqRecords = removeDuplicates(dupRecords);
                console.log(dupRecords.length);
                console.log(uniqRecords.length);
                res.json(uniqRecords);
            });
        }
    });
});
app.get("/", function (req, res) { return res.send("hey"); });
var user = 'postgres';
var password = 'openplz13';
var host = 'localhost';
var dbName = 'vturesults';
var dbClient = new pg.Client("postgres://" + user + ":" + password + "@" + host + "/" + dbName);
new Promise(function (resolve, reject) {
    return dbClient.connect(function (e, c) { return e ? reject(e) : resolve(c); });
}).then(function (client) {
    console.log("connected successfully");
    return client.query('SELECT * FROM students;');
})
    .then(function (res) { return console.log(res.rows); })
    .catch(function (e) {
    console.log("ERROR:", e);
});
app.listen('8081');
console.log('Magic happens on port 8081');
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = app;
