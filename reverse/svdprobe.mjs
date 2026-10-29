import { createServer } from "../src/server.mjs";
const { server } = createServer();
console.log("tools", server.tools.size);
const r = JSON.parse((await server.tools.get("debug_pack_generate").handler({ device: "STM32F103C8", output: "reverse/STM32F103C8.rdi", maxPeripherals: 64 })).content[0].text);
console.log(JSON.stringify(r, null, 1).slice(0, 800));
const m = JSON.parse((await server.tools.get("debug_peripheral_map").handler({ device: "STM32F103C8", peripheral: "GPIOA", maxRegisters: 8 })).content[0].text);
console.log(JSON.stringify(m.peripherals[0].registers.slice(0, 2)));
