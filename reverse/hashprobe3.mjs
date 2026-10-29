import fs from 'node:fs';
import crypto from 'node:crypto';
const main=fs.readFileSync('reverse/samples/Minimal/main.c');
const sh=fs.readFileSync('C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h');
const hex=(b,i=0)=>Buffer.from(b).readUInt32LE(i).toString(16).toUpperCase().padStart(8,'0');
const be=(b,i=0)=>Buffer.from(b).readUInt32BE(i).toString(16).toUpperCase().padStart(8,'0');
for (const [n,b] of [['main',main],['stdint',sh]]) {
  const md5=crypto.createHash('md5').update(b).digest();
  const sha1=crypto.createHash('sha1').update(b).digest();
  const sha= crypto.createHash('sha256').update(b).digest();
  console.log(n, 'md5le0', hex(md5,0), 'md5be0', be(md5,0), 'md5le12', hex(md5,12), 'sha1le0', hex(sha1,0), 'sha1le16', hex(sha1,16), 'sha256le28', hex(sha,28));
}
console.log('targets main 6AE203ED stdint 6939538B');
