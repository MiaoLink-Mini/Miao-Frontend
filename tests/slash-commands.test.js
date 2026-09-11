const test=require('node:test'); const assert=require('node:assert/strict');
const {suggestions}=require('../miniprogram/utils/slash-commands');
const {Runtime}=require('../miniprogram/services/runtime');
const {FakeGateway}=require('../miniprogram/services/fake-gateway');
const {mount}=require('./helpers');
const names=match=>match.items.map(item=>item.name);
const input=(page,value)=>page.input({detail:{value}});
const choose=(page,name)=>page.chooseCommand({currentTarget:{dataset:{name}}});
async function setup(t,id='demo-review') {
  const rt=new Runtime(new FakeGateway({delay:1})); t.after(()=>rt.dispose()); await rt.login();
  const page=mount('pages/session/index.js',rt); page.onLoad({id}); page.refresh();
  return {rt,page};
}

test('slash suggestions filter prefixes and Chinese keywords without matching prose or paths', () => {
  const session={agent:{capabilities:{plan:true,diff:true,usage:true,queue:true}}};
  assert.deepEqual(names(suggestions('/',session)),['help','plan','diff','usage','queue','latest']);
  assert.deepEqual(names(suggestions('/pl',session)),['plan']);
  assert.deepEqual(names(suggestions('/计划',session)),['plan']);
  assert.equal(suggestions('/DIFF ',session).command.name,'diff');
  for(const text of ['', ' ', '解释 /plan', 'https://host/path', '/usr/local', '/plan 执行任务', '/plan\n', '> /plan']) {
    assert.equal(suggestions(text,session).query,null,text);
  }
  assert.deepEqual(names(suggestions('/not-a-command',session)),[]);
  assert.equal(suggestions('/',null).query,null);
});

test('command availability follows capabilities and read-only mode, never Agent brand', () => {
  assert.deepEqual(names(suggestions('/',{agent:{name:'Codex',capabilities:{}}})),['help','latest']);
  assert.ok(names(suggestions('/',{agent:{name:'Another Agent',capabilities:{plan:true}}})).includes('plan'));
  assert.equal(suggestions('/',{mode:'readonly',agent:{}}).query,null);
});

test('selecting a prediction only completes the draft; running it opens the exact local session panel', async t => {
  const {rt,page}=await setup(t);
  input(page,'/'); assert.equal(page.data.slashOpen,true);
  input(page,'/pl'); assert.deepEqual(page.data.slashItems.map(item=>item.name),['plan']);
  choose(page,'plan');
  assert.equal(page.data.draft,'/plan'); assert.equal(rt.draft('demo-review'),'/plan');
  assert.equal(page.data.slashOpen,false); assert.equal(page.data.slashCommand.name,'plan');
  assert.equal(page.calls.length,0); assert.equal(rt.gateway.operations.size,0);
  page.send();
  assert.deepEqual(page.calls[0],{method:'navigateTo',arg:{url:'/pages/panel/index?kind=plan&sessionId=demo-review'}});
  assert.equal(rt.draft('demo-review'),''); assert.equal(page.data.draft,''); assert.equal(rt.gateway.operations.size,0);
});

test('partial slash submission completes first, and unknown commands require explicit literal mode', async t => {
  const {rt,page}=await setup(t);
  input(page,'/di'); page.send(); assert.equal(page.data.draft,'/diff'); assert.equal(page.calls.length,0);
  input(page,'/not-a-command'); page.send(); assert.equal(page.data.sendDisabled,true); assert.equal(page.calls.length,0);
  const actions=[]; page.action=(method,args)=>actions.push({method,args});
  page.dismissCommands(); assert.equal(page.data.slashOpen,false); assert.equal(page.data.sendDisabled,true);
  page.literalCommand(); assert.equal(page.data.slashOpen,false); assert.equal(page.data.sendDisabled,false);
  page.send(); assert.equal(actions.length,1); assert.equal(actions[0].method,'send');
  assert.equal(actions[0].args[2],'/not-a-command'); assert.equal(actions[0].args[3],'queue');
  assert.equal(rt.gateway.operations.size,0);
  input(page,'/plan'); page.literalCommand(); page.send(); assert.equal(actions[1].args[2],'/plan');
});

test('capability changes, busy state, unknown receipts and revoked sessions cannot turn shortcuts into remote sends', async t => {
  const {rt,page}=await setup(t); const actions=[]; page.action=(...args)=>actions.push(args);
  input(page,'/plan'); choose(page,'plan');
  rt.gateway.data.agents.find(agent=>agent.id==='demo-codex').capabilities.plan=false;
  page.send(); assert.equal(page.data.sendDisabled,true); assert.equal(page.calls.length,0);
  for(const field of ['busy','unknown']) {
    page.data[field]=true; input(page,'/help'); page.send(); assert.equal(page.data.slashOpen,false); assert.equal(page.calls.length,0); page.data[field]=false;
  }
  rt.gateway.data.sessions=rt.gateway.data.sessions.filter(session=>session.id!=='demo-review');
  page.send(); assert.equal(page.data.session,null); assert.equal(page.data.slashOpen,false); assert.equal(page.data.sendDisabled,true);
  assert.deepEqual(actions,[]); assert.equal(rt.gateway.operations.size,0);
});

test('read-only local shortcuts remain distinct from offline remote control', async t => {
  const {rt,page}=await setup(t); rt.gateway.setOnline('demo-mac',false); page.refresh();
  input(page,'普通任务'); assert.equal(page.data.sendDisabled,true);
  input(page,'/usage'); assert.equal(page.data.sendDisabled,false); page.send();
  assert.equal(page.calls[0].arg.url,'/pages/panel/index?kind=usage&sessionId=demo-review');
  assert.equal(rt.gateway.operations.size,0);
});

test('command trigger preserves existing prose and quotes, while latest is local only', async t => {
  const {rt,page}=await setup(t,'demo-complete');
  input(page,'未完成的草稿'); page.showCommands(); assert.equal(page.data.draft,'未完成的草稿');
  input(page,'/'); page.quote({detail:{text:'引用的内容'}}); assert.equal(page.data.slashOpen,false);
  input(page,''); page.showCommands(); assert.equal(page.data.draft,'/'); assert.equal(page.data.slashOpen,true);
  assert.equal(page.data.slashItems.some(item=>item.name==='queue'),false);
  input(page,'/latest'); page.data.following=false; page.send();
  assert.equal(page.data.following,true); assert.equal(page.data.scrollTarget,'latest'); assert.equal(rt.gateway.operations.size,0);
  input(page,'   '); assert.equal(page.data.sendDisabled,true);
  page.keyboard({detail:{height:300}}); assert.equal(page.data.keyboardHeight,300); assert.ok(page.data.slashMaxHeight<=140);
  page.keyboard({detail:{height:0}}); assert.equal(page.data.slashMaxHeight,260);
});
