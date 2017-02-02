import fs = require("fs");

const filepath = process.argv[2];

const res = fs.readFileSync(filepath)
.toString()
.split("\n")
.map((a, i) => i % 2 == 0 ? a : null)
.filter(a => a != null)
.map(a => a!.split("\t").slice(0, 2).join(","))
.join("\n")
