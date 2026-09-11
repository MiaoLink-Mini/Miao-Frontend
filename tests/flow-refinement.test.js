const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
const {Runtime}=require('../miniprogram/services/runtime');
const {FakeGateway}=require('../miniprogram/services/fake-gateway');
const {mount}=require('./helpers');
const nav=require('../miniprogram/utils/navigation');
const wn=require('../miniprogram/utils/workspace-navigation');

test('menu filters exact host sections, connectivity, closed and busy states',()=>{
 const s={id:'s',state:'completed',node:{online:true},capabilities:{workspace:true,send:true,models:true,compact:true,queue:true,historyImport:true},agent:{capabilities:{workspaceSections:['history','tasks','extensions']}}};
 const kinds=()=>nav.sessionGroups(s,true).flatMap(g=>g.items.map(i=>i.kind));
 assert.ok(kinds().includes('tasks'));assert.ok(kinds().includes('extensions'));assert.ok(kinds().includes('compact'));
 s.agent.capabilities.workspaceSections=['history'];assert.equal(kinds().includes('tasks'),false);assert.equal(kinds().includes('extensions'),false);
 s.state='running';assert.equal(kinds().includes('compact'),false);assert.equal(kinds().includes('config'),false);
 s.state='closed';assert.ok(kinds().includes('history'));assert.ok(kinds().includes('files'));assert.equal(kinds().includes('input'),false);assert.equal(kinds().includes('overview'),false);
 s.node.online=false;assert.equal(kinds().includes('history'),false);assert.ok(kinds().includes('organization'));
});
const tap=(key,value)=>({currentTarget:{dataset:{[key]:value}}});
const change=(key,value)=>({currentTarget:{dataset:{key}},detail:{value}});
async function fixture(t){const rt=new Runtime(new FakeGateway({delay:1}));await rt.login();t.after(()=>rt.dispose());return rt;}
function transport(){const calls=[];const api={navigateBack:x=>calls.push(['back',x]),redirectTo:x=>calls.push(['replace',x]),switchTab:x=>calls.push(['tab',x])};return {api,calls};}

