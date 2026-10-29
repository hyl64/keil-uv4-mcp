import { parseDep } from "../src/deps.mjs";
import fs from "node:fs";
const d = parseDep(fs.readFileSync("reverse/samples/Minimal/Objects/minimal_Flash.dep", "latin1"));
console.log(d.sources.length, d.includes.length, d.sources.map(s => [s.path, s.hash, s.cmd.slice(0, 50)]));
const mine = parseDep(fs.readFileSync("reverse/samples/Minimal/Objects/regenerated.dep", "latin1"));
console.log("mine", mine.sources.length, mine.sources.map(s => [s.path, s.hash]));
