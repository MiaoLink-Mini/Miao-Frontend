/* Text-only render model: no HTML, external image fetches, eval, or executable links. */
const KEYWORDS=new Set('const let var function return async await if else for while class new throw try catch finally import export from default true false null undefined def return pass with in not and or yield public private static void package func type struct interface go defer range select case break continue'.split(' '));
function tokens(text) {
 const parts=String(text).split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#[^\n]*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z_0-9]*\b)/g);
 return parts.filter(Boolean).map(text=>({text,kind:/^(\/\/|#)/.test(text)?'comment':/^["'`]/.test(text)?'string':/^\d/.test(text)?'number':KEYWORDS.has(text)?'keyword':'plain'}));
}
function inline(text) {
 return String(text).split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).filter(Boolean).map(s=>s.startsWith('**')&&s.endsWith('**')?{text:s.slice(2,-2),kind:'strong'}:s.startsWith('`')&&s.endsWith('`')?{text:s.slice(1,-1),kind:'inline-code'}:{text:s,kind:'plain'});
}
function markdown(text) {
 const lines=String(text||'').split('\n'),blocks=[];let paragraph=[],code=null;
 const flush=()=>{if(paragraph.length){blocks.push({kind:'paragraph',segments:inline(paragraph.join('\n'))});paragraph=[];}};
 for(const line of lines){
  const fence=/^\s*(`{3,}|~{3,})([^\s]*)\s*$/.exec(line);
  if(code){if(fence&&fence[1][0]===code.fence[0]&&fence[1].length>=code.fence.length){blocks.push(code);code=null;}else{code.lines.push({number:code.lines.length+1,segments:tokens(line),text:line});}continue;}
  if(fence){flush();code={kind:'code',language:fence[2]||'code',fence:fence[1],lines:[]};continue;}
  if(!line.trim()){flush();continue;}
  const heading=/^(#{1,4})\s+(.+)$/.exec(line),bullet=/^\s*(?:[-*+]\s+|\d+\.\s+)(.*)$/.exec(line),quote=/^>\s?(.*)$/.exec(line);
  if(heading||bullet||quote){flush();blocks.push({kind:heading?'heading':bullet?'bullet':'quote',segments:inline((heading||bullet||quote)[heading?2:1])});}
  else paragraph.push(line);
 }
 flush();if(code)blocks.push(code);return blocks.map((b,i)=>Object.assign({id:'block-'+i},b));
}
function markPair(a,b){
 const left=Array.from(a),right=Array.from(b);let start=0,end=0;
 while(start<left.length&&start<right.length&&left[start]===right[start])start++;
 while(end<left.length-start&&end<right.length-start&&left[left.length-1-end]===right[right.length-1-end])end++;
 const segments=v=>[{text:v.slice(0,start).join(''),changed:false},{text:v.slice(start,v.length-end).join(''),changed:true},{text:v.slice(v.length-end).join(''),changed:false}].filter(x=>x.text);
 return [segments(left),segments(right)];
}
function parseDiff(patch){
 if(typeof patch!=='string')return {rows:[],added:0,removed:0,hunks:0};
 let old=null,next=null,oldRemaining=0,newRemaining=0,hunk=false,added=0,removed=0,hunks=0;
 const input=patch.replace(/\r\n/g,'\n').split('\n');if(input[input.length-1]==='')input.pop();
 const rows=input.map((raw,index)=>{
  const header=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
  let kind='meta',text=raw,oldLine=null,newLine=null,sign='';
  if(header){old=Number(header[1]);next=Number(header[3]);oldRemaining=header[2]===undefined?1:Number(header[2]);newRemaining=header[4]===undefined?1:Number(header[4]);hunk=true;hunks++;kind='hunk';}
  else if(raw.startsWith('diff --git ')){hunk=false;}
  else if(hunk&&raw.startsWith('\\')){kind='meta';}
  else if(hunk&&oldRemaining>0&&raw.startsWith('-')){kind='removed';oldLine=old++;oldRemaining--;text=raw.slice(1);sign='-';removed++;}
  else if(hunk&&newRemaining>0&&raw.startsWith('+')){kind='added';newLine=next++;newRemaining--;text=raw.slice(1);sign='+';added++;}
  else if(hunk&&oldRemaining>0&&newRemaining>0&&raw.startsWith(' ')){kind='context';oldLine=old++;newLine=next++;oldRemaining--;newRemaining--;text=raw.slice(1);sign=' ';}
  else if(raw.startsWith('+++ ')||raw.startsWith('--- ')||raw.startsWith('index ')){hunk=false;}
  return {id:'line-'+index,kind,text,oldLine,newLine,sign,segments:[{text,changed:false}]};
 });
 // Pair adjacent replacement runs; bounded linear prefix/suffix highlighting.
 for(let i=0;i<rows.length;i++)if(rows[i].kind==='removed'){
  const a=[];while(i<rows.length&&rows[i].kind==='removed')a.push(rows[i++]);
  const b=[];while(i<rows.length&&rows[i].kind==='added')b.push(rows[i++]);i--;
  for(let n=0;n<Math.min(a.length,b.length);n++)if(a[n].text.length<8192&&b[n].text.length<8192){const pair=markPair(a[n].text,b[n].text);a[n].segments=pair[0];b[n].segments=pair[1];}
 }
 return {rows,added,removed,hunks};
}
function foldContext(rows,context=3){
 const out=[];
 for(let i=0;i<rows.length;){
  if(rows[i].kind!=='context'){out.push(rows[i++]);continue;}
  const start=i;while(i<rows.length&&rows[i].kind==='context')i++;
  const run=rows.slice(start,i);
  if(run.length<=context*2+1)out.push(...run);
  else out.push(...run.slice(0,context),{id:'fold-'+start,kind:'fold',count:run.length-context*2},...run.slice(-context));
 }return out;
}
function clipText(text,limit){
 text=String(text||'');let end=Math.max(0,Math.min(text.length,limit));
 if(end<text.length&&end>0){const code=text.charCodeAt(end-1);if(code>=0xD800&&code<=0xDBFF)end--;}
 return text.slice(0,end);
}
module.exports={tokens,inline,markdown,markPair,parseDiff,foldContext,clipText};
