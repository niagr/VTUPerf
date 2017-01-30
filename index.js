"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const express = require("express");
const request = require("request");
const cheerio = require("cheerio");
const pg = require("pg");
function requestAsync(link, options) {
    return new Promise((resolve, reject) => {
        request(link, options, (err, resp, html) => err ? reject(err) : resolve(html));
    });
}
function extract($elem) {
    return __awaiter(this, void 0, void 0, function* () {
        let $td_list = $elem.children('td');
        var sem = parseInt($td_list.eq(0).html().trim());
        var attempt = parseInt($td_list.eq(1).html().trim());
        var marks = parseInt($td_list.eq(2).html().trim());
        let subjectListLink = $td_list.eq(7).children('a').attr('href');
        const html = yield requestAsync(subjectListLink);
        let subjectResults = extractSubjectResults(html);
        let subjectRecords = subjectResults.map(result => ({
            subjectCode: result.subjectCode,
            internalMarks: result.internalMarks,
            externalMarks: result.externalMarks,
            sem,
            attempt,
        }));
        return subjectRecords;
    });
}
function extractSubjectResults(html) {
    let $ = cheerio.load(html);
    let subjectResults = $('table tr')
        .not('tr:first-child') // leave out header
        .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
        .map((i, tr) => getMarksFromSubjectRow($(tr))).get();
    return subjectResults;
}
function getMarksFromSubjectRow($tr) {
    let $td_list = $tr.children('td');
    let subjectCode = $td_list.eq(1).html().slice(1).trim();
    let internalMarks = parseInt($td_list.eq(2).html());
    let externalMarks = parseInt($td_list.eq(3).html());
    return {
        internalMarks,
        externalMarks,
        subjectCode
    };
}
function removeDuplicates(records) {
    const recordMap = new Map();
    for (let rec of records) {
        let { subjectCode, sem, attempt } = rec;
        const id = `${subjectCode}#${sem}#${attempt}`;
        if (recordMap.has(id))
            continue;
        else
            recordMap.set(id, rec);
    }
    return Array.from(recordMap.values());
}
function toTitleCase(str) {
    return (str.split(' ')
        .map(s => s.charAt(0).toUpperCase() + s.substring(1).toLowerCase())
        .join(' '));
}
function flatten2dArray(arr) {
    let newArr = [];
    for (let elem of arr)
        newArr = newArr.concat(elem);
    return newArr;
}
function saveToDb(pgClient, name, usn, records) {
    return __awaiter(this, void 0, void 0, function* () {
        const STMNT_HEADER = `INSERT INTO results (usn, attempt, sem, subject_code, marks_external, marks_internal) VALUES`;
        const VALUES = records.map(rec => `('${usn}',${rec.attempt},${rec.sem},'${rec.subjectCode}',${rec.externalMarks},${rec.internalMarks})`).join(',');
        try {
            yield pgClient.query(`INSERT INTO students VALUES ('${usn}', '${name}');`);
            yield pgClient.query(`${STMNT_HEADER} ${VALUES};`);
        }
        catch (e) {
            throw new Error(`Could not save to db: ${e}`);
        }
    });
}
function checkUsnExistsInDb(usn, dbClient) {
    return __awaiter(this, void 0, void 0, function* () {
        const query = `SELECT * FROM students WHERE usn='${usn}';`;
        try {
            const res = yield dbClient.query(query);
            return res.rows.length > 0 ? true : false;
        }
        catch (e) {
            return false;
        }
    });
}
function fetchResultsFromDb(usn, dbClient) {
    return __awaiter(this, void 0, void 0, function* () {
        const query = `SELECT subject_code, marks_external, marks_internal, sem, attempt FROM results WHERE usn='${usn}';`;
        try {
            const res = yield dbClient.query(query);
            if (res.rows.length > 0) {
                return res.rows.map(result => ({
                    subjectCode: result.subject_code,
                    internalMarks: result.marks_internal,
                    externalMarks: result.marks_external,
                    sem: result.sem,
                    attempt: result.attempt
                }));
            }
            else {
                return null;
            }
        }
        catch (e) {
            console.log(e);
            throw e;
        }
    });
}
/**
 * Curry dbClient into the handler returned for using as express route handler
 */
function fetchResultsForUsnUsingDb(dbClient) {
    return (req, res) => __awaiter(this, void 0, void 0, function* () {
        res.header("Access-Control-Allow-Origin", "*");
        const usn = req.params.usn.toUpperCase();
        let url = `http://www.fastvturesults.com/check_new_results/${usn}`;
        console.log(`Received request for USN ${usn.toUpperCase()}`);
        if (yield checkUsnExistsInDb(usn, dbClient)) {
            console.log(`Found ${usn} in database`);
            try {
                res.json(yield fetchResultsFromDb(usn, dbClient));
            }
            catch (e) {
                console.log(`could not fetch results from database: ${e}`);
                res.send("Somthing went wrong");
            }
        }
        else {
            console.log(`${usn} not found in database.`);
            const html = yield requestAsync(url);
            if (!html) {
                console.log(`html is undefined.`);
                return;
            }
            var $ = cheerio.load(html);
            const studentName = toTitleCase($('head title').html().split('(')[0]);
            if (studentName.indexOf('Invalid') >= 0) {
                console.log("Invalid USN");
                res.send("Invalid username");
                return;
            }
            else if (studentName.indexOf("No Results Found") >= 0) {
                console.log("No results found for USN", usn);
                res.send("No results found");
                return;
            }
            console.log(studentName);
            let $trList = $('table tr')
                .not('tr:first-child') // leave out header
                .filter((i, tr) => $(tr).children('td').length >= 5); // leave out the spacer rows.
            let uniqRecords;
            try {
                let arr;
                arr = $trList.map((i, e) => extract($(e))).get();
                const records2dArray = yield Promise.all(arr);
                const dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                uniqRecords = removeDuplicates(dupRecords);
                res.json(uniqRecords);
            }
            catch (e) {
                console.log('Could not get results:', e);
                return;
            }
            try {
                yield saveToDb(dbClient, studentName, usn, uniqRecords);
                console.log('saved to db');
            }
            catch (e) {
                console.log('could not save to db:', e);
            }
        }
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        const user = 'postgres';
        const password = 'openplz13';
        const host = 'localhost';
        const dbName = 'vturesults';
        const dbClient = new pg.Client(`postgres://${user}:${password}@${host}/${dbName}`);
        try {
            yield new Promise((res, rej) => dbClient.connect((e) => e ? rej(e) : res()));
            console.log("connected to postgres database successfully");
        }
        catch (e) {
            console.log(`Could not connect to db: ${e}`);
        }
        const app = express();
        app.set('json spaces', 4);
        app.get('/result/:usn', fetchResultsForUsnUsingDb(dbClient));
        app.get("/", (req, res) => res.send("hey"));
        app.listen('8081');
        console.log('Magic happens on port 8081');
    });
}
main();
