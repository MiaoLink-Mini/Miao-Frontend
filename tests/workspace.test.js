const test=require('node:test'),assert=require('node:assert/strict');
const client=require('../miniprogram/services/workspace-client');
const {sha256}=require('../miniprogram/utils/sha256');
const {Runtime}=require('../miniprogram/services/runtime');
const {LiveGateway}=require('../miniprogram/services/live-gateway');
const {mount}=require('./helpers');
const view=(kind,extra={})=>({action:'workspace',requestKind:kind,view:{title:'Fixture',notice:'Contract fixture, not a live Node',entries:[],controls:[],...extra}});
const exactBuffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
function fixture(){let seq=0;const writes=[],unlinks=[],calls=[];const sessions={id:'s',nodeId:'n',turnId:'t',capabilityRevision:1,historyState:'available'},node={id:'n',revoked:false};
 const api={env:{USER_DATA_PATH:'/isolated'},arrayBufferToBase64:x=>Buffer.from(x).toString('base64'),base64ToArrayBuffer:x=>exactBuffer(Buffer.from(x,'base64')),getFileSystemManager:()=>({writeFile:x=>{writes.push(x);x.success({});},unlink:x=>{unlinks.push(x.filePath);},readFile:x=>x.success({data:exactBuffer(Buffer.alloc(x.length,65))})})};
 const rt={auth:true,live:true,epoch:0,contentEpoch:0,bodyEpoch:{},uploadJobs:{},localFiles:{},changed(){},gateway:{lookup:(type,id)=>type==='sessions'?sessions:node,id:async()=>`op${++seq}`,api:()=>api},command:async(method,args,id)=>{calls.push({method,args,id});return view(args[1].control.request.kind);}};
 return {rt,api,calls,writes,unlinks,sessions,node};
}
test('workspace retries query the same operation ID and accept only matching result types',async()=>{
 const {rt,calls}=fixture(),store={};let first=true;rt.command=async(method,args,id)=>{calls.push(id);if(first){first=false;return {unknown:true};}return view('files');};
 await assert.rejects(client.step(rt,'s',{kind:'files'},store,'read'),e=>e.uncertain===true);await client.step(rt,'s',{kind:'files'},store,'read');assert.deepEqual(calls,[calls[0],calls[0]]);
 rt.command=async()=>view('history');await assert.rejects(client.step(rt,'s',{kind:'files'},{},'read'),e=>e.code==='INVALID_PROTOCOL');
});
test('late responses cannot repopulate a cleared, revoked or changed account context',async()=>{
 for(const mutate of [x=>x.rt.contentEpoch++,x=>x.rt.epoch++,x=>x.rt.bodyEpoch.s=1,x=>x.node.revoked=true,x=>x.sessions.historyState='purged']){
  const c=fixture();c.rt.command=async()=>{mutate(c);return view('files');};await assert.rejects(client.step(c.rt,'s',{kind:'files'},{},'read'),e=>e.code==='CONTENT_CLEARED');
 }
});
test('file selection does not perform upload and checks quota after asynchronous file reading',async()=>{
 const {rt,calls}=fixture();const job=await client.createUpload(rt,'s',{name:'example.txt',path:'/selected',size:10});assert.equal(job.state,'pending');assert.equal(job.mediaType,'text/plain');assert.equal(calls.length,0);assert.equal(job.sha256,sha256(new Uint8Array(10).fill(65)));
 rt.uploadJobs.s=Array.from({length:8},()=>({size:1}));await assert.rejects(client.createUpload(rt,'s',{name:'ninth.txt',path:'/selected',size:1}),e=>e.code==='PAYLOAD_TOO_LARGE');
 await assert.rejects(client.createUpload(rt,'s',{name:'../secret',path:'/selected',size:1}),e=>e.code==='VALIDATION_FAILED');
});
test('upload resumption preserves begin and chunk identities without submitting a prompt',async()=>{
 const {rt,calls}=fixture();const job=await client.createUpload(rt,'s',{name:'text.txt',path:'/selected',size:2});let failed=false;
 rt.command=async(method,args,id)=>{const r=args[1].control.request;calls.push({method,kind:r.kind,id});if(r.kind==='upload_chunk'&&!failed){failed=true;return {unknown:true};}
  const transfer={id:'attachment',name:job.name,mediaType:job.mediaType,size:2,offset:r.kind==='begin_upload'?0:2,state:r.kind==='commit_upload'?'received':'uploading',sha256:job.sha256};return view(r.kind,{transfer});};
 await assert.rejects(client.upload(rt,'s',job),e=>e.uncertain);assert.equal(job.state,'unknown');await client.upload(rt,'s',job);assert.equal(job.state,'received');
 assert.equal(calls.filter(x=>x.kind==='begin_upload').length,1);const chunks=calls.filter(x=>x.kind==='upload_chunk');assert.equal(chunks.length,2);assert.equal(chunks[0].id,chunks[1].id);assert.ok(calls.every(x=>x.method==='workspaceStep'));
});
test('downloads verify all bytes before preparing a local shareable file',async()=>{
 const {rt,writes}=fixture(),bytes=Buffer.from('file output'),hash=sha256(bytes);
 const first=view('read_file',{transfer:{id:'file',name:'result.txt',mediaType:'text/plain',size:bytes.length,offset:0,nextOffset:bytes.length,content:bytes.toString('base64'),state:'download',sha256:hash,version:hash,eof:true}});
 const result=await client.download(rt,'s',{kind:'read_file',resourceId:'file',format:'base64'},first);assert.ok(result.filePath.startsWith('/isolated/'));assert.equal(writes.length,1);assert.deepEqual(Buffer.from(writes[0].data),bytes);
 first.view.transfer.content=Buffer.from('other bytes').toString('base64');await assert.rejects(client.download(rt,'s',{},first),e=>e.code==='SOURCE_CONFLICT');assert.equal(writes.length,1);
});
test('multipart download rejects a changed version instead of combining snapshots',async()=>{
 const {rt,writes}=fixture(),bytes=Buffer.from('abcd'),hash=sha256(bytes);const transfer={id:'file',name:'r.txt',mediaType:'text/plain',size:4,offset:0,nextOffset:2,content:Buffer.from('ab').toString('base64'),state:'download',sha256:hash,version:hash,eof:false};
 rt.command=async()=>view('read_file',{transfer:{...transfer,offset:2,nextOffset:4,content:Buffer.from('cd').toString('base64'),eof:true,version:'0'.repeat(64)}});
 await assert.rejects(client.download(rt,'s',{},view('read_file',{transfer})),e=>e.code==='SOURCE_CONFLICT');assert.equal(writes.length,0);
});
test('post-write account changes delete the just-prepared local file',async()=>{
 const {rt,api,unlinks}=fixture();api.getFileSystemManager=()=>({writeFile:x=>{rt.epoch++;x.success({});},unlink:x=>unlinks.push(x.filePath)});
 await assert.rejects(client.saveLocal(rt,'s',new ArrayBuffer(1),'r.txt','text/plain'),e=>e.code==='CONTENT_CLEARED');assert.equal(unlinks.length,1);assert.deepEqual(rt.localFiles,{});
});
test('clearing content also removes workspace selections, bytes and tracked private files',async t=>{
 const unlinks=[];const gateway=new LiveGateway({gatewayURL:'http://127.0.0.1:18080',wx:{getFileSystemManager:()=>({unlink:x=>unlinks.push(x.filePath)})}});gateway.connect=async()=>{};
 const rt=new Runtime(gateway);rt.auth=true;t.after(()=>rt.dispose());rt.inputDrafts.s={attachments:[{id:'secret'}]};rt.uploadJobs.s=[{bytes:new Uint8Array(10)}];rt.localFiles.s=['/local/result'];
 await rt.clearLocalContent();assert.deepEqual(rt.inputDrafts,{});assert.deepEqual(rt.uploadJobs,{});assert.deepEqual(rt.localFiles,{});assert.deepEqual(unlinks,['/local/result']);
});
test('a subscription callback from a different login cannot be retried as the new user',async()=>{
 const rt={auth:true,epoch:2,command:async()=>{throw Error('must not submit');}};const page=mount('pages/settings/index.js',rt);page.pendingConsent={id:'consent',choices:[],epoch:1};await page.submitConsent();assert.equal(page.pendingConsent,null);assert.equal(page.data.subscriptionPending,false);
});
test('workspace parameter forms do not assume select options exist on text fields',()=>{
 const rt={contentEpoch:0,bodyEpoch:{},view:()=>({sessions:[]})};const page=mount('pages/workspace/index.js',rt);
 page.showView(view('goal',{controls:[{id:'goal',label:'Goal',confirm:true,request:{kind:'set_goal',text:'test'},fields:[{key:'text',label:'Objective',type:'text',maxLength:4000}]}]}));
 assert.equal(page.data.forms[0].fields[0].value,'test');page.fieldInput({currentTarget:{dataset:{id:'goal',key:'text'}},detail:{value:'new'}});assert.equal(page._controls.goal.request.text,'new');
});

