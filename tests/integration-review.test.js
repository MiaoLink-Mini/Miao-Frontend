const test = require('node:test');
const assert = require('node:assert/strict');
const { Runtime } = require('../miniprogram/services/runtime');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const { projectEvent } = require('../miniprogram/services/wire');
const { emptyTimeline, mergeEvents } = require('../miniprogram/stores/timeline');
const { FakeGateway } = require('../miniprogram/services/fake-gateway');
const { mount } = require('./helpers');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function setup(t) {
  const gateway = new LiveGateway({ gatewayURL: 'http://127.0.0.1:18081', wx: {} });
  const demo = new FakeGateway(); gateway.data = demo.snapshot(); demo.dispose();
  const session = gateway.data.sessions[0]; session.historyState = 'available';
  gateway.ensure = async (kind, id) => gateway.lookup(kind, id);
  const runtime = new Runtime(gateway); runtime.auth = true; runtime.connection = 'online';
  t.after(() => runtime.dispose());
  return { gateway, runtime, session };
}
function event(session, sequence, type = 'view.noop', data = {}) {
  return { id: 'e' + sequence, version: 'weagent-view/1', sessionId: session.id, turnId: session.turnId, sequence, type, data };
}
const page = (session, after, highWater, events, hasMore = false) => ({ sessionId: session.id, after, highWater, nextAfter: after + events.length, events, hasMore });

