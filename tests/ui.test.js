const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const { Runtime } = require('../miniprogram/services/runtime'); const { FakeGateway } = require('../miniprogram/services/fake-gateway');
const { capability, controlReason, requestReason } = require('../miniprogram/utils/policy');
const { mount } = require('./helpers');
async function runtime(t) { const rt = new Runtime(new FakeGateway({ delay: 1 })); await rt.login(); t.after(() => rt.dispose()); return rt; }

test('喵连 product branding uses the supplied icon without changing live storage or protocol', () => {
  const root = path.join(__dirname, '../miniprogram');
  assert.equal(require('../miniprogram/app.json').window.navigationBarTitleText, '喵连');
  assert.equal(require('../project.config.json').projectname, '喵连');
  for (const route of ['home', 'login']) {
    assert.equal(require('../miniprogram/pages/' + route + '/index.json').navigationBarTitleText, '喵连');
  }
  const login = fs.readFileSync(path.join(root, 'pages/login/index.wxml'), 'utf8');
  assert.match(login, />喵连</);
  assert.match(login, /class="orbit orbit-one"/);
  assert.match(login, /class="orbit orbit-two"/);
  assert.match(login, /<activity-mark active="\{\{pageActive\}\}" size="large"\/>/);
  assert.doesNotMatch(login, />GoLink</);
  assert.match(login, /class="welcome-heading">你的想法，<\/view><view class="welcome-heading muted-heading">值得立即实现。<\/view>/);
  assert.doesNotMatch(login, /灵感不等人|工作不限地点/);
  const about = fs.readFileSync(path.join(root, 'pages/about/index.wxml'), 'utf8');
  assert.match(about, /class="about-name">喵连</);
  assert.match(about, /src="\/assets\/golink.png"/);
  const profile = fs.readFileSync(path.join(root, 'pages/me/index.wxml'), 'utf8');
  assert.match(profile, /src="\{\{avatarPath\}\}"/);
  assert.match(profile, /aria-label="用户头像"/);
  assert.doesNotMatch(profile, /golink.png|profile-logo/);
  const avatar = fs.readFileSync(path.join(root, 'assets/default-avatar.png'));
  assert.equal(avatar.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(avatar.readUInt32BE(16), 256);
  assert.equal(avatar.readUInt32BE(20), 256);
  const icon = fs.readFileSync(path.join(root, 'assets/golink.png'));
  assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
  assert.equal(require('../miniprogram/utils/appearance').STORAGE, 'weagent:appearance:v1');
  assert.equal(require('../miniprogram/config').gatewayURL, 'https://agent.000.moe');
});

test('shared-with-me list header has no theme toggle', () => {
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/shared/index.wxml'), 'utf8');
  const list = template.split('<view wx:elif="{{!id}}"')[1].split('<view wx:else class="shared-screen"')[0];
  assert.doesNotMatch(list, /showThemes|name="palette"/);
  assert.match(list, /SHARED WITH YOU/);
  assert.match(list, /bindtap="retry"/);
});

test('session and inbox empty states use matching readable visuals without a duplicate create action', () => {
  const read = route => fs.readFileSync(path.join(__dirname, '../miniprogram/pages', route, 'index.wxml'), 'utf8');
  const sessions = read('sessions'), inbox = read('inbox');
  assert.doesNotMatch(sessions, /开始新任务/);
  assert.match(sessions, /data-url="\/pages\/create\/index"/);
  assert.match(sessions, /bindtap="resetFilters">清除筛选/);
  for (const template of [sessions, inbox]) {
    assert.match(template, /class="list-empty"/);
    assert.match(template, /class="list-empty-icon"><ui-icon name="[^"]+" size="\{\{52\}\}"/);
    assert.match(template, /class="list-empty-title"/);
  }
  assert.doesNotMatch(inbox, /新的审批和提问会出现在这里/);
  assert.match(inbox, /class="list-empty-icon"><ui-icon name="bell" size="\{\{52\}\}" tone="accent" \/><\/view><view class="list-empty-title">暂无通知/);
  assert.ok(require('../miniprogram/utils/icon-source').source('bell', 'ember', 'accent'));
  assert.doesNotMatch(inbox, /class="compact-empty">暂无通知/);
});

test('theme picker shows all options without an internal scroll container', () => {
  const root = path.join(__dirname, '../miniprogram/components/theme-switcher');
  const wxml = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'index.wxss'), 'utf8');
  assert.doesNotMatch(wxml, /scroll-view|scroll-y/);
  assert.match(wxml, /class="theme-content"/);
  assert.doesNotMatch(wxss, /height:730rpx/);
  assert.match(wxss, /@media\(max-height:440px\)/);
  assert.equal(require('../miniprogram/utils/appearance').THEMES.length, 6);
});

