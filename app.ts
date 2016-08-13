import express = require('express');
import fs = require('fs');
import request = require('request');
import cheerio = require('cheerio');
import pg = require('pg');

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


function extractSubjectResults (html: string) : ISubjectResultPartial[] {
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

function removeDuplicates (records: ISubjectRecord[]): ISubjectRecord[] {
    const recordMap = new Map<string,ISubjectRecord>();
    for (let rec of records) {
        let {subjectCode, sem, attempt} = rec;
        const id = `${subjectCode}#${sem}#${attempt}`;
        if (recordMap.has(id)) 
            continue;
        else 
            recordMap.set(id, rec);
    }
    return Array.from(recordMap.values());
}

function toTitleCase (str: string): string {
    return (
        str.split(' ')
        .map((s) => s.charAt(0).toUpperCase() + s.substring(1).toLowerCase())
        .join(' ')
    );
}

function flatten2dArray <T> (arr: T[][]) : T[] {
    let newArr: T[] = [];
    for (let elem of arr)
        newArr = newArr.concat(elem);
    return newArr;
}

let app = express();

app.set('json spaces', 4);

app.get('/result/:usn', function(req, res){
    
    let url = `http://www.fastvturesults.com/check_new_results/${req.params.usn}`;

    console.log(`Received request for USN ${req.params.usn.toUpperCase()}`);

    request(url, function(error, response, html){
        if(!error) {
            var $ = cheerio.load(html);
            const studentName = toTitleCase($('head title').html().split('(')[0]);
            console.log(studentName);
            let $trList = 
                $('table tr')
                .not('tr:first-child')  // leave out header
                .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
            let arr: IterableShim<Promise<ISubjectRecord[]>>;
            arr = $trList.map((i, e) => extract($(e))).get() as any;
            Promise.all(arr).then(records2dArray => {
                console.log("ahoyy!")
                const dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                const uniqRecords = removeDuplicates(dupRecords);
                console.log(dupRecords.length);
                console.log(uniqRecords.length);
                res.json(uniqRecords);
            });

        } 
    });
})

app.get("/", (req, res) => res.send("hey"));

const user = 'postgres';
const password = 'openplz13';
const host = 'localhost';
const dbName = 'vturesults';
const dbClient = new pg.Client(`postgres://${user}:${password}@${host}/${dbName}`);

new Promise((resolve, reject) =>
    dbClient.connect((e, c) => e ? reject(e) : resolve(c))
).then((client: pg.Client) => {
    console.log("connected successfully");
    return client.query('SELECT * FROM students;');
})
.then(res => console.log(res.rows))
.catch((e) => {
    console.log(`ERROR:`, e);
});

app.listen('8081')
console.log('Magic happens on port 8081');

export default app;