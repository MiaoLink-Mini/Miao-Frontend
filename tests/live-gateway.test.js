const test = require('node:test');
const assert = require('node:assert');
const { Runtime } = require('../miniprogram/services/runtime');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const { projectEvent, normalize } = require('../miniprogram/services/wire');
const { mergeEvents, emptyTimeline } = require('../miniprogram/stores/timeline');
const { mount, wait } = require('./helpers');

const ISO = '2026-09-06T10:00:00Z';
function operation(overrides = {}) {
  return Object.assign({
    id: 'op_' + 'a'.repeat(32), kind: 'send', state: 'accepted', createdAt: ISO, updatedAt: ISO,
    deadlineAt: '2026-09-06T10:05:00Z', result: null, error: null, revision: 1
  }, overrides);
}
function capabilities() {
  return { send: true, cancel: true, approval: true, question: true, diff: true, plan: true, usage: true, queue: false, steer: false };
}
function node(overrides = {}) {
  return Object.assign({ id: 'node_1', name: 'Fake workspace Host', platform: 'macos', version: 'fake/1', online: true, lastSeen: ISO, revoked: false, revision: 1 }, overrides);
}
function session(overrides = {}) {
  return Object.assign({
    id: 'sess_1', nodeId: 'node_1', projectId: 'proj_1', agentId: 'agent_1', title: '联调会话', state: 'idle',
    turnId: null, mode: 'managed', capabilities: capabilities(),
    capabilityRevision: 1, queue: [], createdAt: ISO, updatedAt: ISO, revision: 1, lastSequence: 0, historyState: 'available'
  }, overrides);
}

test('projectEvent 把 item.upsert 投影为 weagent-view/1 卡片并归一化 null turnId', () => {
  const event = {
    version: 'weagent/1', id: 'evt_1', sessionId: 'sess_1', turnId: null, sequence: 3, createdAt: ISO,
    type: 'item.upsert',
    data: { type: 'message', itemId: 'item_1', turnId: 'turn_1', role: 'assistant', text: '你好', complete: true, truncated: false }
  };
  const view = projectEvent(event);
  assert.equal(view.version, 'weagent-view/1');
  assert.equal(view.type, 'card.upsert');
  assert.equal(view.turnId, 'turn_1');
  assert.equal(view.data.type, 'assistant');
  assert.equal(view.data.text, '你好');
});

test('projectEvent 把元数据事件投影为 view.noop 且保留 null turnId', () => {
  const event = {
    version: 'weagent/1', id: 'evt_2', sessionId: 'sess_1', turnId: null, sequence: 4, createdAt: ISO,
    type: 'session.state', data: { revision: 2, state: 'running', turnId: null }
  };
  const view = projectEvent(event);
  assert.equal(view.type, 'view.noop');
  assert.equal(view.turnId, null);
});

test('timeline 接受 weagent-view/1 事件、跳过 view.noop 并推进游标', () => {
  const events = [
    { version: 'weagent-view/1', id: 'evt_1', sessionId: 's1', turnId: 't1', sequence: 1, type: 'card.upsert', data: { type: 'user', itemId: 'i1', title: '你', text: '任务' } },
    { version: 'weagent-view/1', id: 'evt_2', sessionId: 's1', turnId: '', sequence: 2, type: 'view.noop', data: {} },
    { version: 'weagent-view/1', id: 'evt_3', sessionId: 's1', turnId: 't1', sequence: 3, type: 'message.completed', data: { itemId: 'i2', text: '完成' } }
  ];
  const state = mergeEvents(emptyTimeline('s1'), events);
  assert.equal(state.cursor, 3);
  assert.equal(state.items.length, 2);
  assert.equal(state.gap, null);
  assert.equal(state.warnings.length, 0);
});

test('LiveGateway 拒绝非本机 HTTP 地址，允许 HTTPS 与本机联调地址', () => {
  assert.throws(() => new LiveGateway({ gatewayURL: 'http://192.168.1.5:18080' }), e => e.code === 'LIVE_NOT_CONFIGURED');
  assert.doesNotThrow(() => new LiveGateway({ gatewayURL: 'https://gateway.example.com', wx: {} }));
  assert.doesNotThrow(() => new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: {} }));
});

function wxMock(handlers = {}) {
  const state = { requests: [] };
  return {
    state,
    getRandomValues(opts) {
      if (handlers.getRandomValuesFail) return opts.fail(new Error('no crypto'));
      const buf = new ArrayBuffer(opts.length || 16); new Uint8Array(buf).forEach((_, i, a) => a[i] = (i + 1) % 251);
      opts.success({ randomValues: buf });
    },
    request(opts) {
      state.requests.push(opts);
      const respond = handlers.respond || (r => r({ statusCode: 200, data: {}, header: {} }));
      respond(opts);
    },
    getDeviceInfo() { return { platform: 'devtools' }; },
    login(opts) { if (handlers.loginFail) return opts.fail(new Error('cancel')); opts.success({ code: 'devtools-code-1' }); },
    connectSocket() { throw new Error('not used in these tests'); }
  };
}

