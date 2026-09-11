// Original WeAgent geometric glyphs. No font, network or image-library dependency.
// Vector primitives are the source of truth; PNGs are for native WeChat tabBar.
const fs = require('node:fs'); const path = require('node:path'); const zlib = require('node:zlib');
const { icons: glyphs, STROKE: stroke, svg: vectorSVG } = require('../miniprogram/utils/icon-shapes');
const size = 72, samples = 4;
function covered(shape,x,y) {
  if (shape.type === 'circle') {
    const d = Math.hypot(x-shape.cx,y-shape.cy);
    return shape.fill ? d <= shape.r : Math.abs(d-shape.r) <= stroke/2;
  }
  const dx=shape.x2-shape.x1,dy=shape.y2-shape.y1;
  const length=dx*dx+dy*dy;
  const t=length===0?0:Math.max(0,Math.min(1,((x-shape.x1)*dx+(y-shape.y1)*dy)/length));
  return Math.hypot(x-shape.x1-t*dx,y-shape.y1-t*dy) <= stroke/2;
}
function crc32(bytes) {
  let crc=0xffffffff;
  for (const byte of bytes) { crc^=byte; for (let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data) {
  const result=Buffer.alloc(data.length+12); result.writeUInt32BE(data.length);
  result.write(type,4); data.copy(result,8); result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4); return result;
}
function png(shapes,color) {
  const rgb=color.match(/\w\w/g).map(v=>parseInt(v,16)),stride=1+size*4,raw=Buffer.alloc(stride*size);
  for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
    let hits=0;
    for (let sy=0;sy<samples;sy++) for (let sx=0;sx<samples;sx++) {
      const px=(x+(sx+.5)/samples)*24/size,py=(y+(sy+.5)/samples)*24/size;
      if (shapes.some(shape=>covered(shape,px,py))) hits++;
    }
    const offset=y*stride+1+x*4;
    raw[offset]=rgb[0]; raw[offset+1]=rgb[1]; raw[offset+2]=rgb[2]; raw[offset+3]=Math.round(255*hits/(samples*samples));
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size,4); header[8]=8; header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function generate(destination=path.resolve(__dirname,'../miniprogram/assets')) {
  const vectors=path.join(destination,'vectors'); fs.mkdirSync(vectors,{recursive:true});
  let count=0;
  for (const [name,shapes] of Object.entries(glyphs)) {
    fs.writeFileSync(path.join(vectors,`${name}.svg`),vectorSVG(name,'#f4f4f1')+'\n');
    if (!['home','sessions','inbox','me','terminal','plus','arrow','shield','mark'].includes(name)) continue;
    const variants=['home','sessions','inbox','me'].includes(name) ? [[`tab-${name}`,'#858580'],[`tab-${name}-active`,'#f4f4f1']] : [[`icon-${name}`,'#f4f4f1']];
    for (const [file,color] of variants) { fs.writeFileSync(path.join(destination,`${file}.png`),png(shapes,color)); count++; }
  }
  return count;
}
if (require.main === module) console.log(`Generated ${generate()} PNG icons and ${Object.keys(glyphs).length} vector sources.`);
module.exports={generate};
