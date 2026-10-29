import fs from "node:fs";
const p = new URL("../tests/run_tests.mjs", import.meta.url);
let t = fs.readFileSync(p, "utf8");
if (t.includes("gui_layout_read")) { console.log("already added"); process.exit(0); }
const block = `
const guix = await c.callTool('gui_layout_read', { file: 'C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Arm/Packs/Keil/STM32F1xx_DFP/2.4.1/Boards/Keil/MCBSTM32C/Blinky/Blinky.uvguix' });
check('gui_layout_read parses real .uvguix (>=50 windows)', guix.data.ok && guix.data.totals.windows >= 50, guix.data.totals || guix.data);
const dbc = await c.callTool('dbgconf_read', { file: path.join(samples, 'Blinky', 'RTE', 'Device', 'STM32F107VC', 'STM32F101_102_103_105_107.dbgconf') });
check('dbgconf_read parses wizard options (>=20 with bits/help)', dbc.data.ok && dbc.data.optionCount >= 20 && dbc.data.options.some(o => o.bit === 30 && /TIM11/.test(o.name)), dbc.data.optionCount);
const svc2 = await c.callTool('uvsock_service_table', {});
check('uvsock table full map incl 0x1006 + DBG_EVAL_TO_STR 0x2024', svc2.data.services.PRJ_BUILD === 0x1006 && svc2.data.services.DBG_EVAL_TO_STR === 0x2024, Object.keys(svc2.data.services).length);

// ------------------------------------------------------------------ source lint`;
t = t.replace(`
// ------------------------------------------------------------------ source lint`, block);
fs.writeFileSync(p, t);
console.log("added round-5 test block");
