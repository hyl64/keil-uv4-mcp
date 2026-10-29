import crypto from "node:crypto";
const odd=[0x6AE203ED,0x6939538B,0x6AE205A5,0x4B2D,0x69395189];
for (const n of odd) {
  const le=Buffer.alloc(4); le.writeUInt32LE(n>>>0);
  const be=Buffer.alloc(4); be.writeUInt32BE(n>>>0);
  console.log(n.toString(16), "md5le", crypto.createHash("md5").update(le).digest("hex").slice(0,8), "md5be", crypto.createHash("md5").update(be).digest("hex").slice(0,8), "crc", (()=>{let c=~0;for(const b of le){c^=b;for(let k=0;k<8;k++)c=c&1?(0xEDB88320^(c>>>1)):c>>>1;}return ((~c)>>>0).toString(16);})());
}
