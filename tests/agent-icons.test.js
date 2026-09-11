const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { agentIcon } = require('../miniprogram/utils/agent-brand');
const { Runtime } = require('../miniprogram/services/runtime');
const { FakeGateway } = require('../miniprogram/services/fake-gateway');
const { mount } = require('./helpers');

test('agent names select local SVGs, unknown names cannot create asset paths', () => {
  for (const [name, brand] of [['Codex','codex'],[' OpenAI Codex ','codex'],['Claude','claude'],['Claude Code','claude'],['PI','pi'],['Pi Coding Agent','pi']]) {
    assert.equal(agentIcon({name}),`/assets/agents/${brand}.svg`);
  }
  for (const name of ['', 'Another Agent', '../codex', 'constructor', '__proto__', 'https://example.com/logo.svg']) {
    assert.equal(agentIcon({name}),'/assets/agents/generic.svg');
  }
  assert.equal(agentIcon(null),'/assets/agents/generic.svg');
});

test('brand assets are self-contained vectors, not embedded bitmaps or letter placeholders', () => {
  for (const brand of ['codex','claude','pi','generic']) {
    const source=fs.readFileSync(path.resolve(__dirname,`../miniprogram/assets/agents/${brand}.svg`),'utf8');
    assert.match(source,/<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(source,/viewBox="[\d. -]+"/); assert.match(source,/<path\b/);
    assert.doesNotMatch(source,/<(?:script|image|text|foreignObject)\b|(?:href|onload)\s*=|url\(|currentColor/i);
  }
  for (const route of ['components/session-card','pages/session','pages/create','pages/agent','pages/node']) {
    const source=fs.readFileSync(path.resolve(__dirname,`../miniprogram/${route}/index.wxml`),'utf8');
    assert.match(source,/<image\b[^>]*class="agent-logo/);
    assert.doesNotMatch(source,/\.(?:initial|letter)\b/);
  }
});

test('brand decoration leaves source data and runtime capabilities unchanged', async t => {
  const rt = new Runtime(new FakeGateway({delay:1})); t.after(()=>rt.dispose()); await rt.login();
  const original=JSON.parse(JSON.stringify(rt.gateway.data.agents));
  const view=rt.view();
  for (const agent of view.agents) {
    assert.equal(agent.icon,agentIcon(agent));
    assert.deepEqual(agent.capabilities,original.find(item=>item.id===agent.id).capabilities);
  }
  for (const session of view.sessions) assert.equal(session.agent.icon,agentIcon(session.agent));
  assert.deepEqual(rt.gateway.data.agents,original);
  assert.ok(rt.snapshot().agents.every(agent=>!Object.hasOwn(agent,'icon')));
});

test('CLI message menus are hidden initially and preserve copy/quote without submitting', async t => {
  const rt = new Runtime(new FakeGateway({delay:1})); t.after(()=>rt.dispose()); await rt.login();
  const component=mount('components/event-card/index.js',rt,true);
  assert.equal(component.data.actionsVisible,false);
  for (const type of ['tool','approval','question']) {
    component.data.item={type}; component.toggleActions(); assert.equal(component.data.actionsVisible,false);
  }
  for (const type of ['user','assistant','result']) {
    component.data.item={type,text:'只复制文本，不执行命令'};
    component.toggleActions(); assert.equal(component.data.actionsVisible,true);
    component.copy(); component.quote();
    assert.deepEqual(component.calls.at(-2),{method:'setClipboardData',arg:{data:component.data.item.text}});
    assert.deepEqual(component.calls.at(-1),{method:'event',name:'quote',detail:{text:component.data.item.text}});
    component.toggleActions(); assert.equal(component.data.actionsVisible,false);
  }
  assert.equal(rt.gateway.operations.size,0);
});

test('terminal templates retain readable UTF-8 labels and CLI interactions', () => {
  const read=route=>fs.readFileSync(path.resolve(__dirname,`../miniprogram/${route}/index.wxml`),'utf8');
  const session=read('pages/session'),event=read('components/event-card');
  assert.doesNotMatch(session+event,/\?{2,}|\uFFFD/,'Unicode labels must not be lost through shell encoding');
  for (const label of ['对话','变更','描述下一步','停止本轮','快捷命令','作为文本发送']) assert.ok(session.includes(label));
  for (const label of ['复制','引用','展开工具输出','收起工具输出','审阅请求']) assert.ok(event.includes(label));
  assert.match(session,/agent="{{session\.agent}}"/);
  assert.match(event,/actionsVisible/);
});
