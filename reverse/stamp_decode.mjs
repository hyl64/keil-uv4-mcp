import fs from "node:fs";
import { parseDep } from "../src/deps.mjs";
a:
for (const [file, project] of [
  ["../reverse/samples/Minimal/Objects/minimal_Flash.dep", "../reverse/samples/Minimal/minimal.uvprojx"],
]) {
  const dep = parseDep(fs.readFileSync(new URL(file, import.meta.url), "latin1"));
  const vals = dep.sources.map(s => [s.path, s.hash, parseInt(s.hash, 16), "/86400", Math.floor(parseInt(s.hash, 16) / 86400), "mday", Math.floor(parseInt(s.hash, 16) / 86400) % 31]);
  console.log(JSON.stringify(vals, null, 1));
  for (const s of dep.sources) {
    const p = new URL(project, import.meta.url).pathname.replace(/^\//, "");
    const st = fs.statSync("C:/Users/ERDAN.DESKTOP-MVAKHCO/Documents/deepseek-harness/default-workspace/keil-uv4-mcp/" + s.path.replace(/\\/g, "/"));
    const v = parseInt(s.hash, 16);
    const secs = Math.floor(st.mtimeMs / 1000);
    console.log(s.path, "stamp", v, "mtime secs", secs, "mtime%86400", secs % 86400, "diff", secs - v, "days", Math.round((secs - v) / 86400), "src", secs % 86400 === (v & 0xffff));
  }
}
