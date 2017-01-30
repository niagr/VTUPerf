import express = require("express");
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

function requestAsync (link: string, options?: request.CoreOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        request(link, options, (err, resp, html) => err ? reject(err) : resolve(html));
    })
}

async function extract ($elem: Cheerio): Promise<ISubjectRecord[]> {

    let $td_list = $elem.children('td');
    var sem = parseInt($td_list.eq(0).html().trim());
    var attempt = parseInt($td_list.eq(1).html().trim());
    var marks = parseInt($td_list.eq(2).html().trim());
    
    let subjectListLink = $td_list.eq(7).children('a').attr('href');

    const html = await requestAsync(subjectListLink);
    let subjectResults = extractSubjectResults(html);
    let subjectRecords: ISubjectRecord[] = subjectResults.map(result => 
        ({
            subjectCode: result.subjectCode,
            internalMarks: result.internalMarks,
            externalMarks: result.externalMarks,
            sem,
            attempt,
        })
    );
    return subjectRecords;

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

function getMarksFromSubjectRow ($tr: Cheerio) : ISubjectResultPartial {
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

async function saveToDb (pgClient: pg.Client ,name: string, usn: string, records: ISubjectRecord[]): Promise<void> {
    const STMNT_HEADER = `INSERT INTO results (usn, attempt, sem, subject_code, marks_external, marks_internal) VALUES`;
    const VALUES = records.map<string>(rec => 
        `('${usn}',${rec.attempt},${rec.sem},'${rec.subjectCode}',${rec.externalMarks},${rec.internalMarks})`
    ).join(',');
    try {
        await pgClient.query(`INSERT INTO students VALUES ('${usn}', '${name}');`);
        await pgClient.query(`${STMNT_HEADER} ${VALUES};`);
    } catch(e) {
        throw new Error(`Could not save to db: ${e}`);
    }
}

async function checkUsnExistsInDb (usn: string, dbClient: pg.Client): Promise<boolean> {
    const query = `SELECT * FROM students WHERE usn='${usn}';`;
    try {
        const res = await dbClient.query(query);
        return res.rows.length > 0 ? true : false;
    } catch (e) {
        return false;
    }
}

async function fetchResultsFromDb (usn: string, dbClient: pg.Client): Promise<ISubjectRecord[] | null> {
    const query = `SELECT subject_code, marks_external, marks_internal, sem, attempt FROM results WHERE usn='${usn}';`;
    
    try {
        const res = await dbClient.query(query);
        if (res.rows.length > 0) {
            return res.rows.map(result => 
                ({
                    subjectCode: result.subject_code,
                    internalMarks: result.marks_internal,
                    externalMarks: result.marks_external,
                    sem: result.sem,
                    attempt: result.attempt
                })
            );
        } else {
            return null;
        } 
    } catch (e) {
        console.log(e);
        throw e;
    }
}

/**
 * Curry dbClient into the handler returned for using as express route handler
 */
function fetchResultsForUsnUsingDb (dbClient: pg.Client): (req, res) => Promise<void> {

    return async (req, res) => {
        res.header("Access-Control-Allow-Origin", "*");
        
        const usn = req.params.usn.toUpperCase();
        let url = `http://www.fastvturesults.com/check_new_results/${usn}`;

        console.log(`Received request for USN ${usn.toUpperCase()}`);

        if (await checkUsnExistsInDb(usn, dbClient)) {
            console.log(`Found ${usn} in database`);
            try {
                res.json(await fetchResultsFromDb(usn, dbClient));
            } catch (e) {
                console.log(`could not fetch results from database: ${e}`);
                res.send("Somthing went wrong");
            }   
        } else {
            console.log(`${usn} not found in database.`);
            const html = await requestAsync(url);
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
            } else if (studentName.indexOf("No Results Found") >= 0) {
                console.log("No results found for USN", usn)
                res.send("No results found")
                return;
            }
            console.log(studentName);
            let $trList = 
                $('table tr')
                .not('tr:first-child')  // leave out header
                .filter((i, tr) => $(tr).children('td').length >= 5) // leave out the spacer rows.
            let uniqRecords: ISubjectRecord[];
            try {
                let arr: Array<Promise<ISubjectRecord[]>>;
                arr = $trList.map((i, e) => extract($(e))).get() as any;
                const records2dArray = await Promise.all(arr);
                const dupRecords = flatten2dArray(records2dArray); // records may still contain duplicates
                uniqRecords = removeDuplicates(dupRecords);
                res.json(uniqRecords);
            } catch (e) {
                console.log('Could not get results:', e);
                return;
            }
            try {
                await saveToDb(dbClient, studentName, usn, uniqRecords);
                console.log('saved to db');
            } catch (e) {
                console.log('could not save to db:', e);
            }
        }
    }

}

async function main () {

    const user = 'postgres';
    const password = 'openplz13';
    const host = 'localhost';
    const dbName = 'vturesults';
    
    const dbClient = new pg.Client(`postgres://${user}:${password}@${host}/${dbName}`);
    try {
        await new Promise((res, rej) => dbClient.connect((e) => e ? rej(e) : res()));
        console.log("connected to postgres database successfully");
    } catch (e) {
        console.log(`Could not connect to db: ${e}`)
    }

    const app = express();

    app.set('json spaces', 4);
    app.get('/result/:usn', fetchResultsForUsnUsingDb(dbClient))
    app.get("/", (req, res) => res.send("hey"));

    app.listen('8081');
    console.log('Magic happens on port 8081');

}

main()