test('login page only requests WeChat authentication without fallback', async () => {
  const modes = [];
  const page = mount('pages/login/index.js', {login: async mode => { modes.push(mode); throw new Error('微信认证服务暂不可用'); }});
  assert.equal(page.data.primaryLabel, '微信登录');
  await page.enter();
  assert.deepEqual(modes, ['wechat']);
  assert.equal(page.data.busy, false);
  assert.equal(page.data.error, '错误码：UNKNOWN_ERROR');
  assert.equal(page.enterWechat, undefined);
  const template = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/login/index.wxml'), 'utf8');
  assert.doesNotMatch(template, /wechatFallback|enterWechat|本地登录/);
  assert.doesNotMatch(template, /privacy-line|设备由你授权，操作由你决定/);
  const config = require('../miniprogram/config');
  assert.equal(config.authMode, 'wechat');
  assert.equal(config.developmentIdentity, undefined);
});

test('guide secondary actions are separated from the primary button', () => {
  const css = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/guide/index.wxss'), 'utf8');
  assert.match(css, /\.guide-secondary\s*\{[^}]*gap:18rpx[^}]*margin-bottom:20rpx/);
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/guide/index.wxml'), 'utf8');
  assert.ok(wxml.indexOf('class="guide-secondary"') < wxml.indexOf('bindtap="next"'));
});
test('capability decisions depend on metadata, never brand', () => {
  assert.equal(capability({ name: 'Codex', capabilities: { plan: false } }, 'plan'), false);
  assert.equal(capability({ name: 'Unknown Agent', capabilities: { plan: true } }, 'plan'), true);
  assert.equal(capability({ name: 'Claude Code' }, 'approval'), false);
});
test('session header keeps task state separate from node connectivity and disables control offline', async t => {
  const rt = await runtime(t); const page = mount('pages/session/index.js', rt);
  page.onLoad({ id: 'demo-review' }); page.refresh(); assert.equal(page.data.canCancel, true);
  rt.gateway.setOnline('demo-mac', false); page.refresh();
  assert.equal(page.data.session.state, 'waiting_approval'); assert.equal(page.data.canCancel, false); assert.match(page.data.sendReason, /离线/);
  const opCount = rt.gateway.operations.size; page.send(); assert.equal(rt.gateway.operations.size, opCount);
});
test('expired approval page renders a reason and cannot submit', async t => {
  const rt = await runtime(t); rt.gateway.data.requests[0].expiresAt = 0;
  const page = mount('pages/request/index.js', rt); page.onLoad({ id: 'demo-approval' }); page.refresh();
  assert.match(page.data.reason, /过期/); page.approve({ currentTarget: { dataset: { choice: 'demo-allow-once' } } }); assert.equal(rt.gateway.operations.size, 0);
});
test('composer drafts are scoped to a session and quote appends instead of overwriting', async t => {
  const rt = await runtime(t); const page = mount('pages/session/index.js', rt); page.onLoad({ id: 'demo-review' });
  page.input({ detail: { value: '我的草稿' } }); page.quote({ detail: { text: '已有消息' } });
  assert.equal(rt.draft('demo-review'), '我的草稿\n> 已有消息\n'); assert.equal(rt.draft('demo-question'), '');
});
test('tool and diff cards emit intent, expand safely and copy without executing content', async t => {
  const rt = await runtime(t); const component = mount('components/event-card/index.js', rt, true);
  component.data.item = { type: 'tool', text: 'summary', detail: '$(never execute) <script>unsafe()</script>' };
  component.toggle(); assert.equal(component.data.expanded, true); component.copy();
  assert.equal(component.calls[0].method, 'setClipboardData'); assert.equal(component.calls[0].arg.data, component.data.item.detail);
  component.data.item = { type: 'diff', panel: 'diff', key: 'turn:diff' }; component.open();
  assert.deepEqual(component.calls[1].detail.item, component.data.item); assert.equal(rt.gateway.operations.size, 0);
});
test('approval card navigation preserves the exact request identity', async t => {
  const rt = await runtime(t); const page = mount('pages/session/index.js', rt);
  page.openEvent({ detail: { item: { type: 'approval', requestId: 'demo-approval' } } });
  assert.equal(page.calls[0].arg.url, '/pages/request/index?id=demo-approval');
});
test('every configured page can load with missing resources without crashing', async t => {
  const rt = await runtime(t); const app = require('../miniprogram/app.json');
  for (const route of app.pages) {
    const page = mount(route + '.js', rt); if (page.onLoad) page.onLoad({ id: 'missing', sessionId: 'missing', fileId: 'missing', kind: 'plan' });
    if (page.refresh) page.refresh();
    if (page.onUnload) page.onUnload();
  }
});
test('request loading failure stays visible and a missing session cannot show old content', async t => {
  const rt = await runtime(t); const page = mount('pages/session/index.js', rt); page.onLoad({ id: 'demo-review' }); page.refresh();
  assert.ok(page.data.items.length); rt.gateway.data.sessions = []; page.refresh();
  assert.equal(page.data.session, null); assert.deepEqual(page.data.items, []); assert.equal(page.data.draft, '');
});
test('all 194 requirement identities have an explicit entry and integration status', () => {
  const rows = require('../miniprogram/catalog/requirements'); assert.equal(rows.length, 194); assert.equal(new Set(rows.map(r => r.id)).size, 194);
  rows.forEach(r => { assert.ok(r.entry); assert.ok(r.criterion); assert.ok(['未逐项验收', '未接入', '部分实现', '扩展规划', '已接入待验收'].includes(r.status)); });
});
test('only display preferences are persisted; no session bodies or credentials in storage writes', () => {
  const base = path.resolve(__dirname, '../miniprogram'); const files = [];
  const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(folder, e.name)) : e.name.endsWith('.js') && files.push(path.join(folder, e.name)));
  walk(base); const writes = files.filter(f => /setStorageSync|setStorage\(/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(writes.map(f => path.relative(base, f)), [path.join('pages', 'settings', 'index.js'), path.join('utils','appearance.js'), path.join('utils','onboarding.js')]);
});
test('a disappearing selected device never silently moves a draft task to another host', async t => {
  const rt = await runtime(t); const page = mount('pages/create/index.js', rt);
  page.onLoad({ nodeId: 'demo-mac', projectId: 'demo-web' }); page.refresh();
  rt.gateway.setOnline('demo-mac', false); page.refresh();
  assert.equal(page.data.nodeId, 'demo-mac'); assert.equal(page.data.ready, false);
  rt.gateway.data.nodes = rt.gateway.data.nodes.filter(n => n.id !== 'demo-mac'); page.refresh();
  assert.equal(page.data.nodeId, 'demo-mac'); assert.equal(page.data.projectId, 'demo-web'); assert.equal(page.data.ready, false);
});
test('unsupported plan capability hides the action while keeping capability records available', async t => {
  const rt = await runtime(t); rt.gateway.data.agents[0].capabilities.plan = false;
  const page = mount('pages/panel/index.js', rt); page.onLoad({ kind: 'menu', sessionId: 'demo-review' }); page.refresh();
  assert.equal(page.data.menu.some(m => m.kind === 'plan'), false);
  assert.ok(require('../miniprogram/catalog/requirements').some(r => r.id === 'L01'));
});
