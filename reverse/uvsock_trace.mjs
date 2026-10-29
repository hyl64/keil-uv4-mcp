import net from 'node:net';
const log = [];
const s = net.createConnection({ host: '127.0.0.1', port: 4328 });
let acc = Buffer.alloc(0);
const t0 = Date.now();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
s.on('data', (d) => {
  acc = Buffer.concat([acc, d]);
  while (acc.length >= 32) {
    const total = acc.readUInt32LE(0);
    if (total < 32 || total > acc.length) break;
    const f = acc.subarray(0, total); acc = acc.subarray(total);
    const id = f.readUInt32LE(4), dl = f.readUInt32LE(8);
    const p = f.subarray(32);
    const p0 = p.length >= 4 ? p.readUInt32LE(0) : null;
    const txt = p.length > 12 ? p.subarray(8).toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 90) : p.toString('hex');
    log.push(`+${Date.now() - t0}ms frame=0x${id.toString(16)} inner=0x${p0 === null ? '' : p0.toString(16)} dl=${dl} ${txt}`);
  }
});
function frame(id, payload = Buffer.alloc(0)) {
  const h = Buffer.alloc(32);
  h.writeUInt32LE(32 + payload.length, 0); h.writeUInt32LE(id, 4); h.writeUInt32LE(payload.length, 8);
  return Buffer.concat([h, payload]);
}
s.on('connect', async () => {
  s.write(frame(0x1)); await sleep(500);
  s.write(frame(0x1006)); await sleep(13000);   // Build
  s.write(frame(0x1007)); await sleep(18000);   // Rebuild (full pipeline w/ output lines)
  console.log(log.join('\n'));
  process.exit(0);
});
setTimeout(() => { console.log('TIMEOUT\n' + log.join('\n')); process.exit(0); }, 45000);
