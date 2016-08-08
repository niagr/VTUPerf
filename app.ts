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

interface ISubjectResultPartial {
    subjectCode: string;
    internalMarks: number;
    externalMarks: number;
}

interface ISubjectRecord extends ISubjectResultPartial {
    sem: number;
    attempt: number;
}

interface IExtractResult extends ISemResult {
    sem: number;
}

function extract ($elem: cheerio.Cheerio): Promise<ISubjectRecord[]> {

    return new Promise ((resolve, reject) => {

        let $td_list = $elem.children('td');
        var sem = parseInt($td_list.eq(0).html().trim());
        var attempt = parseInt($td_list.eq(1).html().trim());
        var marks = parseInt($td_list.eq(2).html().trim());
        var percentage = parseFloat($td_list.eq(4).html().trim());
        
        let subjectListLink = $td_list.eq(7).children('a').attr('href');
        request(subjectListLink, null, (error, response, html) => {
            if (error) {
                reject(error);
                return;
            }
            let subjectResults = extractSubjectResults(html);
            let subjectRecords: ISubjectRecord[] = subjectResults.map(result => {
                return {
                    subjectCode: result.subjectCode,
                    internalMarks: result.internalMarks,
                    externalMarks: result.externalMarks,
                    sem,
                    attempt,
                }
            });
            resolve(subjectRecords);
        });
    });
}


function extractSubjectResults(html: string): ISubjectResultPartial[] {
    let $ = cheerio.load(html);
    let subjectResults: ISubjectResultPartial[] = 
        $('table tr')
        .not('tr:first-child')  // leave out header
        .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
        .map((i, tr) => getMarksFromSubjectRow($(tr))).get() as any;
    return subjectResults;
}

function getMarksFromSubjectRow ($tr: cheerio.Cheerio) : ISubjectResultPartial {
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

let app = express();

app.set('json spaces', 4);

app.get('/result/:usn', function(req, res){
    
    let url = `http://www.fastvturesults.com/check_new_results/${req.params.usn}`;

    console.log(`Received request for USN ${req.params.usn}`);

    request(url, function(error, response, html){
        if(!error) {
            var $ = cheerio.load(html);
            let $trList = 
                $('table tr')
                .not('tr:first-child')  // leave out header
                .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
            let arr: IterableShim<Promise<ISubjectRecord[]>>;
            arr = $trList.map((i, e) => extract($(e))).get() as any;
            Promise.all(arr).then(records => {
                console.log(records);
                res.json(records);
            });

        } 
    });
})

app.get("/", (req, res) => res.send("hey"));

app.listen('8081')
console.log('Magic happens on port 8081');

export default app;

