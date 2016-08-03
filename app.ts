import express = require('express');
import fs = require('fs');
import request = require('request');
import cheerio = require('cheerio');

interface ISemResult {
    sem: number;
    attempt: number;
    marks: number;
    percentage: number;
}

interface IExtractResult extends ISemResult {
    sem: number;
}

type SemResultDict = {[sem: number]: ISemResult};

let app = express();

app.set('json spaces', 4);

app.get('/result/:usn', function(req, res){
    
    let url = `http://www.fastvturesults.com/check_new_results/${req.params.usn}`;

    console.log(`Received request for USN ${req.params.usn}`);

    request(url, function(error, response, html){
        if(!error) {
            var $ = cheerio.load(html);
            var resDict: SemResultDict = {};
            var foo = $('table tr').not('tr:first-child').each(function () { // leave out header
                var $tr = $(this);
                if ($tr.children('td').length < 5) // leave out the spacer rows.
                    return;
                var result = extract($tr);
                // console.log(json);
                if (result.attempt === 1) {
                    resDict[result.sem] = {
                        sem: result.sem,
                        attempt: result.attempt,
                        marks: result.marks,
                        percentage: result.percentage
                    };
                }
            });
            res.json(resDict);
        } 
    });
})

app.get("/", (req, res) => res.send("hey"));

app.listen('8081')
console.log('Magic happens on port 8081');
exports = module.exports = app;

function extract ($elem: cheerio.Cheerio): IExtractResult {
    var $td_list = $elem.children('td');
    var sem = parseInt($td_list.eq(0).html().trim());
    var attempt = parseInt($td_list.eq(1).html().trim());
    var marks = parseInt($td_list.eq(2).html().trim());
    var percentage = parseFloat($td_list.eq(4).html().trim());

    var json = {
        sem: sem,
        attempt: attempt,
        marks: marks,
        percentage: percentage
    }

    return json;
}