test('history deletion requires explicit descendant selection and preserves its scope in the command',async()=>{
 const page=mount('pages/workspace/index.js',{auth:true,epoch:0,contentEpoch:0,bodyEpoch:{}});page.data.session={id:'s',state:'closed',revision:7};const sent=[];page.action=async(method,args)=>sent.push({method,args});
 await page.deleteTranscript();assert.deepEqual(sent[0],{method:'deleteHistory',args:['s',{revision:7,scope:'platform',includeDescendants:false}]});
 page.deleteChildrenInput({detail:{value:true}});await page.deleteTranscript();assert.equal(sent[1].args[1].includeDescendants,true);
 page.data.session.state='running';await page.deleteTranscript();assert.equal(sent.length,2);
});

test('live workspace keeps the established session menu and model controls reachable',async()=>{
 const fs=require('node:fs'),path=require('node:path');const rt={live:true,loadTimeline:async()=>{},view:()=>({sessions:[],projects:[],agents:[]})};const page=mount('pages/panel/index.js',rt);page.data.sessionId='s';page.data.kind='menu';page.refresh=()=>{};
 await page.onShow();assert.equal(page.calls.filter(x=>x.method==='redirectTo').length,0);
 const menu=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/panel/index.wxml'),'utf8');const workspace=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/workspace/index.wxml'),'utf8');
 const nav=require('../miniprogram/utils/navigation');assert.equal(nav.sessionUrl('overview','s',true),'/pages/workspace/index?id=s&kind=overview');assert.ok(menu.includes('{{item.url}}'));assert.ok(workspace.includes('/pages/panel/index?kind=menu&amp;sessionId={{id}}'));assert.ok(menu.includes('{{item.label}}'));assert.ok(menu.includes('openThinking'));
});

