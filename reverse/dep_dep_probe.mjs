import fs from "node:fs";
import { spawn } from "node:child_process";
const armcc = "C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/bin/armcc.exe";
const cwd = "reverse/samples/Minimal";
const args = ["--depend", "../dv3.d", "-o", "../dv3.o", "--cpu", "Cortex-M3", "main.c"];
const c = spawn(armcc, args, { cwd });
let out="", err="";
c.stdout.on("data", d=>out+=d); c.stderr.on("data", d=>err+=d);
c.on("close", (code) => {
  console.log("exit", code, "stdout", JSON.stringify(out), "stderr", JSON.stringify(err));
  for (const f of ["../dv3.d"]) { try { const s=fs.readFileSync(f,"latin1"); const hex=[...Buffer.from(s,"latin1")].map(b=>b.toString(16).padStart(2,"0")).join(" "); console.log(f, JSON.stringify(s), hex); } catch(e){ console.log(f,"missing"); } }
});
