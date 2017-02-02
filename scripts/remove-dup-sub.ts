import fs = require("fs");

const filepath = process.argv[2];

const subjects  = new Set();
const res = 
    fs.readFileSync(filepath)
    .toString()
    .split("\n")
    .map(a => a.split(","))
    .filter((e, i, a) => subjects.has(e[0]) ? false : subjects.add(e[0]) && true)
    .map(a => a.join(","))
    .join("\n")

console.log(res)