const test = require('node:test');
const assert = require('node:assert/strict');
const { definePage } = require('../miniprogram/utils/page');
const { mount } = require('./helpers');
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; }
function pageFixture() {
  const id = deferred(), result = deferred(), commands = [], callbacks = [];
  const rt = { auth:true, live:false, epoch:1, contentEpoch:1, connection:'online', operations:{},
    gateway:{id:()=>id.promise,operation:async()=>({state:'confirmed',result:{id:'new-session'}})},
    command:(...args)=>{commands.push(args);return result.promise;},subscribe:()=>()=>{},view:()=>({pendingCount:0}) };
  global.getApp=()=>({runtime:rt}); global.wx={getStorageSync(){},setNavigationBarColor(){},setBackgroundColor(){}};
  let definition; global.Page=d=>definition=d;
  definePage({data:{busy:false,unknown:false},refresh(){}});
  const page={...definition,data:{...definition.data},pageLife:1,setData(p,cb){Object.assign(this.data,p);if(cb)cb();}};
  return {page,rt,id,result,commands,callbacks,after:r=>callbacks.push(r)};
}
test('leaving during random ID allocation never submits a late command', async()=>{
 const f=pageFixture(), work=f.page.action('create',[],f.after); f.page.onHide();f.id.resolve('operation1');await work;
 assert.equal(f.commands.length,0);assert.equal(f.callbacks.length,0);assert.equal(f.page.data.busy,false);assert.equal(f.page.data.unknown,false);
});
test('accepted operation survives navigation without redirecting a hidden page', async()=>{
 const f=pageFixture(),work=f.page.action('create',[],f.after);f.id.resolve('operation1');await Promise.resolve();
 assert.equal(f.commands.length,1);f.page.onHide();f.result.resolve({id:'new-session'});await work;
 assert.equal(f.callbacks.length,0);assert.equal(f.page.operationId,'operation1');assert.equal(f.page.data.unknown,true);assert.equal(f.page.data.busy,false);
 await f.page.onShow();await f.page.reconcile();assert.equal(f.callbacks.length,1);assert.equal(f.commands.length,1);assert.equal(f.page.data.unknown,false);
});
test('content clearing fences an accepted callback even without an account change',async()=>{
 const f=pageFixture(),work=f.page.action('send',[],f.after);f.id.resolve('operation1');await Promise.resolve();f.rt.contentEpoch++;
 f.result.resolve({id:'new-session'});await work;assert.equal(f.callbacks.length,0);
 f.page.operationScopeChanged();assert.equal(f.page.pendingAfter,null);assert.equal(f.page.data.busy,false);
});
test('an old failure cannot overwrite a new page generation',async()=>{
 const f=pageFixture(),work=f.page.action('send',[],f.after);f.id.resolve('operation1');await Promise.resolve();f.page.onHide();await f.page.onShow();
 f.page.setData({error:'new visible state'});f.result.reject(Error('old error'));await work;
 assert.equal(f.page.data.error,'new visible state');
});
test('unloading removes deferred navigation but keeps runtime command admission intact',async()=>{
 const f=pageFixture(),work=f.page.action('send',[],f.after);f.id.resolve('operation1');await Promise.resolve();f.page.onUnload();
 f.result.resolve({id:'new-session'});await work;assert.equal(f.page.pendingAfter,null);assert.equal(f.callbacks.length,0);assert.equal(f.commands.length,1);
});
test('receipt lookup cannot trigger a callback after hiding the page',async()=>{
 const f=pageFixture(),lookup=deferred();f.page.operationId='op';f.page.pendingAfter=f.after;f.rt.gateway.operation=()=>lookup.promise;
 const work=f.page.reconcile();f.page.onHide();lookup.resolve({state:'confirmed',result:{id:'s'}});await work;
 assert.equal(f.callbacks.length,0);assert.equal(f.page.data.unknown,true);
});
test('late share list failure cannot destroy a newer successful invite view',async()=>{
 const first=deferred(),second=deferred();let n=0;const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{request:()=>++n===1?first.promise:second.promise}};
 const p=mount('pages/share/index.js',rt);p.pageLife=1;p.data.id='s';p.loadActivity=async()=>{};
 const a=p.load(),b=p.load();second.resolve({items:[],nextPageToken:null,serverTime:new Date().toISOString()});await b;p.setData({error:'new state'});
 first.reject(Error('old failure'));await a;assert.equal(p.data.error,'new state');
});
test('late share list data cannot repopulate cleared local content',async()=>{
 const d=deferred();const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{request:()=>d.promise}};
 const p=mount('pages/share/index.js',rt);p.pageLife=1;p.data.id='s';p.loadActivity=async()=>{};
 const work=p.load();rt.contentEpoch++;p.setData({shares:[]});d.resolve({items:[{id:'g',expiresAt:new Date(Date.now()+1000).toISOString()}],serverTime:new Date().toISOString()});await work;
 assert.deepEqual(p.data.shares,[]);
});
test('overlapping activity reads preserve the latest response only',async()=>{
 const first=deferred(),second=deferred();let n=0;const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{request:()=>++n===1?first.promise:second.promise}};
 const p=mount('pages/share/index.js',rt);p.pageLife=1;p.data.id='s';const a=p.loadActivity(),b=p.loadActivity();
 second.resolve({items:[{id:'new',action:'send',state:'confirmed'}],nextPageToken:null});await b;
 first.resolve({items:[{id:'old',action:'send',state:'accepted'}],nextPageToken:null});await a;assert.equal(p.data.activity[0].id,'new');
});
test('share card cannot expose an invitation from a cleared content generation',()=>{
 const rt={auth:true,live:true,epoch:1,contentEpoch:2};const p=mount('pages/share/index.js',rt);
 p.invite={id:'share',token:'private',epoch:1,contentEpoch:1,deadline:Date.now()+60000};p.data.invitation={permission:'read'};
 assert.equal(p.onShareAppMessage({from:'button'}).path,'/pages/login/index');
});
test('subscription config errors cannot overwrite a hidden settings page',async()=>{
 const d=deferred(),rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{subscriptionConfig:()=>d.promise},preferences:{},subscribe:()=>()=>{}};
 const p=mount('pages/settings/index.js',rt);p.pageLife=1;const work=p.definition.onShow.call(p);
 p.pageLife++;p.setData({pageActive:false,subscription:{enabled:true,templates:[],notice:'new'}});d.reject(Error('old settings request'));await work;
 assert.equal(p.data.subscription.notice,'new');
});
test('native consent callback cannot submit after changing accounts',async()=>{
 const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{id:async()=>{throw Error('must not allocate');}},preferences:{}};
 const p=mount('pages/settings/index.js',rt);p.pageLife=1;p.data.subscription={enabled:true,templates:[{id:'known-template'}]};
 p.subscribeMessages();const native=p.calls.find(c=>c.method==='requestSubscribeMessage');assert.ok(native);
 rt.epoch++;await native.arg.success({'known-template':'accept'});assert.equal(p.pendingConsent,undefined);
});
test('pending subscription uses its original ID and does not toast across a content reset',async()=>{
 const d=deferred(),seen=[],rt={auth:true,live:true,epoch:1,contentEpoch:1,command:(...a)=>{seen.push(a);return d.promise;},preferences:{}};
 const p=mount('pages/settings/index.js',rt);p.pageLife=1;p.pendingConsent={id:'same-consent',choices:[],runtime:rt,epoch:1,contentEpoch:1};
 const work=p.submitConsent();rt.contentEpoch++;d.resolve({ok:true});await work;
 assert.equal(seen[0][2],'same-consent');assert.equal(p.calls.some(c=>c.method==='showToast'),false);p.refresh();assert.equal(p.pendingConsent,null);
});
test('a consent ID resolved after navigation does not issue a late write',async()=>{
 const d=deferred();let submitted=0;const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{id:()=>d.promise},command:()=>submitted++,preferences:{}};
 const p=mount('pages/settings/index.js',rt);p.pageLife=1;p.data.subscription={enabled:true,templates:[{id:'known-template'}]};p.subscribeMessages();
 const work=p.calls.find(c=>c.method==='requestSubscribeMessage').arg.success({'known-template':'accept'});p.onHide();d.resolve('consent');await work;assert.equal(submitted,0);
});
test('older shared diff errors never overwrite the current file selection',async()=>{
 const first=deferred(),second=deferred();let n=0;const rt={auth:true,live:true,epoch:1,contentEpoch:1};
 const p=mount('pages/shared/index.js',rt);p.pageLife=1;p.client={valid:()=>true,file:()=>++n===1?first.promise:second.promise};
 const a=p.loadDiff('first'),b=p.loadDiff('second');second.resolve({id:'second',patch:'new'});await b;
 first.reject(Error('late first-file error'));await a;assert.equal(p.data.diff.id,'second');assert.equal(p.data.detailError,'');
});
test('received shares do not refill the list after local content is cleared',async()=>{
 const d=deferred(),rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{request:()=>d.promise}};
 const p=mount('pages/shared/index.js',rt);p.pageLife=1;const work=p.loadShares();rt.contentEpoch++;
 d.resolve({items:[{id:'g'}],serverTime:new Date().toISOString()});await work;assert.deepEqual(p.data.shares,[]);
});
test('invitation confirmation opened before content clear cannot create a share',()=>{
 const rt={auth:true,live:true,epoch:1,contentEpoch:1};const p=mount('pages/share/index.js',rt);p.pageLife=1;
 p.data.live=true;p.data.session={id:'s'};let confirm,submitted=0;global.wx={showModal:arg=>confirm=arg.success};p.submitCreate=()=>submitted++;
 p.create();rt.contentEpoch++;confirm({confirm:true});assert.equal(submitted,0);
});

