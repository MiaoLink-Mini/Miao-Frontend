const test=require('node:test'),assert=require('node:assert/strict');
const {suggestions}=require('../miniprogram/utils/slash-commands');
const {LiveGateway}=require('../miniprogram/services/live-gateway');
const {validate}=require('../miniprogram/services/wire');
const {Runtime}=require('../miniprogram/services/runtime');
const {FakeGateway}=require('../miniprogram/services/fake-gateway');
const {mount}=require('./helpers');

test('model and compact shortcuts are explicit capabilities, not native string passthrough',()=>{
  const session={capabilities:{models:true,compact:false}};
  assert.equal(suggestions('/model',session).command.panel,'config');
  assert.equal(suggestions('/model',session).command.remote,true);
  assert.equal(suggestions('/compact',session).items.length,0);
  assert.equal(suggestions('/model arbitrary',session).query,null);
  session.capabilities.compact=true;assert.equal(suggestions('/compact',session).command.panel,'compact');
});
test('live native controls preserve turn/revision/key and return typed results rather than session objects',async()=>{
  const gateway=new LiveGateway(),calls=[];gateway.lookup=()=>({capabilityRevision:7});
  gateway.issue=(path,body,schema,id)=>{validate(schema,body);calls.push({path,body,id});};
  gateway.native('s','t',{action:'set_model',modelId:'model'},'operation');
  assert.deepEqual(calls,[{path:'/sessions/s/native',body:{expectedTurnId:'t',capabilityRevision:7,control:{action:'set_model',modelId:'model'}},id:'operation'}]);
  assert.throws(()=>gateway.native('s','t',{action:'shell',command:'x'},'o'));
  gateway.ensure=async(type,id)=>{assert.equal(type,'sessions');assert.equal(id,'s');};
  const native={action:'compact',status:'started'};assert.deepEqual(await gateway.operationResult({kind:'native',result:{sessionId:'s',native}}),native);
  const op={id:'op',kind:'native',state:'confirmed',createdAt:'2026-09-06T00:00:00Z',updatedAt:'2026-09-06T00:00:00Z',deadlineAt:'2026-09-06T00:01:00Z',revision:1,error:null,result:{sessionId:'s',turnId:'t',requestId:null,nodeId:'n',queueItemId:null}};
  assert.throws(()=>validate('Operation',op),'native confirmation requires typed result');op.result.native=native;validate('Operation',op);
});
test('native panel fences offline, running, unsupported and unknown states; changing turn clears model catalog',async t=>{
  const rt=new Runtime(new FakeGateway({delay:1}));t.after(()=>rt.dispose());await rt.login();
  const session=rt.gateway.data.sessions.find(s=>s.id==='demo-complete');session.capabilities={models:true,compact:true};
  rt.live=true;
  const page=mount('pages/panel/index.js',rt);page.onLoad({kind:'config',sessionId:session.id});page.refresh();
  const calls=[];page.action=(method,args,after)=>{calls.push({method,args});after({action:'models',models:[{id:'m',label:'Native'}],selected:null,truncated:false});};
  page.loadModels();assert.equal(calls.length,1);assert.equal(calls[0].method,'native');assert.equal(page.data.models[0].id,'m');
  page.data.unknown=true;page.loadModels();assert.equal(calls.length,1);page.data.unknown=false;
  rt.connection='offline';page.loadModels();assert.equal(calls.length,1);rt.connection='online';
  session.state='running';page.loadModels();assert.equal(calls.length,1);session.state='completed';
  session.turnId='new';page.refresh();assert.equal(page.data.models.length,0);assert.equal(page.data.modelsLoaded,false);
  session.capabilities.models=false;page.loadModels();assert.equal(calls.length,1);
});