test('LiveGateway.id 通过 wx.getRandomValues 生成合法 Id，失败时报 CRYPTO_UNAVAILABLE', async () => {
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: wxMock() });
  const id = await gw.id('op');
  assert.match(id, /^op_[0-9a-f]{32}$/);
  const bad = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: wxMock({ getRandomValuesFail: true }) });
  await assert.rejects(() => bad.id('op'), e => e.code === 'CRYPTO_UNAVAILABLE');
});

test('LiveGateway.id 兼容跨 realm 的 ArrayBuffer（开发者工具场景）', async () => {
  const cross = wxMock();
  cross.getRandomValues = opts => {
    const sab = require('node:vm').runInNewContext('new ArrayBuffer(16)'); new Uint8Array(sab).forEach((_, i, a) => a[i] = 9);
    opts.success({ randomValues: sab });
  };
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: cross });
  const id = await gw.id('op');
  assert.match(id, /^op_[0-9a-f]{32}$/);
  assert.equal(id, 'op_' + '09'.repeat(16));
});

test('LiveGateway.login 走 wx.login 并用 bootstrap 完成初始 hydrate', async () => {
  const mock = wxMock({
    respond(opts) {
      if (opts.url.endsWith('/auth/wechat')) {
        assert.equal(opts.method, 'POST');
        assert.deepEqual(opts.data, { code: 'devtools-code-1' });
        return opts.success({ statusCode: 200, header: {}, data: { accessToken: 'tok_' + 'a'.repeat(31), expiresAt: ISO, user: { id: 'user_1', displayName: '本地测试用户', createdAt: ISO } } });
      }
      if (opts.url.endsWith('/bootstrap')) {
        return opts.success({ statusCode: 200, header: {}, data: {
          user: { id: 'user_1', displayName: '本地测试用户', createdAt: ISO }, revision: 7, serverTime: ISO,
          counts: { onlineNodes: 1, sessions: 1, pendingRequests: 0, unreadNotifications: 0 },
          nodes: { items: [node()], nextPageToken: null },
          projects: { items: [{ id: 'proj_1', nodeId: 'node_1', name: 'demo', description: '', branch: 'main', valid: true, revision: 1 }], nextPageToken: null },
          agents: { items: [{ id: 'agent_1', nodeId: 'node_1', name: 'Fake Agent', state: 'ready', version: 'fake/1', adapterVersion: '1', capabilities: capabilities(), capabilityRevision: 1, revision: 1 }], nextPageToken: null },
          sessions: { items: [session()], nextPageToken: null },
          requests: { items: [], nextPageToken: null },
          notifications: { items: [], nextPageToken: null },
          audit: { items: [], nextPageToken: null }
        } });
      }
      if (opts.url.includes('/sessions/sess_1')) {
        return opts.success({ statusCode: 200, header: {}, data: session() });
      }
      if (opts.url.includes('/nodes/node_1') || opts.url.includes('/projects/proj_1') || opts.url.includes('/agents/agent_1')) {
        const map = { nodes: node(), projects: { id: 'proj_1', nodeId: 'node_1', name: 'demo', description: '', branch: 'main', valid: true, revision: 1 }, agents: { id: 'agent_1', nodeId: 'node_1', name: 'Fake Agent', state: 'ready', version: 'fake/1', adapterVersion: '1', capabilities: capabilities(), capabilityRevision: 1, revision: 1 } };
        const kind = opts.url.includes('/nodes/') ? 'nodes' : opts.url.includes('/projects/') ? 'projects' : 'agents';
        return opts.success({ statusCode: 200, header: {}, data: map[kind] });
      }
      opts.fail(new Error('unexpected url ' + opts.url));
    }
  });
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: mock });
  await gw.login('wechat');
  assert.equal(gw.token, 'tok_' + 'a'.repeat(31));
  assert.equal(gw.hydrated, true);
  assert.equal(gw.data.nodes.length, 1);
  assert.equal(gw.data.sessions.length, 1);
  const authed = mock.state.requests.find(r => r.url.endsWith('/auth/wechat'));
  assert.deepEqual(authed.data, { code: 'devtools-code-1' });
  assert.ok(!('Authorization' in authed.header) || authed.header.Authorization === undefined);
  const withAuth = mock.state.requests.find(r => r.url.endsWith('/bootstrap'));
  assert.equal(withAuth.header.Authorization, 'Bearer tok_' + 'a'.repeat(31));
});

