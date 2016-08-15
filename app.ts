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

interface ISubjectRecordDb extends ISubjectRecord {
    usn: string;
    percentage: number;
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
        .map(s => s.charAt(0).toUpperCase() + s.substring(1).toLowerCase())
        .join(' ')
    );
}

function flatten2dArray <T> (arr: T[][]) : T[] {
    let newArr: T[] = [];
    for (let elem of arr)
        newArr = newArr.concat(elem);
    return newArr;
}

function saveToDb (pgClient: pg.Client ,name: string, usn: string, records: ISubjectRecord[]): Promise<void> {
    const STMNT_HEADER = `INSERT INTO results (usn, attempt, sem, subject_code, marks_external, marks_internal, percentage) VALUES`;
    const values = records.map<string>(rec => 
        `('${usn}',${rec.attempt},${rec.sem},'${rec.subjectCode}',${rec.externalMarks},${rec.internalMarks},${(rec.internalMarks + rec.externalMarks) / 125 * 100})`
    ).join(',');
    return (
        (pgClient.query(`INSERT INTO students VALUES ('${usn}', '${name}');`))
        .then(r => {pgClient.query(`${STMNT_HEADER} ${values};`)})
        .catch(e => {
            throw new Error('Could not save to database');
        })
    );
}

function checkUsnExistsInDb (usn: string, dbClient: pg.Client): Promise<boolean> {
    const query = `SELECT * FROM students WHERE usn='${usn}';`;
    return dbClient.query(query)
    .then(res => res.rows.length > 0 ? true : false)
    .catch(e => false);
}

function fetchResultsFromDb (usn: string, dbClient: pg.Client): Promise<ISubjectRecord[]> {
    const query = `SELECT subject_code, marks_external, marks_internal, sem, attempt FROM results WHERE usn='${usn}';`;
    return dbClient.query(query)
    .then(res => {
        if (res.rows.length > 0) {
            return res.rows.map(result => {
                return {
                    subjectCode: result.subject_code,
                    internalMarks: result.marks_internal,
                    externalMarks: result.marks_external,
                    sem: result.sem,
                    attempt: result.attempt
                };
            });
        } else {
            return null;
        } 
    })
    .catch(e => {
        console.log(e);
        throw e;
    });
}

let app = express();

// debugger;

app.set('json spaces', 4);

app.get('/result/:usn', function(req, res){

    res.header("Access-Control-Allow-Origin", "*");
    
    const usn = req.params.usn.toUpperCase();
    let url = `http://www.fastvturesults.com/check_new_results/${usn}`;

    console.log(`Received request for USN ${usn.toUpperCase()}`);

    checkUsnExistsInDb(usn, dbClient)
    .then(exists => {
        if (exists) {
            console.log(`Found ${usn} in database`);
            fetchResultsFromDb(usn, dbClient)
            .then(records => res.json(records))
            .catch(e => {
                console.log(`could not fetch results from database: ${e}`)
                res.send("Somthing went wrong");
            });
            return;
        }
        console.log(`${usn} not found in database.`);
        return new Promise<string>((resolve, reject) => 
            request(url, (e, r, html) => e ? reject(e) : resolve(html))
        )
        .then(html => {

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
            console.log(studentName);
            let $trList = 
                $('table tr')
                .not('tr:first-child')  // leave out header
                .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
            let arr: IterableShim<Promise<ISubjectRecord[]>>;
            arr = $trList.map((i, e) => extract($(e))).get() as any;
            return Promise.all(arr).then(records2dArray => {
                const dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                const uniqRecords = removeDuplicates(dupRecords);
                res.json(uniqRecords);
                return saveToDb(dbClient, studentName, usn, uniqRecords);
            })
            .then(() => console.log('saved to db'))
            .catch(e => console.log('could not save to db bro'));
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
})

app.get("/", (req, res) => res.send("hey"));

const user = 'postgres';
const password = 'openplz13';
const host = 'localhost';
const dbName = 'vturesults';
const dbClient = new pg.Client(`postgres://${user}:${password}@${host}/${dbName}`);

new Promise((resolve, reject) =>
    dbClient.connect((e, c) => e ? reject(e) : resolve(c))
)
.then((client: pg.Client) => {
    console.log("connected to postgres database successfully");
})
.catch((e) => {
    console.log(`ERROR:`, e);
});

app.listen('8081')
console.log('Magic happens on port 8081');

debugger;

export default app;