const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Runtime } = require('../miniprogram/services/runtime');
const { FakeGateway } = require('../miniprogram/services/fake-gateway');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const { mount } = require('./helpers');

function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function live(t) {
  const gateway = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18080', wx: {} });
  const runtime = new Runtime(gateway); runtime.auth = true;
  gateway.token = 'test-token'; gateway.connection = runtime.connection = 'online';
  gateway.data.nodes = [{ id: 'node_1', online: true, revoked: false }];
  gateway.data.sessions = [{ id: 'sess_1', nodeId: 'node_1', historyState: 'available', revision: 1, lastSequence: 0 }];
  let reconnects = 0;
  gateway.connect = async () => { reconnects++; gateway.state('online'); };
  t.after(() => runtime.dispose());
  return { gateway, runtime, reconnects: () => reconnects };
}
const diff = { id: 'diff_1', sessionId: 'sess_1', path: 'test.txt', patch: '+private', truncated: false };

test('R02: detail and node-list badges derive only from the reported Agent state', async t => {
  const rt = new Runtime(new FakeGateway({ delay: 1 })); await rt.login(); t.after(() => rt.dispose());
  const agent = rt.gateway.data.agents[0];
  const page = mount('pages/agent/index.js', rt); page.onLoad({ id: agent.id });
  for (const [state, css] of [['ready', 'online'], ['error', 'failed'], ['unavailable', 'offline']]) {
    agent.state = state; page.refresh();
    assert.equal(page.data.agent.state, state); assert.equal(page.data.agent.stateClass, css);
    if (state !== 'ready') assert.notEqual(page.data.agent.stateLabel, rt.view().agents.find(a => a.state === 'ready')?.stateLabel);
  }
  agent.state = undefined; page.refresh(); assert.equal(page.data.agent.stateClass, '');
  for (const [file, expression] of [['agent', 'agent.stateClass'], ['node', 'item.stateClass']]) {
    const wxml = fs.readFileSync(path.join(__dirname, `../miniprogram/pages/${file}/index.wxml`), 'utf8');
    assert.ok(wxml.includes(`class="badge {{${expression}}}"`));
  }
});

test('R04: one clear removes every body cache and watch but preserves auth and operation receipts', async t => {
  const { gateway: gw, runtime: rt, reconnects } = live(t);
  rt.timelines = { sess_1: { cursor: 12, items: ['private'] } }; rt.drafts = { sess_1: 'private' };
  rt.loading = { sess_1: Promise.resolve() }; rt.recoveryEvents = { sess_1: ['private'] }; rt.bodyEpoch = { sess_1: 3 };
  gw.files = { diff_1: diff }; gw.watched = { sess_1: 12 }; gw.metadataSequence = { sess_1: 12 };
  rt.operations = { op_1: 'delivered' }; gw.ops = { op_1: { state: 'delivered' } };
  const authEpoch = rt.epoch, generation = gw.generation, socketEpoch = gw.socketEpoch;
  assert.deepEqual(await rt.clearLocalContent(), { reconnected: true });
  for (const cache of [rt.timelines, rt.drafts, rt.loading, rt.recoveryEvents, rt.bodyEpoch, gw.files, gw.watched, gw.metadataSequence]) assert.deepEqual(cache, {});
  assert.equal(rt.auth, true); assert.equal(gw.token, 'test-token'); assert.equal(rt.epoch, authEpoch); assert.equal(gw.generation, generation);
  assert.equal(gw.socketEpoch, socketEpoch + 1); assert.equal(reconnects(), 1);
  assert.equal(rt.operations.op_1, 'delivered'); assert.equal(gw.ops.op_1.state, 'delivered');
  await gw.watch('sess_1', 0); assert.deepEqual(gw.watched, { sess_1: 0 });
});

test('R04: settings delegates clearing to Runtime instead of mutating individual fields', async t => {
  const { runtime: rt, gateway: gw } = live(t); gw.files = { diff_1: diff }; gw.watched = { sess_1: 2 };
  const page = mount('pages/settings/index.js', rt); page.clear();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(gw.files, {}); assert.deepEqual(gw.watched, {});
  assert.ok(page.calls.some(c => c.method === 'showToast'));
});

test('R04: clearing while offline still clears bodies and reports reconnect failure truthfully', async t => {
  const { runtime: rt, gateway: gw } = live(t); gw.connect = async () => { throw new Error('offline'); };
  rt.drafts = { sess_1: 'private' }; gw.files = { diff_1: diff };
  assert.deepEqual(await rt.clearLocalContent(), { reconnected: false });
  assert.deepEqual(gw.files, {}); assert.deepEqual(rt.drafts, {}); assert.equal(rt.connection, 'error');
});

test('R04: late Diff HTTP response cannot reinstall a cleared file', async t => {
  const { runtime: rt, gateway: gw } = live(t); const request = deferred(); gw.request = () => request.promise;
  const work = gw.diffFile('diff_1', 'sess_1'); const rejection = assert.rejects(work, { code: 'CONTENT_CLEARED' });
  await rt.clearLocalContent(); request.resolve(diff); await rejection; assert.deepEqual(gw.files, {});
});

