import fs from 'node:fs';
function hashes(buf){
  const out={};
  let h=0x9E3779B1; for(const b of buf) h=(Math.imul(h^b,0x01000193))>>>0; out.mix1=h;
  // boost hash_combine
  let bq=0; for(const c of buf){ bq = (bq ^ (c + 0x9e3779b9 + (bq<<6) + (bq>>>2)))>>>0; } out.boost=bq;
  // Jenkins one-at-a-time with init 0xdeadbeef
  {let j=0xdeadbeef; for(const c of buf){ j=(j+c)>>>0; j=(j+(j<<10))>>>0; j^=j>>>6;} j=(j+(j<<3))>>>0; j^=j>>>11; j=(j+(j<<15))>>>0; out.joaatDead=j>>>0;}
  // Bob Jenkins lookup2
  {let a=0x9e3779b9,b=0x9e3779b9,c=0; const k=buf; let i=0; const n=k.length;
   while(i+12<=n){ a=(a+k[i]+(k[i+1]<<8)+(k[i+2]<<16)+(k[i+3]<<24))>>>0; b=(b+k[i+4]+(k[i+5]<<8)+(k[i+6]<<16)+(k[i+7]<<24))>>>0; c=(c+k[i+8]+(k[i+9]<<8)+(k[i+10]<<16)+(k[i+11]<<24))>>>0;
     const mix=()=>{ a=(a-b-c)^(c>>>13); a=(a-b-c)>>>0; b=(b-c-a)^(a<<8); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>13); c=(c-a-b)>>>0; a=(a-b-c)^(c>>>12); a=(a-b-c)>>>0; b=(b-c-a)^(a<<16); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>5); c=(c-a-b)>>>0; a=(a-b-c)^(c>>>3); a=(a-b-c)>>>0; b=(b-c-a)^(a<<10); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>15); c=(c-a-b)>>>0; };
     mix(); i+=12; }
   c=(c+n)>>>0;
   // tail
   const rem=n-i; const arr=[...k.slice(i)];
   if(rem>0){ a=(a+arr[0])>>>0; if(rem>1) a=(a+(arr[1]<<8))>>>0; if(rem>2) a=(a+(arr[2]<<16))>>>0; if(rem>3) a=(a+(arr[3]<<24))>>>0; }
   if(rem>4){ b=(b+arr[4])>>>0; if(rem>5) b=(b+(arr[5]<<8))>>>0; if(rem>6) b=(b+(arr[6]<<16))>>>0; if(rem>7) b=(b+(arr[7]<<24))>>>0; }
   if(rem>8){ c=(c+arr[8])>>>0; if(rem>9) c=(c+(arr[9]<<8))>>>0; if(rem>10) c=(c+(arr[10]<<16))>>>0; if(rem>11) c=(c+(arr[11]<<24))>>>0; }
   const mix2=()=>{ a=(a-b-c)^(c>>>13); a=(a-b-c)>>>0; b=(b-c-a)^(a<<8); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>13); c=(c-a-b)>>>0; a=(a-b-c)^(c>>>12); a=(a-b-c)>>>0; b=(b-c-a)^(a<<16); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>5); c=(c-a-b)>>>0; a=(a-b-c)^(c>>>3); a=(a-b-c)>>>0; b=(b-c-a)^(a<<10); b=(b-c-a)>>>0; c=(c-a-b)^(b>>>15); c=(c-a-b)>>>0; };
   mix2(); out.lookup2=c>>>0; }
  return out;
}
const mk=fs.readFileSync('reverse/samples/Minimal/main.c');
const target=0x6AE203ED>>>0;
for (const [label,buf] of [['raw',mk],['crlf',Buffer.from(mk.toString('latin1').replace(/\n/g,'\r\n'),'latin1')],['lower',Buffer.from(mk.toString('latin1').toLowerCase(),'latin1')]]) {
  console.log(label, hashes(buf), target);
}
