import { uv4TimeStampHex } from "../src/deps.mjs";
import fs from "node:fs";
const cases = [
  ["reverse/samples/Minimal/main.c", "0x00155213"],
  ["reverse/samples/Minimal/startup.s", "0x00155637"],
];
for (const [f, want] of cases) {
  const st = fs.statSync(f);
  const got = uv4TimeStampHex(st.mtimeMs);
  console.log(f, new Date(st.mtimeMs).toLocaleString(), got, "want", want, got === want ? "OK" : "MISMATCH");
}