test('R04: late history response is rejected before it can consume and cache diff.file', async t => {
  const { runtime: rt, gateway: gw } = live(t); const request = deferred(); gw.request = () => request.promise;
  let consumed = 0; gw.consume = () => { consumed++; };
  const work = gw.events('sess_1', 0); const rejection = assert.rejects(work, { code: 'CONTENT_CLEARED' });
  await rt.clearLocalContent(); request.resolve({ sessionId: 'sess_1', after: 0, highWater: 0, nextAfter: 0, events: [], hasMore: false });
  await rejection; assert.equal(consumed, 0); assert.deepEqual(gw.files, {});
});

test('R04: late checkpoint response cannot restore removed body data', async t => {
  const { runtime: rt, gateway: gw } = live(t); const request = deferred(); gw.request = () => request.promise;
  const work = gw.checkpoint('sess_1'); const rejection = assert.rejects(work, { code: 'CONTENT_CLEARED' });
  await rt.clearLocalContent(); request.resolve({ id: 'cp_1', sessionId: 'sess_1', sequence: 0, itemCount: 0 }); await rejection;
});

test('R04: late Runtime timeline response cannot recreate cleared timeline or cursor', async t => {
  const { runtime: rt, gateway: gw } = live(t); const request = deferred();
  gw.ensure = async () => {}; gw.events = () => request.promise; gw.watched = { sess_1: 0 };
  const work = rt.loadTimeline('sess_1'); await Promise.resolve(); await Promise.resolve();
  await rt.clearLocalContent(); request.resolve({ sessionId: 'sess_1', after: 0, highWater: 0, nextAfter: 0, events: [], hasMore: false }); await work;
  assert.deepEqual(rt.timelines, {}); assert.deepEqual(gw.watched, {}); assert.deepEqual(rt.recoveryEvents, {});
});

test('R04: old ready barrier does not repopulate watches or private bodies after clearing', async t => {
  const { runtime: rt, gateway: gw } = live(t); const syncing = deferred(); let barriers = 0;
  gw.syncChanges = () => syncing.promise; gw.onBarrier = () => { barriers++; }; gw.watched = { sess_1: 0 };
  const work = gw.ready({ revision: 1, sessions: [{ sessionId: 'sess_1', highWater: 2 }] });
  await rt.clearLocalContent(); syncing.resolve(); await work; assert.equal(barriers, 0); assert.deepEqual(gw.watched, {});
});

test('R04: late CURSOR_EXPIRED metadata fetch cannot resurrect previously watched sessions', async t => {
  const { runtime: rt, gateway: gw } = live(t); const request = deferred(); let bootstraps = 0;
  gw.request = () => request.promise; gw.bootstrap = async () => { bootstraps++; }; gw.watched = { sess_1: 10 };
  const work = gw.syncChanges(); await rt.clearLocalContent(); request.reject(Object.assign(new Error('expired'), { code: 'CURSOR_EXPIRED' }));
  await work; assert.equal(bootstraps, 0); assert.deepEqual(gw.watched, {});
});

test('R04: an accepted in-flight command remains observable across a local body clear', async t => {
  const { runtime: rt, gateway: gw } = live(t); const response = deferred();
  gw.send = () => response.promise; gw.awaitOperation = async () => ({ sessionId: 'sess_1' });
  const work = rt.command('send', ['sess_1', 'turn_1', 'message', 'send'], 'op_1');
  await rt.clearLocalContent(); response.resolve({ id: 'op_1', state: 'accepted' });
  assert.deepEqual(await work, { sessionId: 'sess_1' }); assert.equal(rt.operations.op_1, 'confirmed');
});

test('R04: demo bodies clear without immediately reloading all histories', async t => {
  const rt = new Runtime(new FakeGateway({ delay: 1 })); await rt.login(); t.after(() => rt.dispose());
  assert.ok(Object.keys(rt.timelines).length); await rt.clearLocalContent();
  assert.deepEqual(rt.timelines, {}); assert.equal(rt.auth, true);
});

test('R06: native control catalog records distinguish implementation, scope, and validation', () => {
  const rows = require('../miniprogram/catalog/requirements');
  assert.equal(rows.length, 194); assert.equal(new Set(rows.map(row => row.id)).size, 194);
  for (const row of rows) {
    assert.ok(row.record.targetVersion); assert.ok(row.record.runtimeMode); assert.ok(row.record.mapping);
    assert.ok(row.record.adapterScope); assert.ok(row.record.validation); assert.ok(row.legacyStatus);
  }
  for (const [id, action] of [['K01', 'models'], ['K02', 'set_model'], ['O06', 'compact']]) {
    const row = rows.find(row => row.id === id);
    assert.equal(row.record.mapping, 'weagent/1: NativeControl.control.action = ' + action);
    assert.notEqual(row.status, row.legacyStatus);
  }
  const wxml = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/requirement/index.wxml'), 'utf8');
  assert.ok(wxml.includes('{{requirement.record.validation}}'));
  assert.ok(wxml.includes('{{requirement.record.mapping}}'));
});

test('R04: a normal metadata-cursor rebuild still completes the ready history barrier', async t => {
  const { gateway: gw } = live(t); let sessions;
  gw.syncChanges = async () => { gw.clear(); gw.watched.sess_1 = 0; };
  gw.onBarrier = async value => { sessions = value; };
  await gw.ready({ revision: 3, sessions: [{ sessionId: 'sess_1', highWater: 5 }] });
  assert.deepEqual(sessions, [{ sessionId: 'sess_1', highWater: 5 }]);
});