test('LiveGateway 401 时重置并广播 unauthenticated', async () => {
  const events = [];
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: wxMock({
    respond(opts) { opts.success({ statusCode: 401, header: {}, data: { error: { code: 'UNAUTHENTICATED', message: '登录已过期', retryable: false, requestId: 'req_1' } } }); }
  }) });
  gw.subscribe(e => events.push(e));
  gw.token = 'stale';
  await assert.rejects(() => gw.request('/bootstrap', 'Bootstrap'), e => e.status === 401);
  assert.equal(gw.token, '');
  assert.ok(events.some(e => e.kind === 'unauthenticated'));
});

test('LiveGateway.confirmPair 携带幂等键并返回 Operation 回执', async () => {
  const op = operation({ id: 'op_pair_1', kind: 'pair', state: 'accepted' });
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: wxMock({
    respond(opts) {
      assert.equal(opts.url.endsWith('/pairings/confirm'), true);
      assert.match(opts.header['Idempotency-Key'], /^[A-Za-z0-9][A-Za-z0-9_-]*$/);
      opts.success({ statusCode: 202, header: {}, data: op });
    }
  }) });
  const receipt = await gw.confirmPair('TICKET123456', await gw.id('op'));
  assert.equal(receipt.id, 'op_pair_1');
  assert.equal(gw.ops['op_pair_1'].state, 'accepted');
});

test('LiveGateway.awaitOperation：confirmed 返回结果、超时 unknown、失败抛错', async () => {
  const confirmed = operation({ id: 'op_c', state: 'confirmed', kind: 'mark_read', result: { sessionId: null, turnId: null, requestId: null, nodeId: null, queueItemId: null } });
  const gw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', operationWaitMs: 400, wx: wxMock() });
  gw.acceptOperation(confirmed);
  const done = await gw.awaitOperation(confirmed);
  assert.deepEqual(done, { sessionId: null, turnId: null, requestId: null, nodeId: null, queueItemId: null });

  const pending = operation({ id: 'op_p', state: 'accepted' });
  const slow = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', operationWaitMs: 200, wx: wxMock() });
  slow.acceptOperation(pending);
  const unknown = await slow.awaitOperation(pending);
  assert.equal(unknown.unknown, true);

  const failed = operation({ id: 'op_f', state: 'failed', error: { code: 'VALIDATION_FAILED', message: '主机拒绝', retryable: false, requestId: 'req_2' } });
  const errGw = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: wxMock() });
  errGw.acceptOperation(failed);
  await assert.rejects(() => errGw.awaitOperation(failed), e => e.code === 'VALIDATION_FAILED');
});

function FakeLive(handlers = {}) {
  const listeners = new Set();
  const data = {
    nodes: [node()], projects: [{ id: 'proj_1', nodeId: 'node_1', name: 'demo', description: '', branch: 'main', valid: true, revision: 1 }],
    agents: [{ id: 'agent_1', nodeId: 'node_1', name: 'Fake Agent', state: 'ready', version: 'fake/1', adapterVersion: '1', capabilities: capabilities(), capabilityRevision: 1, revision: 1 }],
    sessions: [session()], requests: [], notifications: [], audit: []
  };
  const gw = {
    isLive: true, connection: 'online', watched: {}, data,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(value) { listeners.forEach(fn => fn(value)); },
    snapshot() { return JSON.parse(JSON.stringify(data)); },
    now() { return Date.now(); },
    async ensure(kind, id) { return data[kind].find(x => x.id === id); },
    async id(prefix) { return prefix + '_' + 'b'.repeat(32); },
    async login() { if (handlers.login) await handlers.login(); },
    async logout() {},
    async connect() { if (this.onBarrier) await this.onBarrier([]); this.connection = 'online'; this.emit({ kind: 'connection', state: 'online' }); },
    disconnect() {},
    dispose() {},
    async watch(id, after) { this.watched[id] = after; },
    async operation(id) { return operation({ id, state: 'confirmed' }); },
    async events(id, after) {
      if (handlers.events) return handlers.events(id, after);
      return { sessionId: id, after: after || 0, highWater: after || 0, events: [], nextAfter: after || 0, hasMore: false, earliestSequence: 1 };
    },
    async checkpoint() { throw Object.assign(new Error('cursor expired'), { code: 'CURSOR_EXPIRED' }); }
  };
  return gw;
}

const viewEvent = (seq, over = {}) => Object.assign({ version: 'weagent-view/1', id: 'evt_' + seq, sessionId: 'sess_1', turnId: 'turn_1', sequence: seq, type: 'card.upsert', data: { type: 'user', itemId: 'i' + seq, title: '你', text: '消息' + seq } }, over);

