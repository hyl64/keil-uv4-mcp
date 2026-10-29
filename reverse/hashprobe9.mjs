import fs from "node:fs";
const main=fs.readFileSync("reverse/samples/Minimal/main.c");
const startup=fs.readFileSync("reverse/samples/Minimal/startup.s");
const stdint=fs.readFileSync("C:/Users/ERDAN.DESKTOP-MVAKHCO/AppData/Local/Keil_v5/ARM/ARMCC/include/stdint.h");
const T={main:0x6AE203ED>>>0,startup:0x6AE205A5>>>0,stdint:0x6939538B>>>0};
const hx=h=>(h>>>0).toString(16).toUpperCase().padStart(8,"0");
function crcs(buf,table,init,xor){let c=init>>>0;for(const b of buf)c=(c>>>8)^table[(c^b)&0xff];return (c^xor)>>>0;}
function tblLE(poly){const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=c&1?((poly>>>0)^(c>>>1))>>>0:(c>>>1)>>>0;t[i]=c;}return t;}
const polys=[0xEDB88320,0x82F63B78,0xEB31D82E,0xD5828281,0x82608EDB,0x992C1A4C,0xA833982B,0x04C11DB7,0x1EDC6F41,0x814141AB,0xF4ACFB13,0xC96C5795,0x8F6E37A0,0x5D6DCB];
const bufs={"main":main,"startup":startup,"stdint":stdint,"main+crlf":Buffer.from(main.toString("latin1").replace(/\r?\n/g,"\r\n"),"latin1")};
for(const [name,buf] of Object.entries(bufs)){
 const hits=[];
 for(const poly of polys){const t=tblLE(poly);for(const init of [0,0xffffffff])for(const xo of [0,0xffffffff]){const h=crcs(buf,t,init,xo);if(h===T.main||h===T.startup||h===T.stdint)hits.push([name,poly.toString(16),init.toString(16),xo.toString(16),hx(h)]);}}
 console.log(name,"crc hits",hits);
}
