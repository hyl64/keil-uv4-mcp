import { buildCompileCommand } from "../src/toolchain.mjs";
import { Project } from "../src/project.mjs";
const pr = new Project("reverse/samples/Minimal/minimal.uvprojx");
const t = pr.target("Flash");
const c = buildCompileCommand({ tool: "armcc", target: t, objPath: ".\\objects\\main.o", depPath: ".\\objects\\main.d", rteDeviceInclude: "C:\\Arm\\Packs\\X\\Device\\Include", uvisionVersion: "543" });
console.log(c);
