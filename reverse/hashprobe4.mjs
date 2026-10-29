import fs from 'node:fs';
const main=fs.readFileSync('reverse/samples/Minimal/main.c');
const sh=fs.readFileSync('C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h');
const mk=fs.statSync('reverse/samples/Minimal/main.c');
const hx=h=>h.toString(16).toUpperCase().padStart(8,'0');
function crc32(buf,table,init,xorout,reflect){ let c=init>>>0; for(const b of buf){ c = (c>>>8) ^ table[(c ^ b)&0xff]; } return (c^xorout)>>>0; }
function mkTable(poly){const t=new Uint32Array(256); for(let i=0;i<256;i++){let c=i; for(let k=0;k<8;k++) c = c&1? poly^((c>>>1)>>>0) : c>>>1; t[i]=c>>>0;} return t;}
function mkTableBE(poly){const t=new Uint32Array(256); for(let i=0;i<256;i++){let c=i<<24; for(let k=0;k<8;k++) c = (c&0x80000000)? ((c<<1)^poly) : (c<<1); t[i]=c>>>0;} return t;}
const polys=[0xEDB88320,0x82F63B78,0xEB31D82E,0xD5828281,0x82608EDB,0x992C1A4C,0xA833982B];
const res=[];
for(const poly of polys){
 for (const init of [0,0xffffffff]) for (const xo of [0,0xffffffff]) {
   const t=mkTable(poly); 
   const r1=crc32(main,t,init,xo), r2=crc32(main, mkTable(poly), init,xo);
   // reflected variant with reversed input bits handled by poly 0xEDB88320; also try MSB-first table
   const tb=mkTableBE(poly); let c=init>>>0; for(const b of main){ c=((c<<8)&0xffffffff) ^ tb[((c>>>24)^b)&0xff]; } const r3=(c^xo)>>>0;
   if ([r1,r3].includes(0x6AE203ED)) res.push({poly:poly.toString(16),init:init.toString(16),xo:xo.toString(16),kind:'main'});
 }
}
console.log('main matches', res);
const t=performance.now();
let x=0; for(let i=0;i<50;i++){ x=0xffffffff; for(const b of main){ x = (x>>>8) ^ mkTable(0xEDB88320)[(x^b)&0xff]; } }
console.log('perf ms', (performance.now()-t)/50);
console.log('mtime main', mk.mtimeMs, 'size', mk.size);
// Try timestamp-based CRC (DOS packed date/time)
const d=new Date(mk.mtimeMs); const dostime=((d.getHours()<<11)|(d.getMinutes()<<5)|(Math.floor(d.getSeconds()/2)))&0xffff; const dosdate=(((d.getFullYear()-1980)<<9)|((d.getMonth()+1)<<5)|d.getDate())&0xffff;
console.log('dos', dostime.toString(16), dosdate.toString(16));
