import fs from "node:fs";
const w = "reverse/samples/Minimal/";
const v = fs.readFileSync(w + "Objects/main.__i", "latin1");
const single = v.replace(/\r\n/g, " ");
// reconstruct .d = for each "obj: dep" pair, the last argument of the matching segment + the includes that follow?
// hypothesis: .d lines are "<obj>: <arg>" for the arg holding ".c"/".s" and for each -I/-IC path
const lines = v.split(/\r\n/);
console.log(JSON.stringify(lines));
const m = /-o (\S+) --depend (\S+) "([^"]+)"/.exec(single.replace(/\s+/g, " ").trim());
console.log("obj", m && m[1], "dep", m && m[2], "src", m && m[3]);
console.log("d content:", JSON.stringify(fs.readFileSync(w + "Objects/main.d", "latin1")));
