const test=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const {Runtime}=require('../miniprogram/services/runtime'); const {FakeGateway}=require('../miniprogram/services/fake-gateway');
const {mount}=require('./helpers');
async function setup(t,id='demo-input') {
  const rt=new Runtime(new FakeGateway({delay:1}));await rt.login();t.after(()=>rt.dispose());
  const page=mount('pages/request/index.js',rt);page.onLoad({id});page.refresh();return {rt,page};
}
test('request restores full cards inside a native scroll-view with a persistent footer',()=>{
  const base=path.resolve(__dirname,'../miniprogram/pages/request');
  assert.equal(require(path.join(base,'index.json')).disableScroll,true);
  const source=fs.readFileSync(path.join(base,'index.wxml'),'utf8');
  const styles=fs.readFileSync(path.join(base,'index.wxss'),'utf8');
  assert.match(source,/<scroll-view class="request-main"[^>]*scroll-y="\{\{true\}\}"/);
  assert.ok(source.indexOf('</scroll-view>')<source.indexOf('class="request-footer"'));
  assert.ok(source.includes('class="request-footer"'));
  assert.ok(source.indexOf('class="request-footer"')<source.indexOf('bindtap="submit"'));
  assert.ok(source.indexOf('class="request-footer"')<source.indexOf('bindtap="approve"'));
  assert.ok(source.includes('class="answer-textarea"'));assert.ok(source.includes('bindkeyboardheightchange="keyboard"'));
  for(const field of ['设备','项目','Agent','会话'])assert.ok(source.includes('>'+field+'</text>'));
  assert.match(styles,/\.request-main\{[^}]*height:0/);
  assert.match(styles,/\.request-footer\{[^}]*flex-shrink:0/);
  assert.match(styles,/\.question-field\{[^}]*border-radius:28rpx/);
  assert.doesNotMatch(styles,/#080907|#c2ceb5|#879879|\.keyboard-open[^}]*request-context[^}]*display:none/);
  assert.doesNotMatch(source,/\?{2,}|\uFFFD/);
});
test('context helper preserves full device/project/session/action information without responding',async t=>{
  const {rt,page}=await setup(t,'demo-approval');page.context();
  const modal=page.calls.find(call=>call.method==='showModal');assert.ok(modal);
  for(const value of ['MacBook Pro','喵连 Frontend','Codex','优化会话列表与状态展示','更新 pages/sessions/index.wxss','本次文件修改'])assert.ok(modal.arg.content.includes(value));
  assert.equal(modal.arg.showCancel,false);assert.equal(rt.gateway.operations.size,0);
  assert.equal(rt.gateway.data.requests[0].state,'pending');
});
test('keyboard keeps the focused answer reachable without changing the answer or context',async t=>{
  const {rt,page}=await setup(t);page.keyboard({detail:{height:300}});assert.equal(page.data.keyboardHeight,300);
  page.keyboard({detail:{height:-10}});assert.equal(page.data.keyboardHeight,0);
  rt.preferences.largeText=true;page.refresh();assert.equal(page.data.preferences.largeText,true);
  page.answer({currentTarget:{dataset:{id:'demo-q2'}},detail:{value:'我的回答'}});
  page.focusAnswer({currentTarget:{dataset:{id:'demo-q2'}}});page.keyboard({detail:{height:280}});
  assert.equal(page.data.scrollTarget,'question-demo-q2');
  assert.equal(page.data.answers['demo-q2'],'我的回答');assert.equal(rt.gateway.operations.size,0);
  assert.equal(page.data.session.node.name,'MacBook Pro');
  page.keyboard({detail:{height:0}});assert.equal(page.data.scrollTarget,'');
});
test('context cannot display a removed request using stale page data',async t=>{
  const {rt,page}=await setup(t);rt.gateway.data.requests=[];page.context();
  assert.equal(page.data.request,null);assert.equal(page.calls.some(call=>call.method==='showModal'),false);
});
