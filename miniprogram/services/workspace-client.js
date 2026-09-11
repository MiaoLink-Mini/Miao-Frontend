const { errorText } = require('../utils/error-display');
const { sha256 } = require('../utils/sha256');
const { validate } = require('./wire');
const LIMIT = 512*1024, CHUNK=24*1024, DOWNLOAD=4*1024*1024;
const fault=(code,message)=>Object.assign(new Error(message),{code});
const invoke=(owner,name,input)=>new Promise((resolve,reject)=>owner[name](Object.assign({},input,{success:resolve,fail:reject})));
function projectFence(rt,scope) {
 const epoch=rt.epoch,content=rt.contentEpoch;
 return ()=>{
  const node=rt.gateway.lookup('nodes',scope.nodeId),project=rt.gateway.lookup('projects',scope.projectId),agent=rt.gateway.lookup('agents',scope.agentId);
  if(!rt.auth||rt.epoch!==epoch||rt.contentEpoch!==content||!node||node.revoked||!project||!project.valid||project.nodeId!==scope.nodeId||!agent||agent.nodeId!==scope.nodeId)throw fault('CONTENT_CLEARED','Project context changed');
 };
}
async function projectStep(rt,scope,request,store,key) {
 const check=projectFence(rt,scope);check();
 if(!rt.live)throw fault('LIVE_REQUIRED','Live Gateway required');
 if(!store[key])store[key]={operationId:await rt.gateway.id('history'),input:Object.assign({},scope,{request,capabilityRevision:rt.gateway.lookup('agents',scope.agentId).capabilityRevision})};
 check();const saved=store[key];validate('ProjectHistory',saved.input);
 const result=saved.result||await rt.command('projectHistory',[saved.input],saved.operationId);check();
 if(result?.unknown)throw Object.assign(fault('RESULT_UNKNOWN','Query the original history request'),{uncertain:true});
 validate('NativeResult',result);if(result.action!=='workspace'||result.requestKind!==request.kind)throw fault('INVALID_PROTOCOL','History receipt mismatch');
 saved.result=result;return result;
}
function fence(rt,sid) {
  const epoch=rt.epoch,content=rt.contentEpoch,body=rt.bodyEpoch[sid]||0;
  return ()=>{
    const session=rt.gateway.lookup('sessions',sid), node=session&&rt.gateway.lookup('nodes',session.nodeId);
    if(!rt.auth||epoch!==rt.epoch||content!==rt.contentEpoch||body!==(rt.bodyEpoch[sid]||0)||!session||session.historyState==='purged'||node&&node.revoked) throw fault('CONTENT_CLEARED','Content context changed; discard this result and reopen the session');
  };
}
async function step(rt,sid,request,store,key) {
  validate('WorkspaceRequest',request); const check=fence(rt,sid); check();
  if(!rt.live)throw fault('LIVE_REQUIRED','Workspace operations require a real Gateway');
  let saved=store[key];
  if(!saved){
    const session=rt.gateway.lookup('sessions',sid); const operationId=await rt.gateway.id('workspace');check();
    saved={operationId,input:{expectedTurnId:session.turnId,capabilityRevision:session.capabilityRevision,control:{action:'workspace',request}}};store[key]=saved;
  }
  if(saved.result){check();return saved.result;}
  let result;
  try{result=await rt.command('workspaceStep',[sid,saved.input],saved.operationId);}catch(error){error.operationId=saved.operationId;throw error;}
  check();
  if(result&&result.unknown)throw Object.assign(fault('RESULT_UNKNOWN','Result unknown. Query/resume with the same operation identifier; do not start another upload.'),{uncertain:true,operationId:saved.operationId});
  validate('NativeResult',result);
  if(result.action!=='workspace'||result.requestKind!==saved.input.control.request.kind)throw fault('INVALID_PROTOCOL','Workspace result does not match the issued request');
  saved.result=result;return result;
}
function mediaType(bytes,name){
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';
  const ascii=(a,b)=>Array.from(bytes.slice(a,b)).map(x=>String.fromCharCode(x)).join('');
  if(['GIF87a','GIF89a'].includes(ascii(0,6)))return'image/gif';
  if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return'image/webp';
  if(ascii(0,5)==='%PDF-')return'application/pdf';
  if(name.endsWith('.json'))return'application/json';
  return'text/plain'; // Node validates UTF-8 before accepting this explicitly declared type.
}
async function createUpload(rt,sid,file){
  const check=fence(rt,sid);check();
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>LIMIT)throw fault('PAYLOAD_TOO_LARGE','Maximum attachment size is 512 KiB');
  if(typeof file.name!=='string'||!file.name||file.name.length>160||/[\\/\x00-\x1f]/.test(file.name))throw fault('VALIDATION_FAILED','Invalid attachment display name');
  const api=rt.gateway.api(),fs=api.getFileSystemManager();
  const data=file.size? (await invoke(fs,'readFile',{filePath:file.path,position:0,length:file.size})).data :new ArrayBuffer(0);check();
  const bytes=new Uint8Array(data);
  if(bytes.length!==file.size)throw fault('SOURCE_CONFLICT','The selected file changed before reading');
  const id=await rt.gateway.id('upload');check();
  const queue=rt.uploadJobs[sid]||(rt.uploadJobs[sid]=[]);
  if(queue.length>=8||queue.reduce((n,j)=>n+j.size,0)+bytes.length>600*1024)throw fault('PAYLOAD_TOO_LARGE','Pending input exceeds 8 files or 600 KiB');
  const job={id,name:file.name,bytes,size:bytes.length,mediaType:mediaType(bytes,file.name),sha256:sha256(bytes),steps:{},state:'pending',offset:0};queue.push(job);rt.changed();return job;
}
async function upload(rt,sid,job,onProgress=()=>{}){
  if(job.running)throw fault('IN_PROGRESS','This upload is already running');
  const check=fence(rt,sid);check();job.running=true;
  try{
    const begin=await step(rt,sid,{kind:'begin_upload',name:job.name,mediaType:job.mediaType,size:job.size,sha256:job.sha256},job.steps,'begin');check();
    const resourceId=begin.view.transfer.id;job.resourceId=resourceId;
    for(let offset=0;offset<job.size;offset+=CHUNK){
      const bytes=job.bytes.slice(offset,Math.min(offset+CHUNK,job.size));
      const content=rt.gateway.api().arrayBufferToBase64(bytes.buffer);
      const result=await step(rt,sid,{kind:'upload_chunk',resourceId,offset,content},job.steps,'chunk:'+offset);check();
      job.offset=result.view.transfer.offset;job.state='uploading';onProgress(job);rt.changed();
    }
    const committed=await step(rt,sid,{kind:'commit_upload',resourceId},job.steps,'commit');check();
    const transfer=committed.view.transfer;
    if(transfer.sha256!==job.sha256||transfer.size!==job.size||!['received','accepted'].includes(transfer.state))throw fault('SOURCE_CONFLICT','Node did not confirm the exact attachment');
    job.state=transfer.state;job.offset=job.size;job.error='';onProgress(job);rt.changed();return transfer;
  }catch(error){job.error=errorText(error);job.state=error.uncertain?'unknown':'failed';job.operationId=error.operationId;rt.changed();throw error;}
  finally{job.running=false;}
}
async function download(rt,sid,request,first,onProgress=()=>{}){
  const check=fence(rt,sid);check();const t=first.view.transfer;
  if(!t||t.state!=='download'||t.offset!==0||typeof t.content!=='string'||t.size>DOWNLOAD||!t.version||t.sha256!==t.version)throw fault('INVALID_PROTOCOL','Invalid first download chunk');
  const bytes=new Uint8Array(t.size);let next=t,offset=0;const steps={};
  for(let count=0;count<=Math.ceil(DOWNLOAD/CHUNK);count++){
    check();const part=new Uint8Array(rt.gateway.api().base64ToArrayBuffer(next.content));
    if(next.id!==t.id||next.version!==t.version||next.sha256!==t.sha256||next.size!==t.size||next.offset!==offset||next.nextOffset!==offset+part.length||next.nextOffset>t.size||!next.eof&&part.length===0)throw fault('SOURCE_CONFLICT','File version or chunk range changed during download');
    bytes.set(part,offset);offset+=part.length;onProgress(offset,t.size);
    if(next.eof){if(offset!==t.size||sha256(bytes)!==t.sha256)throw fault('SOURCE_CONFLICT','Downloaded file checksum mismatch');return saveLocal(rt,sid,bytes.buffer,t.name,t.mediaType,check);}
    const result=await step(rt,sid,{kind:'read_file',resourceId:t.id,version:t.version,format:'base64',offset},steps,'read:'+offset);check();next=result.view.transfer;
  }
  throw fault('INVALID_PROTOCOL','Download exceeded its bounded chunk count');
}
async function saveLocal(rt,sid,data,name,mediaType,check=fence(rt,sid)){
  check();const api=rt.gateway.api();const key=await rt.gateway.id('weagent');check();
  const extension=({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','application/pdf':'.pdf','application/json':'.json','text/plain':'.txt'})[mediaType]||'.bin';
  const filePath=api.env.USER_DATA_PATH+'/'+key+extension;const fs=api.getFileSystemManager();
  await invoke(fs,'writeFile',{filePath,data});
  try{check();}catch(error){fs.unlink({filePath,fail(){}});throw error;}
  const list=rt.localFiles[sid]||(rt.localFiles[sid]=[]);list.push(filePath);
  while(list.length>8){fs.unlink({filePath:list.shift(),fail(){}});}
  return{filePath,name,mediaType};
}
function inputItems(rt,sid){const a=rt.inputSelection(sid);return [...a.attachments,...a.references,...(a.command?[a.command]:[])];}
module.exports={step,fence,projectStep,projectFence,createUpload,upload,download,saveLocal,invoke,inputItems,mediaType,LIMIT};