test('Runtime live：登录不下载全部正文，仅按显式屏障回填所需会话', async () => {
  const gw = FakeLive({ events: (id, after) => ({
    sessionId: id, after: after || 0, highWater: 2, nextAfter: 2, hasMore: false, earliestSequence: 1,
    events: [viewEvent(1), viewEvent(2)]
  }) });
  const rt = new Runtime(gw);
  await rt.login();
  assert.equal(rt.auth, true);
  assert.equal(rt.connection, 'online');
  await wait(120); // 屏障回填是异步收尾
  assert.equal(rt.timelines['sess_1'], undefined);
  await rt.onBarrier([{sessionId:'sess_1',highWater:2}]);
  const timeline = rt.timelines['sess_1'];
  assert.equal(timeline.cursor, 2);
  assert.equal(timeline.items.length, 2);
  rt.dispose();
});

test('Runtime live：命令等待服务端回执，confirmed/unknown/failed 三态正确', async () => {
  const gw = FakeLive();
  const rt = new Runtime(gw);
  await rt.login();
  rt.connection = 'online';

  gw.confirmPair = async (ticket, id) => operation({ id, kind: 'pair', state: 'accepted' });
  gw.awaitOperation = async () => ({ id: 'node_1' });
  const result = await rt.command('confirmPair', ['TICKET1'], await gw.id('op'));
  assert.equal(result.id, 'node_1');
  assert.equal(rt.operations[Object.keys(rt.operations)[0]], 'confirmed');
  for (const key of Object.keys(rt.operations)) delete rt.operations[key];

  gw.awaitOperation = async () => ({ unknown: true, operationId: 'op_x' });
  const unknown = await rt.command('confirmPair', ['TICKET1'], await gw.id('op'));
  assert.equal(unknown.unknown, true);
  assert.equal(Object.values(rt.operations)[0], 'unknown');
  for (const key of Object.keys(rt.operations)) delete rt.operations[key];

  gw.awaitOperation = async () => { throw Object.assign(new Error('主机拒绝'), { code: 'REJECTED' }); };
  await assert.rejects(async () => rt.command('confirmPair', ['TICKET1'], await gw.id('op')));
  assert.equal(Object.values(rt.operations)[0], 'failed');
  rt.dispose();
});

test('Runtime live：purge 与 unauthenticated 事件清理本地状态', async () => {
  const gw = FakeLive({ events: (id, after) => ({
    sessionId: id, after: 0, highWater: 1, nextAfter: 1, hasMore: false, earliestSequence: 1, events: [viewEvent(1)]
  }) });
  const rt = new Runtime(gw);
  await rt.login();
  await rt.loadTimeline('sess_1');
  assert.ok(rt.timelines['sess_1']);
  gw.emit({ kind: 'purge', sessionId: 'sess_1', removed: false });
  assert.equal(rt.timelines['sess_1'], undefined);
  gw.emit({ kind: 'unauthenticated' });
  assert.equal(rt.auth, false);
  rt.dispose();
});

test('page.action 兼容异步 id：live 模式完整走通提交与回执', async () => {
  const gw = FakeLive();
  const rt = new Runtime(gw);
  await rt.login();
  rt.connection = 'online';
  const instance = mount('pages/pair/index.js', rt);
  gw.confirmPair = async (ticket, id) => { assert.match(id, /^operation_[a-z0-9]{32}$/); return operation({ id, kind: 'pair', state: 'accepted' }); };
  gw.awaitOperation = async receipt => ({ id: 'node_9', name: '新设备' });
  instance.data.ticket = { id: 'TICKET123456' };
  instance.data.seconds = 60;
  // 页面 confirm() 不 await action；测试内等价的 awaited 调用（回调与 confirm() 一致）。
  await instance.action('confirmPair', ['TICKET123456'], node2 => wx.redirectTo({ url: '/pages/node/index?id=' + node2.id }));
  assert.ok(instance.calls.some(c => c.method === 'redirectTo' && c.arg.url.includes('node_9')));
  assert.equal(instance.data.receipt, '已确认');
  rt.dispose();
});

test('Runtime live：WS 事件实时合并进时间线', async () => {
  const gw = FakeLive();
  const rt = new Runtime(gw);
  await rt.login();
  rt.connection = 'online';
  rt.watchSession('sess_1');
  gw.emit({ kind: 'event', event: viewEvent(1) });
  gw.emit({ kind: 'event', event: viewEvent(2) });
  await wait(150);
  assert.equal(rt.timelines['sess_1'].cursor, 2);
  assert.equal(gw.watched['sess_1'], 2);
  rt.dispose();
});