test('routes use only declared exact kinds, preserving and encoding session identity',()=>{
 const sid='s&kind=close';assert.equal(nav.sessionUrl('files',sid,true),'/pages/workspace/index?id=s%26kind%3Dclose&kind=files');
 assert.equal(nav.sessionUrl('Files','s',true),null);assert.equal(nav.sessionUrl('__proto__','s',true),null);assert.equal(nav.sessionUrl('close','s',true),null);assert.equal(nav.sessionUrl('files','',true),null);
 assert.equal(nav.sessionUrl('input','s',true),'/pages/workspace/index?id=s&kind=attachments');
});
test('native session groups obey session capability and readonly boundaries',()=>{
 const session={id:'s',mode:'readonly',capabilities:{models:true,compact:true,queue:true,plan:false,diff:true,usage:true},agent:{capabilities:{plan:true}}};
 const items=nav.sessionGroups(session,true).flatMap(g=>g.items);
 for(const kind of ['config','compact','queue','input','plan'])assert.equal(items.some(i=>i.kind===kind),false);
 assert.ok(items.some(i=>i.kind==='diff'));assert.ok(items.some(i=>i.kind==='share'));assert.equal(nav.sessionGroups(null,true).length,0);
});
test('demo does not advertise a live share or native-only entry',()=>{const items=nav.sessionGroups({id:'s',capabilities:{}},false).flatMap(g=>g.items);for(const kind of ['files','tasks','extensions','history','share','organization','overview'])assert.ok(!items.some(i=>i.kind===kind));});
test('return uses the nearest exact session in the existing stack',()=>{const {api,calls}=transport();nav.returnToSession('s',api,[{route:'pages/session/index',data:{id:'s'}},{route:'pages/session/index',data:{id:'other'}},{route:'pages/workspace/index',data:{id:'s'}}]);assert.deepEqual(calls,[['back',{delta:2}]]);});
test('return never navigates into a different conversation and avoids stacking new pages',()=>{const {api,calls}=transport();nav.returnToSession('s?x',api,[{route:'pages/session/index',data:{id:'other'}},{route:'pages/workspace/index',data:{id:'s?x'}}]);assert.deepEqual(calls,[['replace',{url:'/pages/session/index?id=s%3Fx'}]]);});
test('tab intents are one-shot, scoped to the intended tab and the current account',()=>{const rt={auth:true,epoch:1},t=transport();nav.switchList(rt,'sessions',{filter:'active',nodeId:'n',unknown:'blocked'},t.api);assert.deepEqual(t.calls,[['tab',{url:'/pages/sessions/index'}]]);assert.equal(nav.consumeList(rt,'inbox'),null);assert.deepEqual(nav.consumeList(rt,'sessions'),{filter:'active',nodeId:'n'});assert.equal(nav.consumeList(rt,'sessions'),null);nav.switchList(rt,'sessions',{filter:'active'},t.api);rt.epoch++;assert.equal(nav.consumeList(rt,'sessions'),null);});
test('home status shortcuts intentionally reset unrelated session scopes',async t=>{const rt=await fixture(t),page=mount('pages/home/index.js',rt);page.activeSessions();assert.deepEqual(nav.consumeList(rt,'sessions'),{filter:'active',organization:'all',nodeId:'',projectId:'',agentId:''});page.pendingRequests();assert.deepEqual(nav.consumeList(rt,'inbox'),{filter:'pending'});});
test('Coding more opens a local grouped sheet without navigation or execution',async t=>{const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});page.more();assert.equal(page.data.menuOpen,true);assert.equal(page.calls.filter(c=>c.method==='navigateTo').length,0);assert.equal(rt.gateway.operations.size,0);page.selectMenu(tap('kind','diff'));assert.equal(page.data.menuOpen,false);assert.equal(page.calls.at(-1).arg.url,'/pages/panel/index?kind=diff&sessionId=demo-review');});
test('returning to Coding reads the actual current draft instead of a stale page field',async t=>{const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});rt.draft('demo-review','existing\nappended from tools');page.refresh();assert.equal(page.data.draft,'existing\nappended from tools');});
test('only an upward scroll pauses following, and later updates do not jump back',async t=>{const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});page.refresh();page.dragStart({detail:{scrollTop:300}});page.dragging({detail:{scrollTop:320}});assert.equal(page.data.following,true);page.dragging({detail:{scrollTop:260}});assert.equal(page.data.following,false);rt.timelines['demo-review'].items.push({key:'fresh',type:'assistant',text:'new chunk'});page.refresh();assert.equal(page.data.scrollTarget,'');page.data.motionMode='full';page.latest({});assert.equal(page.data.scrollAnimated,true);page.latest();assert.equal(page.data.scrollAnimated,false);});
test('hiding Coding clears keyboard geometry but does not clear the draft or stop work',async t=>{const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});rt.draft('demo-review','keep');page.setData({keyboardHeight:300,menuOpen:true});page.onHide();assert.equal(page.data.keyboardHeight,0);assert.equal(page.data.menuOpen,false);assert.equal(rt.draft('demo-review'),'keep');assert.equal(rt.gateway.operations.size,0);});
test('active Coding still queues explicitly and never silently steers',async t=>{const rt=await fixture(t),s=rt.gateway.data.sessions[0];s.capabilities={send:true,queue:true};const page=mount('pages/session/index.js',rt);page.onLoad({id:s.id});page.input({detail:{value:'next'}});let sent;page.action=(method,args)=>sent={method,args};page.send();assert.equal(sent.args[3],'queue');assert.equal(sent.method,'send');assert.match(page.data.sendLabel,/\u961f\u5217/);});
test('the pending banner routes only the request for this session without answering it',async t=>{const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});page.refresh();page.openPending();assert.equal(page.calls.at(-1).arg.url,'/pages/request/index?id=demo-approval');assert.equal(rt.gateway.operations.size,0);});
test('Agent-origin creation preserves the supplied Agent and resolves its actual host',async t=>{const rt=await fixture(t),agent=rt.gateway.data.agents.find(a=>a.state==='ready'),page=mount('pages/create/index.js',rt);page.onLoad({agentId:agent.id});page.refresh();assert.equal(page.data.agentId,agent.id);assert.equal(page.data.nodeId,agent.nodeId);assert.ok(page.data.agents.every(a=>a.nodeId===agent.nodeId));});
test('new-session selectors preserve the draft and reject an unready Agent',async t=>{const rt=await fixture(t),page=mount('pages/create/index.js',rt);page.onLoad({nodeId:'demo-mac'});page.refresh();page.input({detail:{value:'preserve prompt'}});const id=page.data.agentId;page.data.agents.push({id:'unavailable-test',state:'unavailable'});page.selectAgent(tap('id','unavailable-test'));assert.equal(page.data.agentId,id);page.selectNode(change('nodeIndex',0));assert.equal(page.data.prompt,'preserve prompt');assert.equal(rt.draft('create'),'preserve prompt');});
test('submit revalidates a host that became offline after the last render',async t=>{const rt=await fixture(t),page=mount('pages/create/index.js',rt);page.onLoad({nodeId:'demo-mac',projectId:'demo-web'});page.refresh();page.input({detail:{value:'task'}});rt.gateway.setOnline('demo-mac',false);let submitted=false;page.action=()=>{submitted=true;};page.submit();assert.equal(submitted,false);assert.equal(page.data.ready,false);});
test('session filters keep identity across directory reordering and removal',async t=>{const rt=await fixture(t),page=mount('pages/sessions/index.js',rt);page.setData({nodeId:'demo-mac'});page.refresh();rt.gateway.data.nodes.reverse();page.refresh();assert.equal(page.data.nodeOptions[page.data.nodeIndex].id,'demo-mac');rt.gateway.data.nodes=rt.gateway.data.nodes.filter(n=>n.id!=='demo-mac');page.refresh();assert.equal(page.data.nodeId,'demo-mac');assert.equal(page.data.nodeOptions[page.data.nodeIndex].id,'demo-mac');});
test('advanced filters are staged; dismissing them does not alter the live query',async t=>{const rt=await fixture(t),page=mount('pages/sessions/index.js',rt);page.refresh();page.openFilters();page.selectDraft(change('nodeIndex',1));const chosen=page.data.filterDraft.nodeId;page.closeFilters();assert.equal(page.data.nodeId,'');page.openFilters();assert.equal(page.data.filterDraft.nodeId,'');page.selectDraft(change('nodeIndex',1));page.applyFilters();assert.equal(page.data.nodeId,chosen);assert.equal(page.listSource().queries[0].nodeId,chosen);});
test('project tools select an explicit matching session instead of an unscoped empty panel',async t=>{const rt=await fixture(t);rt.live=true;const page=mount('pages/project/index.js',rt);page.onLoad({id:'demo-web'});page.refresh();page.tools(tap('kind','files'));assert.ok(page.data.toolSessions.length);assert.ok(page.data.toolSessions.every(s=>s.projectId==='demo-web'));const selected=page.data.toolSessions[0];page.chooseToolSession({detail:{id:selected.id}});assert.equal(page.calls.at(-1).arg.url,nav.sessionUrl('files',selected.id,true));});
test('context picker refuses a session from another project and an account change',async t=>{const rt=await fixture(t);rt.live=true;const page=mount('pages/project/index.js',rt);page.onLoad({id:'demo-web'});page.refresh();page.tools(tap('kind','files'));const before=page.calls.filter(c=>c.method==='navigateTo').length;page.chooseToolSession({detail:{id:'not-a-member'}});assert.equal(page.calls.filter(c=>c.method==='navigateTo').length,before);rt.epoch++;page.chooseToolSession({detail:{id:page.data.toolSessions[0].id}});assert.equal(page.calls.filter(c=>c.method==='navigateTo').length,before);});
test('Agent tools preserve both Agent and host scope',async t=>{const rt=await fixture(t);rt.live=true;const agent=rt.gateway.data.agents.find(a=>a.id==='demo-claude'),page=mount('pages/agent/index.js',rt);page.onLoad({id:agent.id});page.refresh();page.tools(tap('kind','account'));assert.ok(page.data.toolSessions.every(s=>s.agentId===agent.id&&s.nodeId===agent.nodeId));assert.ok(page.data.newUrl.includes('agentId='+agent.id));});
test('no-context native tool gives an actionable message without creating a session',async t=>{const rt=await fixture(t);rt.live=true;rt.gateway.data.sessions=[];const page=mount('pages/project/index.js',rt);page.onLoad({id:'demo-web'});page.refresh();page.tools(tap('kind','files'));assert.ok(page.data.toolMessage);assert.equal(page.calls.length,0);assert.equal(rt.gateway.operations.size,0);});
test('organization is a local platform view and never an invented native request',()=>{const page=mount('pages/workspace/index.js',{});page.onLoad({id:'s',kind:'organization'});let calls=0;page.refresh=()=>{};page.run=()=>{calls++;};page.load();assert.equal(calls,0);assert.equal(page.data.kind,'organization');});
test('refresh only replays declared safe navigation reads, never a write or download',()=>{for(const kind of ['files','list_files','task','history_messages'])assert.equal(wn.repeatable({kind}),true);for(const kind of ['set_goal','authorize_mcp','restore_apply','close','review','restore_preview','organization'])assert.equal(wn.repeatable({kind}),false);assert.equal(wn.repeatable({kind:'read_file',format:'base64'}),false);});
test('workspace refresh keeps the exact selected read rather than jumping to a root section',()=>{const page=mount('pages/workspace/index.js',{});page.data.kind='files';page.readRequest={kind:'read_file',resourceId:'opaque-exact',format:'text'};let request;page.run=r=>{request=r;};page.load();assert.deepEqual(request,page.readRequest);page.home();assert.deepEqual(request,{kind:'overview'});});
test('native controls remain attached to their entry; editing them never executes a command',()=>{const page=mount('pages/workspace/index.js',{});page.showView({requestKind:'tasks',view:{title:'Tasks',notice:'',entries:[{id:'task-a',label:'A',controls:[{id:'stop-a',label:'Stop',confirm:true,request:{kind:'stop_task',resourceId:'task-a'}}]}],controls:[{id:'goal',label:'Goal',request:{kind:'set_goal',text:'before'},confirm:true,fields:[{key:'text',type:'text',label:'Text',maxLength:4000}]}]}});assert.equal(page.data.entries[0].formItems[0].id,'stop-a');assert.deepEqual(page.data.globalForms.map(f=>f.id),['goal']);page.toggleForm(tap('id','goal'));page.fieldInput({currentTarget:{dataset:{id:'goal',key:'text'}},detail:{value:'after'}});assert.equal(page.data.globalForms[0].fields[0].value,'after');assert.equal(page.data.globalForms[0].expanded,true);assert.equal(page.calls.length,0);});
test('native overview groups only entries actually returned by the host',()=>{const groups=wn.groups([{id:'f',label:'Files',request:{kind:'files'}},{id:'a',label:'Account',request:{kind:'account'}}]);assert.deepEqual(groups.flatMap(g=>g.items).map(i=>i.id),['f','a']);assert.equal(groups.flatMap(g=>g.items).some(i=>i.request.kind==='mcp'),false);});
test('request and notification pages honor their own server page identities',async t=>{const rt=await fixture(t);rt.live=true;const page=mount('pages/inbox/index.js',rt);page.setData({remoteIds:['demo-approval']});page.refresh();assert.deepEqual(page.data.list.map(r=>r.id),['demo-approval']);page.setData({filter:'notices',remoteIds:[]});page.refresh();assert.deepEqual(page.data.notices,[]);});
test('all declared new route kinds and labels have no unregistered page destination',()=>{const app=require('../miniprogram/app.json');for(const kind of ['menu','plan','diff','usage','config','compact','input','files','tasks','extensions','checkpoints','account','queue','history','organization','overview','project','skills','commands','retry','goal','share']){const url=nav.sessionUrl(kind,'s',true);assert.ok(app.pages.includes(url.slice(1).split('?')[0]),kind);}assert.deepEqual(app.tabBar.list.map(t=>t.text),['\u603b\u89c8','\u4f1a\u8bdd','\u5f85\u5904\u7406','\u6211\u7684']);});
test('workspace organization fields no longer appear unconditionally on every tool page',()=>{const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/workspace/index.wxml'),'utf8');assert.ok(wxml.includes("kind === 'organization' && session"));assert.ok(wxml.includes('bindtap="finishSelection"'));assert.ok(wxml.includes('{{item.formItems}}'));assert.ok(wxml.includes('bindtap="retryPending"'));});

test('an open filter sheet retains the selected identity when its directory changes',async t=>{
 const rt=await fixture(t),page=mount('pages/sessions/index.js',rt);page.refresh();page.openFilters();page.selectDraft(change('nodeIndex',1));const id=page.data.filterDraft.nodeId;
 rt.gateway.data.nodes.reverse();page.refresh();assert.equal(page.data.nodeOptions[page.data.draftNodeIndex].id,id);
 rt.gateway.data.nodes=rt.gateway.data.nodes.filter(n=>n.id!==id);page.refresh();assert.equal(page.data.nodeOptions[page.data.draftNodeIndex].id,id);
 assert.equal(page.data.nodeId,'');page.applyFilters();assert.equal(page.data.nodeId,id);
});
test('late file content does not recreate a polling timer after its page is hidden',()=>{
 const page=mount('pages/workspace/index.js',{});page.data.pageActive=false;
 page.showView({requestKind:'read_file',view:{title:'File',entries:[],controls:[],transfer:{id:'exact-file-id',version:'exact-version'}}});
 assert.equal(page.fileWatch,null);
});
test('expanding older messages clears an old jump target without sending anything',async t=>{
 const rt=await fixture(t),page=mount('pages/session/index.js',rt);page.onLoad({id:'demo-review'});page.setData({scrollTarget:'latest',following:true});const old=page.data.limit;
 page.loadMore();assert.equal(page.data.limit,old+24);assert.equal(page.data.scrollTarget,'');assert.equal(page.data.following,false);assert.equal(rt.gateway.operations.size,0);
});

test('local history browser preserves draft and sends no prompt; unsupported agents have no action',async t=>{
 const rt=await fixture(t),page=mount('pages/create/index.js',rt);rt.live=true;
 const a=rt.gateway.data.agents.find(a=>a.state==='ready');a.capabilities.historyImport=true;
 rt.gateway.data.sessions=[];
 page.onLoad({agentId:a.id});page.input({detail:{value:'keep draft'}});page.refresh();
 const actions=[];page.action=(name,args)=>actions.push({name,args});
 page.browseHistory();assert.equal(actions.length,0);assert.equal(page.calls.filter(x=>x.method==='redirectTo').length,1);assert.equal(rt.draft('create'),'keep draft');
 a.capabilities.historyImport=false;page.browseHistory();assert.equal(actions.length,0);assert.equal(page.calls.filter(x=>x.method==='redirectTo').length,1);
 rt.live=false;
});

test('project history page loads without any session and discards results after project revocation',async t=>{
 const rt=await fixture(t);rt.live=true;rt.gateway.data.sessions=[];
 rt.gateway.lookup=(kind,id)=>(rt.gateway.data[kind]||[]).find(x=>x.id===id);
 const agent=rt.gateway.data.agents.find(a=>a.state==='ready'),project=rt.gateway.data.projects.find(p=>p.nodeId===agent.nodeId);
 agent.capabilityRevision=1;
 const page=mount('pages/workspace/index.js',rt);page.onLoad({kind:'history',nodeId:agent.nodeId,projectId:project.id,agentId:agent.id});
 const calls=[];rt.command=async(method,args)=>{calls.push({method,args});return {action:'workspace',requestKind:'history',view:{title:'History',notice:'',entries:[],controls:[]}};};
 await page.load();assert.equal(page.data.error,'');assert.equal(calls[0].method,'projectHistory');assert.equal(calls[0].args[0].projectId,project.id);assert.equal(rt.gateway.data.sessions.length,0);
 project.valid=false;await page.load();assert.ok(page.data.error);assert.equal(calls.length,1);assert.equal(page.data.view,null);rt.live=false;
});

test('session swipe reveals delete only horizontally and never navigates after swiping',()=>{
 const c=mount('components/session-card/index.js',{},true);c.data={session:{id:'s'},swipeable:true,revealed:false};
 c.touchStart({touches:[{clientX:180,clientY:100}]});c.touchEnd({changedTouches:[{clientX:170,clientY:180}]});assert.equal(c.calls.length,0);
 c.touchStart({touches:[{clientX:180,clientY:100}]});c.touchEnd({changedTouches:[{clientX:70,clientY:104}]});assert.equal(c.calls[0].arg,undefined);assert.deepEqual(c.calls[0].detail,{id:'s'});c.open();assert.equal(c.calls.length,1);
 c.remove();assert.equal(c.calls[1].name,'delete');
 c.touchStart({touches:[{clientX:70,clientY:100}]});c.touchEnd({changedTouches:[{clientX:180,clientY:104}]});assert.deepEqual(c.calls[2].detail,{id:''});c.open();assert.equal(c.calls.length,3);
 c.rename();assert.equal(c.calls[3].name,'rename');
});

test('swipe rename preserves metadata, rejects empty names and fences stale dialogs',async t=>{
 const rt=await fixture(t),page=mount('pages/sessions/index.js',rt),s=rt.gateway.data.sessions[0];rt.live=true;s.revision=3;s.tags=['keep'];s.pinned=true;s.archived=true;
 const calls=[];page.action=async(method,args,after)=>{calls.push({method,args});if(after)after();};
 global.wx={showModal:o=>o.success({confirm:true,content:'  New title  '})};
 await page.renameSession({detail:{id:s.id}});
 assert.equal(calls.length,1);assert.equal(calls[0].method,'organizeSession');assert.deepEqual(calls[0].args,[s.id,{revision:3,title:'New title',pinned:true,archived:true,tags:['keep']}]);assert.equal(page.data.swipedId,'');
 global.wx={showModal:o=>o.success({confirm:true,content:'   '})};await page.renameSession({detail:{id:s.id}});assert.equal(calls.length,1);assert.ok(page.data.error);
 global.wx={showModal:o=>o.success({confirm:false})};await page.renameSession({detail:{id:s.id}});assert.equal(calls.length,1);
 global.wx={showModal:o=>{rt.epoch++;o.success({confirm:true,content:'stale'});}};await page.renameSession({detail:{id:s.id}});assert.equal(calls.length,1);assert.equal(page.renaming,false);rt.live=false;
});
test('swipe deletion confirms platform-only scope and blocks active sessions',async t=>{
 const rt=await fixture(t),page=mount('pages/sessions/index.js',rt);const s=rt.gateway.data.sessions[0];s.state='closed';rt.live=true;
 const calls=[];page.action=async(method,args,after)=>{calls.push({method,args});if(after)after();};
 await page.deleteSession({detail:{id:s.id}});assert.equal(calls.length,1);assert.equal(calls[0].method,'deleteHistory');assert.equal(calls[0].args[1].includeDescendants,false);assert.equal(calls[0].args[1].scope,'platform');
 s.state='running';await page.deleteSession({detail:{id:s.id}});assert.equal(calls.length,1);assert.ok(page.data.error);rt.live=false;
});

test('completed swipe deletion closes before deleting and cancellation makes no request',async t=>{
 const rt=await fixture(t),page=mount('pages/sessions/index.js',rt),s=rt.gateway.data.sessions[0];s.state='completed';rt.live=true;
 const calls=[];rt.ensure=async()=>{};page.action=async(method,args,after)=>{calls.push(method);if(method==='native')s.state='closed';if(after)after();};
 await page.deleteSession({detail:{id:s.id}});assert.deepEqual(calls,['native','deleteHistory']);
 global.wx={showModal:o=>o.success({confirm:false})};await page.deleteSession({detail:{id:s.id}});assert.equal(calls.length,2);rt.live=false;
});

test('purged history tombstones disappear from lists but remain available for sync',async t=>{
 const rt=await fixture(t),s=rt.gateway.data.sessions[0];s.historyState='purged';s.title='History content cleared';s.pinned=true;s.archived=true;
 assert.ok(rt.snapshot().sessions.some(x=>x.id===s.id));assert.ok(!rt.view().sessions.some(x=>x.id===s.id));
 const page=mount('pages/sessions/index.js',rt);
 for(const organization of ['all','pinned','archived']){page.setData({organization});page.refresh();assert.ok(!page.data.list.some(x=>x.id===s.id));}
 const home=mount('pages/home/index.js',rt);home.refresh();assert.ok(!home.data.recent.some(x=>x.id===s.id));
});

test('session restore sends one native resume command and keeps the original ID',async()=>{
 const rt={auth:true,live:true,connection:'online',epoch:1,contentEpoch:1,ensure:async()=>{}},page=mount('pages/session/index.js',rt);page.refresh=()=>{};
 page.data.id='original';page.data.session={id:'original',turnId:'turn',state:'closed',mode:'managed',nodeId:'n',projectId:'p',agentId:'a',node:{online:true},agent:{capabilities:{historyImport:true}}};
 const calls=[];page.action=async(method,args,after)=>{calls.push({method,args});after();};await page.restoreSession();
 assert.deepEqual(calls,[{method:'native',args:['original','turn',{action:'workspace',request:{kind:'resume'}}]}]);assert.equal(page.data.id,'original');assert.equal(page.calls.length,0);
 rt.connection='offline';await page.restoreSession();assert.equal(calls.length,1);
});

test('restore picker never substitutes an unrelated native history',()=>{
 const page=mount('pages/workspace/index.js',{});page.data.restoreSource='original';
 const result={requestKind:'history',view:{title:'History',notice:'',entries:[{id:'one',origin:{sourceSessionId:'other'}},{id:'two',origin:{sourceSessionId:'original'}}],controls:[]}};
 page.showView(result);assert.deepEqual(page.data.entries.map(e=>e.id),['two']);assert.equal(result.view.entries.length,2);
 page.data.restoreSource='missing';page.showView(result);assert.equal(page.data.entries.length,0);assert.equal(page.data.hasOrigins,false);
});

test('restore notice overrides full-width native buttons and has a narrow-screen layout',()=>{
 const css=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/session/index.wxss'),'utf8');
 assert.match(css,/\.session-screen button\.restore-button\{[^}]*width:auto;[^}]*white-space:nowrap/);
 assert.match(css,/@media\(max-width:350px\)\{\s*\.restore-notice\{flex-direction:column/);
});

test('model panel loads automatically and keeps a plain thinking entry',async t=>{
 const rt=await fixture(t);rt.live=true;rt.loadTimeline=async()=>{};
 const p=mount('pages/panel/index.js',rt);p.onLoad({kind:'config',sessionId:rt.gateway.data.sessions[0].id});p.refresh=()=>{};let loads=0;p.loadModels=async()=>{loads++;};await p.onShow();assert.equal(loads,1);
 const wxml=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/panel/index.wxml'),'utf8');assert.ok(!wxml.includes('读取模型目录'));assert.ok(!wxml.includes('thinkingEntry.label'));assert.ok(wxml.includes('选择思考档位<ui-icon'));
 p.data.nativeReason='';p.data.busy=false;p.data.session={capabilities:{workspace:true}};let url;p.open=x=>url=x;p.openThinking();assert.match(url,/kind=thinking$/);url=null;p.data.nativeReason='offline';p.openThinking();assert.equal(url,null);p.onHide();rt.live=false;
});

test('repeated history browsing reuses an exact owned session without creating or sending',async t=>{
 const rt=await fixture(t),page=mount('pages/create/index.js',rt);rt.live=true;
 const a=rt.gateway.data.agents.find(a=>a.state==='ready');a.capabilities.historyImport=true;
 page.onLoad({agentId:a.id});page.refresh();
 const context={nodeId:page.data.nodeId,projectId:page.data.projectId,agentId:page.data.agentId,capabilities:{workspace:true}};
 const oldView=rt.view.bind(rt);rt.view=()=>({...oldView(),sessions:[{...context,id:'closed',state:'closed'},{...context,id:'other',projectId:'another',state:'completed'},{...context,id:'original',state:'completed'}]});

 page.action=()=>{throw Error('Browsing must not issue a create command')};page.browseHistory();page.browseHistory();
 assert.deepEqual(page.calls.filter(x=>x.method==='redirectTo').map(x=>x.arg.url),Array(2).fill('/pages/workspace/index?kind=history&nodeId='+page.data.nodeId+'&projectId='+page.data.projectId+'&agentId='+page.data.agentId));rt.live=false;
});

test('optional new task leaves the native prompt absent when empty',async t=>{
 const rt=await fixture(t),page=mount('pages/create/index.js',rt);page.onLoad({});page.refresh();let input;page.action=(method,args)=>input=args[0];
 page.setData({prompt:'   '});page.submit();assert.equal(input.historyOnly,true);assert.equal(Object.hasOwn(input,'prompt'),false);
 page.setData({prompt:'do work'});page.submit();assert.equal(input.prompt,'do work');assert.equal(Object.hasOwn(input,'historyOnly'),false);
 const source=fs.readFileSync(path.join(__dirname,'../miniprogram/pages/workspace/index.wxml'),'utf8');assert.equal(source.includes('originPrompt'),false);
});

test('guide offers both installer commands and copies only the selected platform',()=>{
 const p=mount('pages/guide/index.js',{});assert.ok(p.data.installCommand.includes('Invoke-WebRequest'));p.copyInstall();assert.equal(p.calls.at(-1).arg.data,p.data.installCommand);
 p.selectPlatform({currentTarget:{dataset:{platform:'posix'}}});assert.ok(p.data.installCommand.includes('curl -fsSL'));p.copyInstall();assert.equal(p.calls.at(-1).arg.data,p.data.installCommand);
 const saved=p.data.installCommand;p.selectPlatform({currentTarget:{dataset:{platform:'unknown'}}});assert.equal(p.data.installCommand,saved);
 p.selectPlatform({currentTarget:{dataset:{platform:'windows'}}});assert.ok(p.data.installCommand.includes('https://agent.000.moe/downloads/node/install.mjs'));
});

test('guide pagination is bounded and preserves platform selection',()=>{
 const p=mount('pages/guide/index.js',{});p.previous();assert.equal(p.data.step,0);p.selectPlatform({currentTarget:{dataset:{platform:'posix'}}});
 p.next();assert.equal(p.data.step,1);p.next();assert.equal(p.data.step,2);p.previous();assert.equal(p.data.step,1);assert.equal(p.data.installPlatform,'posix');
 p.next();let finished=false;p.finish=()=>{finished=true;};p.next();assert.equal(p.data.step,3);assert.equal(finished,false);p.next();assert.equal(p.data.step,4);assert.equal(finished,false);p.next();assert.equal(finished,true);assert.equal(p.data.step,4);
});