for (const change of ['content','runtime']) test('resource loading is fenced after '+change+' changes',async()=>{
 const d=deferred();let app,definition,shows=0;
 const rt={auth:true,live:true,epoch:1,contentEpoch:1,operations:{},ensure:()=>d.promise,subscribe:()=>()=>{},view:()=>({pendingCount:0})};app={runtime:rt};
 global.getApp=()=>app;global.wx={getStorageSync(){},setNavigationBarColor(){},setBackgroundColor(){}};global.Page=v=>definition=v;
 definePage({resource:'session',data:{id:'s'},refresh(){},onShow(){shows++;}});
 const p={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v);}};const work=p.onShow();
 if(change==='content')rt.contentEpoch++;else app.runtime={...rt};
 p.setData({error:'new context'});d.resolve({});await work;
 assert.equal(shows,0);assert.equal(p.data.error,'new context');
});

for(const kind of ['image','file']) test('native '+kind+' picker never attaches across account change',async()=>{
 const rt={auth:true,epoch:1,contentEpoch:1,bodyEpoch:{}};const p=mount('pages/workspace/index.js',rt);p.pageLife=1;p.data.id='s';let attached=0;p.addFile=async()=>attached++;
 const work=kind==='image'?p.chooseImage():p.chooseFile();const call=p.calls.find(c=>c.method===(kind==='image'?'chooseMedia':'chooseMessageFile'));
 rt.epoch++;call.arg.success({tempFiles:[{tempFilePath:'/local/photo',path:'/local/file',name:'a.txt',size:1}]});await work;assert.equal(attached,0);
});
test('native picker temporary hide does not discard an otherwise valid explicit selection',async()=>{
 const rt={auth:true,epoch:1,contentEpoch:1,bodyEpoch:{}};const p=mount('pages/workspace/index.js',rt);p.pageLife=1;p.data.id='s';let attached=0;p.addFile=async()=>attached++;
 const work=p.chooseImage();p.onHide();p.calls.find(c=>c.method==='chooseMedia').arg.success({tempFiles:[{tempFilePath:'/local/photo',size:1}]});await work;assert.equal(attached,1);
});
test('an unloaded native picker cannot read or stage a file',async()=>{
 const rt={auth:true,epoch:1,contentEpoch:1,bodyEpoch:{}};const p=mount('pages/workspace/index.js',rt);p.data.id='s';let attached=0;p.addFile=async()=>attached++;
 const work=p.chooseFile();p.onUnload();p.calls.find(c=>c.method==='chooseMessageFile').arg.success({tempFiles:[{path:'/file',name:'a.txt',size:1}]});await work;assert.equal(attached,0);
});
for(const change of ['account','content','hide']) test('workspace destructive confirmation is fenced after '+change,async()=>{
 const rt={auth:true,epoch:1,contentEpoch:1,bodyEpoch:{}};const p=mount('pages/workspace/index.js',rt);p.pageLife=1;p.data.id='s';p.data.session={id:'s',state:'closed',revision:1};let answer,sent=0;
 global.wx={showModal:arg=>answer=arg.success};p.action=async()=>sent++;const work=p.deleteTranscript();
 if(change==='account')rt.epoch++;else if(change==='content')rt.contentEpoch++;else p.onHide();
 answer({confirm:true});await work;assert.equal(sent,0);
});
test('workspace native control confirmation cannot reuse an old context',async()=>{
 const rt={auth:true,epoch:1,contentEpoch:1,bodyEpoch:{}};const p=mount('pages/workspace/index.js',rt);p.pageLife=1;p.data.id='s';p._controls={goal:{label:'Goal',confirm:true,request:{kind:'set_goal',text:'A'}}};let answer,sent=0;
 global.wx={showModal:arg=>answer=arg.success};p.run=async()=>sent++;const work=p.perform({currentTarget:{dataset:{id:'goal'}}});rt.contentEpoch++;answer({confirm:true});await work;assert.equal(sent,0);
});