test('resume immediately issues native history-only creation without input or modal',async()=>{
 const page=mount('pages/workspace/index.js',{auth:true,epoch:0,contentEpoch:0,bodyEpoch:{}});
 const origin={mode:'resume',sessionId:'browser',sourceSessionId:'old',resourceId:'opaque'};
 page.data.session={nodeId:'n',projectId:'p',agentId:'a'};page.data.entries=[{id:'row',origin}];page.data.originPrompt='';
 const calls=[];page.action=async(method,args)=>calls.push({method,args});await page.branch({currentTarget:{dataset:{id:'row',mode:'resume'}}});
 assert.deepEqual(calls,[{method:'create',args:[{nodeId:'n',projectId:'p',agentId:'a',historyOnly:true,origin}]}]);assert.equal(page.calls.length,0);
});

for(const mode of ['fork','clone','import'])test(mode+' creates without a task input or automatic message',async()=>{
 const page=mount('pages/workspace/index.js',{auth:true,epoch:0,contentEpoch:0,bodyEpoch:{}});
 const origin={mode,sessionId:'browser',resourceId:'opaque',...(mode==='import'?{}:{sourceSessionId:'old'})};
 page.data.session={nodeId:'n',projectId:'p',agentId:'a'};page.data.entries=[{id:'row',origin}];
 page.requestOriginPrompt=()=>{throw Error('Must not ask for a task')};let payload;page.action=async(_,args)=>payload=args[0];
 await page.branch({currentTarget:{dataset:{id:'row',mode}}});assert.equal(payload.historyOnly,true);assert.equal(Object.hasOwn(payload,'prompt'),false);assert.equal(page.calls.some(x=>x.arg?.editable),false);
});

test('plugin pagination is direct and separated from collapsible operations',()=>{
 const page=mount('pages/workspace/index.js',{});
 const forms=[{id:'next',label:'Next',request:{kind:'extensions',offset:50},fields:[]},{id:'prev',label:'Previous',request:{kind:'extensions',offset:0},fields:[]},{id:'search',request:{kind:'extensions',query:''},fields:[{key:'query'}]},{id:'reload',request:{kind:'reload_extensions'},fields:[],confirm:true}];
 page._controls=Object.fromEntries(forms.map(f=>[f.id,f]));page._globalControlIds=forms.map(f=>f.id);page.data.entries=[];page.projectForms();
 assert.deepEqual(page.data.paginationForms.map(f=>f.id),['next','prev']);assert.deepEqual(page.data.globalForms.map(f=>f.id),['search','reload']);
 const fs=require('node:fs'),path=require('node:path');const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/workspace/index.wxml'),'utf8');const block=wxml.slice(wxml.indexOf('class="catalog-pagination"'),wxml.indexOf('class="subhead">\u53ef\u7528\u64cd\u4f5c'));
 assert.ok(block.includes('bindtap="perform"'));assert.ok(!block.includes('toggleForm'));assert.ok(block.includes('disabled="{{busy || unknown}}"'));
});

test('workspace removes passive host prose while preserving errors, warnings and controls',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/workspace/index.wxml'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/panel/index.wxml'),'utf8');
 assert.ok(!wxml.includes('view.notice'));assert.ok(!wxml.includes('toggleNotice'));assert.ok(!wxml.includes('native-note'));assert.ok(!panel.includes('source-strip'));
 for(const field of ['view.truncated','fileNotice','form.notice','view.externalUrl','view.prefill','busy,receipt,error'])assert.ok(wxml.includes(field));
 assert.ok(wxml.includes('view && (view.truncated || fileNotice || view.externalUrl || view.prefill)'));
});
