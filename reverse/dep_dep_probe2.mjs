import fs from "node:fs";
import { spawn } from "node:child_process";
const armcc = "C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/bin/armcc.exe";
const cwd = "reverse/samples/Minimal";
const runs = [
  ["--depend", "dv4.d", "-o", "dv4.o", "main.c"],
  ["--depend", "dv4.d", "--depend_target", "dv4.o", "-o", "dv4.o", "main.c"],
];
for (const extra of runs) {
  await new Promise((res) => {
    const c = spawn(armcc, extra, { cwd });
    let out="", err="";
    c.stdout.on("data", d=>out+=d); c.stderr.on("data", d=>err+=d);
    c.on("close", (code) => {
      console.log(extra.join(" "), "=> exit", code, JSON.stringify(out + err).slice(0,300));
      for (const f of ["dv4.d"]) { try { const s=fs.readFileSync(cwd + "/" + f, "latin1"); const hex=[...Buffer.from(s,"latin1")].map(b=>b.toString(16).padStart(2,"0")).join(" "); console.log(JSON.stringify(s)); console.log(hex); } catch(e){ console.log(f,"missing"); } }
      res();
    });
  });
}
