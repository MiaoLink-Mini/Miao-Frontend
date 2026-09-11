const {icons,svg}=require('./icon-shapes');
const {palette}=require('./appearance');
const TONES=Object.freeze(['ink','muted','quiet','accent','accentInk','positive','negative','warning']);
const cache=new Map(),BASE64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(text){let out='';for(let i=0;i<text.length;i+=3){const a=text.charCodeAt(i),b=text.charCodeAt(i+1),c=text.charCodeAt(i+2);out+=BASE64[a>>2]+BASE64[((a&3)<<4)|(Number.isNaN(b)?0:b>>4)]+(Number.isNaN(b)?'=':BASE64[((b&15)<<2)|(Number.isNaN(c)?0:c>>6)])+(Number.isNaN(c)?'=':BASE64[c&63]);}return out;}
function source(name,theme,tone='ink'){
 if(!Object.prototype.hasOwnProperty.call(icons,name)||!TONES.includes(tone))return '';
 const color=palette(theme)[tone],key=name+':'+color;
 if(!cache.has(key)){if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,'data:image/svg+xml;base64,'+base64(svg(name,color)));}
 return cache.get(key);
}
module.exports={source,TONES};
