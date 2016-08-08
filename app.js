"use strict";
var express = require('express');
var request = require('request');
var cheerio = require('cheerio');
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
var app = express();
app.set('json spaces', 4);
app.get('/result/:usn', function (req, res) {
    var url = "http://www.fastvturesults.com/check_new_results/" + req.params.usn;
    console.log("Received request for USN " + req.params.usn);
    request(url, function (error, response, html) {
        if (!error) {
            var $ = cheerio.load(html);
            var $trList = $('table tr')
                .not('tr:first-child') // leave out header
                .filter(function (i, tr) { return $(tr).children('td').length >= 5; }); // leave out the spacer rows.
            var arr = void 0;
            arr = $trList.map(function (i, e) { return extract($(e)); }).get();
            Promise.all(arr).then(function (records) {
                console.log(records);
                res.json(records);
            });
        }
    });
});
app.get("/", function (req, res) { return res.send("hey"); });
app.listen('8081');
console.log('Magic happens on port 8081');
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = app;