test('subscription requests target one configured template and never exceed WeChat batch limit',()=>{
 const rt={auth:true,live:true,epoch:1,contentEpoch:1};const p=mount('pages/settings/index.js',rt);
 p.data.subscription={enabled:true,templates:Array.from({length:5},(_,i)=>({id:'template'+i,title:'notice'+i}))};
 p.subscribeMessages({currentTarget:{dataset:{id:'template4'}}});assert.deepEqual(p.calls.at(-1).arg.tmplIds,['template4']);
 p.data.subscriptionBusy=false;p.subscribeMessages();assert.equal(p.calls.at(-1).arg.tmplIds.length,3);
 p.data.subscriptionBusy=false;const count=p.calls.length;p.subscribeMessages({currentTarget:{dataset:{id:'unconfigured'}}});assert.equal(p.calls.length,count);
});

test('subscription switch records opt-out and only reflects confirmed choices',async()=>{
 const sent=[];const rt={auth:true,live:true,epoch:1,contentEpoch:1,gateway:{id:async()=> 'op'},command:async(method,args)=>{sent.push({method,args});return {};}};
 const p=mount('pages/settings/index.js',rt);p.data.subscription={enabled:true,templates:[{id:'template'}]};p.data.subscriptionAccepted={template:true};
 await p.changeSubscription({currentTarget:{dataset:{id:'template'}},detail:{value:false}});
 assert.equal(sent[0].method,'subscribeConsent');assert.deepEqual(sent[0].args,[[{templateId:'template',decision:'reject'}]]);assert.equal(p.data.subscriptionAccepted.template,false);
 p.data.subscriptionAccepted={template:true};rt.command=async()=>({unknown:true});await p.changeSubscription({currentTarget:{dataset:{id:'template'}},detail:{value:false}});assert.equal(p.data.subscriptionPending,true);assert.equal(p.data.subscriptionAccepted.template,true);
});