test('review: fixed HTTP highWater survives more than five pages', async t => {
  const { gateway, runtime, session } = setup(t), calls = [];
  gateway.events = async (id, after, until) => { calls.push({ after, until }); return page(session, after, 7, [event(session, after + 1)], after < 6); };
  await runtime.loadTimeline(session.id);
  assert.equal(calls.length, 7); assert.equal(calls[0].until, undefined);
  assert.ok(calls.slice(1).every(c => c.until === 7)); assert.equal(runtime.timelines[session.id].cursor, 7);
});
test('review: ready waits for watched history, propagates failures, never loads unrelated sessions', async t => {
  const { gateway, runtime, session } = setup(t), pending = deferred(), calls = [];
  gateway.events = (id, after, until) => { calls.push({ id, until }); return pending.promise; };
  let finished = false; const work = runtime.onBarrier([{ sessionId: session.id, highWater: 1 }]).then(() => { finished = true; });
  await new Promise(setImmediate); assert.equal(finished, false);
  assert.deepEqual(calls, [{ id: session.id, until: 1 }]);
  pending.reject(new Error('history unavailable')); await assert.rejects(work, /history unavailable/);
});
test('review: watch cursor follows contiguous body, not highest received sequence', async t => {
  const { gateway, runtime, session } = setup(t), pending = deferred();
  gateway.watched[session.id] = 0; gateway.events = () => pending.promise;
  gateway.emit({ kind: 'event', event: event(session, 3) });
  assert.equal(gateway.watched[session.id], 0);
  pending.resolve(page(session, 0, 3, [1, 2, 3].map(n => event(session, n))));
  await runtime.loadTimeline(session.id); assert.equal(gateway.watched[session.id], 3);
});
test('review: checkpoint installation keeps live events that raced with the snapshot', async t => {
  const { gateway, runtime, session } = setup(t), pending = deferred();
  let first = true;
  gateway.events = async (id, after) => {
    if (first) { first = false; throw Object.assign(new Error('expired'), { code: 'CURSOR_EXPIRED' }); }
    return page(session, after, 2, after === 1 ? [event(session, 2, 'message.completed', { itemId: 'live', text: 'new', role: 'user' })] : []);
  };
  gateway.checkpoint = () => pending.promise;
  const work = runtime.loadTimeline(session.id); await new Promise(setImmediate);
  gateway.emit({ kind: 'event', event: event(session, 1) });
  gateway.emit({ kind: 'event', event: event(session, 2, 'message.completed', { itemId: 'live', text: 'new', role: 'user' }) });
  pending.resolve({ sequence: 1, items: [] }); await work;
  assert.equal(runtime.timelines[session.id].cursor, 2); assert.equal(runtime.timelines[session.id].items[0].type, 'user');
});
test('review: purge fences in-flight history even when session metadata still exists', async t => {
  const { gateway, runtime, session } = setup(t), pending = deferred();
  gateway.events = () => pending.promise;
  const work = runtime.loadTimeline(session.id); await new Promise(setImmediate);
  gateway.emit({ kind: 'purge', sessionId: session.id });
  pending.resolve(page(session, 0, 1, [event(session, 1)])); await work;
  assert.equal(runtime.timelines[session.id], undefined);
});
test('review: expired history is not treated as a recoverable checkpoint', async t => {
  const { gateway, runtime, session } = setup(t); let checkpoint = false;
  gateway.events = async () => { throw Object.assign(new Error('purged'), { code: 'HISTORY_PURGED' }); };
  gateway.checkpoint = async () => { checkpoint = true; };
  runtime.draft(session.id, 'private');
  await assert.rejects(runtime.loadTimeline(session.id), /purged/);
  assert.equal(checkpoint, false); assert.equal(runtime.draft(session.id), '');
});
test('review: async secure ID generation is inside the double-click lock and error handling', async t => {
  const { gateway, runtime } = setup(t), pending = deferred(); let ids = 0, submits = 0;
  gateway.id = () => { ids++; return pending.promise; };
  runtime.command = async () => { submits++; return { id: 'node' }; };
  const view = mount('pages/pair/index.js', runtime);
  const first = view.action('confirmPair', ['ticket']); const second = view.action('confirmPair', ['ticket']);
  assert.equal(view.data.busy, true); assert.equal(ids, 1); pending.resolve('operation_key');
  await Promise.all([first, second]); assert.equal(submits, 1);
  gateway.id = async () => { throw new Error('crypto failure'); };
  await view.action('confirmPair', ['ticket']); assert.equal(view.data.busy, false); assert.equal(view.data.error, '错误码：UNKNOWN_ERROR');
});
test('review: uncertain submit locks action and reconciliation maps OperationResult to the page resource', async t => {
  const { gateway, runtime } = setup(t); let submits = 0, destination;
  gateway.id = async () => 'operation_1';
  gateway.confirmPair = async () => { submits++; throw Object.assign(new Error('timeout'), { uncertain: true }); };
  const view = mount('pages/pair/index.js', runtime);
  await view.action('confirmPair', ['ticket'], result => { destination = result.id; });
  assert.equal(view.data.unknown, true); assert.equal(runtime.operations.operation_1, 'unknown');
  await view.action('confirmPair', ['ticket']); assert.equal(submits, 1);
  gateway.operation = async () => ({ state: 'confirmed', result: { nodeId: 'real_node' } });
  gateway.operationResult = async op => ({ id: op.result.nodeId });
  await view.reconcile(); assert.equal(destination, 'real_node'); assert.equal(view.data.unknown, false);
});
test('review: logout during secure ID generation cannot issue a command as the next user', async t => {
  const { gateway, runtime } = setup(t), pending = deferred(); let calls = 0;
  gateway.id = () => pending.promise; runtime.command = async () => { calls++; };
  const view = mount('pages/pair/index.js', runtime), work = view.action('confirmPair', ['ticket']);
  await runtime.logout(); pending.resolve('old_id'); await work; assert.equal(calls, 0);
});
test('review: revoked nodes tombstone late list results and drafts without loaded body', t => {
  const { gateway, runtime, session } = setup(t), saved = { ...session };
  runtime.draft(session.id, 'secret'); gateway.remove('nodes', session.nodeId); gateway.put('sessions', saved);
  assert.equal(gateway.lookup('sessions', session.id), undefined); assert.equal(runtime.draft(session.id), '');
});
test('review: system notices and pending resources outside first session page remain visible', t => {
  const { gateway, runtime } = setup(t);
  gateway.data.notifications.push({ id: 'system', sessionId: null });
  gateway.data.requests.push({ id: 'unloaded', sessionId: 'later-page' });
  assert.ok(runtime.snapshot().notifications.some(n => n.id === 'system'));
  assert.ok(runtime.snapshot().requests.some(n => n.id === 'unloaded'));
});
test('review: message role, final text and null metadata cursor are preserved', () => {
  const wire = { version: 'weagent/1', id: 'event', sessionId: 's', turnId: 't', sequence: 1, createdAt: '2026-09-06T10:00:00Z', type: 'message.completed', data: { itemId: 'i', role: 'user', text: 'prompt', truncated: true } };
  const metadata = { ...wire, id: 'meta', sequence: 2, turnId: null, type: 'queue.updated', data: { items: [] } };
  const timeline = mergeEvents(emptyTimeline('s'), [projectEvent(wire), projectEvent(metadata)]);
  assert.equal(timeline.cursor, 2); assert.equal(timeline.items.length, 1); assert.equal(timeline.items[0].type, 'user'); assert.equal(timeline.items[0].truncated, true);
});
test('review: session capabilities override agent defaults for composer and slash commands', t => {
  const { gateway, runtime, session } = setup(t);
  session.state = 'completed'; session.capabilities = { ...gateway.data.agents.find(a => a.id === session.agentId).capabilities, send: false, plan: false };
  const view = mount('pages/session/index.js', runtime); view.onLoad({ id: session.id }); view.refresh();
  assert.match(view.data.sendReason, /不支持发送/);
  view.input({ detail: { value: '/plan' } }); assert.equal(view.data.slashItems.some(x => x.name === 'plan'), false);
});
test('review: server search fences stale queries and does not reuse their page tokens', async t => {
  const { gateway, runtime, session } = setup(t), old = deferred(), calls = [];
  gateway.list = (kind, filters, token) => {
    calls.push({ kind, filters, token });
    return filters.q === 'old' ? old.promise : Promise.resolve({ items: [session], nextPageToken: 'new-cursor' });
  };
  const view = mount('pages/sessions/index.js', runtime); view.refresh(); view.setData({ query: 'old' });
  const first = view.fetchList(); view.setData({ query: 'new' }); await view.fetchList();
  old.resolve({ items: [], nextPageToken: 'stale-cursor' }); await first;
  assert.deepEqual(view.data.remoteIds, [session.id]); assert.deepEqual(view.queryCursors, ['new-cursor']);
  assert.ok(calls.every(c => c.kind === 'sessions' && c.token === undefined));
  view.setData({ filter: 'active' }); assert.deepEqual(view.listSource().queries.map(q => q.state), ['running', 'waiting_approval', 'waiting_input', 'cancelling']);
});
test('review: deciding requests stay in pending, not history, even after their deadline', t => {
  const { gateway, runtime, session } = setup(t);
  gateway.data.requests = [{ id: 'deciding', sessionId: session.id, kind: 'approval', state: 'deciding', expiresAt: 1, createdAt: 1 }];
  const view = mount('pages/inbox/index.js', runtime); view.refresh();
  assert.equal(view.data.list.length, 1); assert.equal(view.data.list[0].stateLabel, '正在回传');
  view.setData({ filter: 'history' }); view.refresh(); assert.equal(view.data.list.length, 0);
});
test('review: read-only file page uses the authorized patch including removed lines', t => {
  const { gateway, runtime, session } = setup(t);
  const patch = '@@ -1 +1 @@\n-old\n+new';
  gateway.files.diff = { id: 'diff', sessionId: session.id, path: 'src/example.js', patch };
  const view = mount('pages/file/index.js', runtime); view.onLoad({ sessionId: session.id, fileId: 'diff' }); view.refresh();
  assert.equal(view.data.text, patch); assert.equal(view.data.file.name, 'src/example.js');
  gateway.purgeSession(session.id, false); view.refresh(); assert.equal(view.data.file, null);
});
test('review: live overview uses server totals instead of paginated cache sizes', t => {
  const { gateway, runtime } = setup(t); gateway.counts = { sessions: 1000, pendingRequests: 300, onlineNodes: 12 };
  const view = runtime.view(); assert.equal(view.sessionCount, 1000); assert.equal(view.pendingCount, 300); assert.equal(view.onlineCount, 12);
});
test('review: logout clears visible state before the server logout request finishes', async t => {
  const { gateway, runtime } = setup(t), pending = deferred();
  gateway.logout = () => pending.promise; let notified = false;
  runtime.subscribe(() => { notified = true; assert.equal(runtime.snapshot().sessions.length, 0); });
  const work = runtime.logout(); await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(notified, true); assert.equal(runtime.auth, false); pending.resolve(); await work;
});
test('review: secure IDs reject byteLength lookalikes, without using a weak fallback', async t => {
  const { gateway } = setup(t); gateway.wx = { getRandomValues: o => o.success({ randomValues: { byteLength: 16 } }) };
  await assert.rejects(gateway.id(), e => e.code === 'CRYPTO_UNAVAILABLE');
});
