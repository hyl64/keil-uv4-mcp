import fs from "node:fs";
import { parseDep } from "../src/deps.mjs";
const dep = parseDep(fs.readFileSync("reverse/samples/Minimal/Objects/minimal_Flash.dep","utf8"));
console.log(JSON.stringify(dep.sources.map(s=>[s.path, s.hash]), null, 1));
const n = fs.statSync("reverse/samples/Minimal/main.c");
console.log("nlink", n.nlink, "ino", n.ino, "size", n.size, "mtime", n.mtimeMs);

