const test = require('node:test'); const assert = require('node:assert/strict');
const { FakeGateway } = require('../miniprogram/services/fake-gateway');
const { Runtime } = require('../miniprogram/services/runtime');
const { wait } = require('./helpers');
function gateway(t, extra = {}) { const g = new FakeGateway({ delay: 2, ...extra }); t.after(() => g.dispose()); return g; }
const input = { nodeId: 'demo-mac', projectId: 'demo-web', agentId: 'demo-codex', prompt: '检查会话恢复' };
test('repeated creation uses one logical session; identity conflicts are rejected', async t => {
  const g = gateway(t); const a = g.create(input, 'same'), b = g.create(input, 'same');
  const [one, two] = await Promise.all([a, b]); assert.equal(one.id, two.id); assert.equal(g.data.sessions.length, 4);
  await assert.rejects(g.create({ ...input, prompt: 'different' }, 'same'), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('approval stays pending until receipt, and concurrent clients receive the same decision', async t => {
  const g = gateway(t); const first = g.respond('demo-approval', 'demo-allow-once', 'a');
  assert.equal(g.data.requests[0].state, 'pending');
  const second = g.respond('demo-approval', 'demo-deny', 'b');
  const [a, b] = await Promise.all([first, second]); assert.equal(a.answer, b.answer); assert.equal(b.alreadyResolved, true);
});
test('expired approvals, stale turns and offline nodes cannot accept decisions', async t => {
  const g = gateway(t); const r = g.data.requests[0]; r.expiresAt = 0;
  await assert.rejects(g.respond(r.id, r.choices[0].id, 'expired'), { code: 'REQUEST_UNAVAILABLE' });
  r.expiresAt = Date.now() + 10000; r.turnId = 'old-turn';
  await assert.rejects(g.respond(r.id, r.choices[0].id, 'stale'), { code: 'REQUEST_UNAVAILABLE' });
  r.turnId = g.session(r.sessionId).turnId; g.setOnline('demo-mac', false);
  await assert.rejects(g.respond(r.id, r.choices[0].id, 'offline'), { code: 'CONTROL_UNAVAILABLE' });
  assert.equal(r.state, 'pending');
});
test('answers preserve question identity and enforce options and required values', async t => {
  const g = gateway(t);
  await assert.rejects(g.respond('demo-input', {}, 'missing'), { code: 'REQUIRED' });
  await assert.rejects(g.respond('demo-input', { 'demo-q1': 'guessed-option' }, 'bad-option'), { code: 'INVALID_CHOICE' });
  await assert.rejects(g.respond('demo-input', { 'demo-q1': 'demo-history', other: 'x' }, 'bad-q'), { code: 'INVALID_ANSWER' });
  const answer = { 'demo-q1': 'demo-history', 'demo-q2': '保留原文' };
  assert.deepEqual((await g.respond('demo-input', answer, 'good')).answer, answer);
});
test('cancel uses turn identity and does not report a terminal state on submit', async t => {
  const g = gateway(t); const s = g.session('demo-review');
  const operation = g.cancel(s.id, s.turnId, 'cancel'); assert.equal(s.state, 'waiting_approval');
  await operation; assert.equal(s.state, 'cancelled'); assert.equal(g.data.requests[0].state, 'cancelled');
  assert.equal((await g.cancel(s.id, s.turnId, 'cancel')).state, 'cancelled');
});
test('offline commands never silently queue and cross-node projects cannot create sessions', async t => {
  const g = gateway(t); g.setOnline('demo-mac', false);
  await assert.rejects(g.create(input, 'offline'), { code: 'RESOURCE_UNAVAILABLE' });
  g.setOnline('demo-mac', true);
  await assert.rejects(g.create({ ...input, projectId: 'demo-api' }, 'cross-node'), { code: 'RESOURCE_UNAVAILABLE' });
  assert.equal(g.data.sessions.length, 3);
});
test('pairing only binds after confirmation, validates expiration and prevents duplicate binding', async t => {
  let now = 1000; const g = gateway(t, { now: () => now });
  await assert.rejects(g.previewPair('weagent-demo'), { code: 'INVALID_PAIR_CODE' });
  const ticket = await g.previewPair('WEAGENT-DEMO'); assert.equal(g.data.nodes.length, 3);
  now += 61000; await assert.rejects(g.confirmPair(ticket.id, 'expired'), { code: 'PAIR_EXPIRED' });
  const valid = await g.previewPair('WEAGENT-DEMO'); await g.confirmPair(valid.id, 'pair');
  assert.equal(g.data.nodes.length, 4); await assert.rejects(g.previewPair('WEAGENT-DEMO'), { code: 'ALREADY_PAIRED' });
});
test('queue runs only after the current turn and completes in the same session', async t => {
  const g = gateway(t); const s = g.session('demo-review');
  await g.send(s.id, s.turnId, '第二个任务', 'queue', 'queued');
  assert.equal(s.queue.length, 1); assert.equal(s.state, 'waiting_approval');
  await g.respond('demo-approval', 'demo-allow-once', 'approval'); await wait(100);
  const cards = g.history[s.id].filter(e => e.type === 'card.upsert' && e.data.text === '第二个任务');
  assert.equal(cards.length, 1); assert.equal(s.queue.length, 0); assert.equal(s.state, 'completed');
});
test('denying a file request does not produce a successful diff for that action', async t => {
  const g = gateway(t); await g.respond('demo-approval', 'demo-deny', 'deny'); await wait(45);
  assert.equal(g.history['demo-review'].filter(e => e.data.type === 'diff').length, 0);
});
test('disconnect during execution recovers the full message without duplicated deltas', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login();
  const s = await rt.command('create', [input], 'create'); rt.disconnect(); await wait(50);
  const oldCursor = rt.timelines[s.id] ? rt.timelines[s.id].cursor : 0;
  await rt.recover(); assert.equal(rt.connection, 'online');
  const timeline = rt.timelines[s.id]; assert.ok(timeline.cursor > oldCursor);
  assert.equal(timeline.cursor, g.history[s.id].length); assert.equal(timeline.gap, null);
  const response = timeline.items.find(i => i.complete === true); assert.equal((response.text.match(/已收到你的任务/g) || []).length, 1);
});
test('unknown command result is reconciled without creating a second side effect', async t => {
  const g = gateway(t, { delay: 10 }); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login();
  const command = rt.command('respond', ['demo-approval', 'demo-allow-once'], 'decision');
  // Simulate loss of the client receipt path after the operation was accepted.
  rt.connection = 'offline'; const result = await command; assert.equal(result.unknown, true);
  await rt.recover(); assert.equal(rt.operations.decision, 'confirmed');
  assert.equal(g.operation('decision').result.answer, 'demo-allow-once'); assert.equal(g.operations.size, 1);
});
test('cold-start history never resumes after a cursor without a body, and logout clears private state', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login();
  rt.timelines = {}; await rt.loadTimeline('demo-review'); assert.ok(rt.timelines['demo-review'].items.length > 0);
  rt.draft('demo-review', 'private'); rt.logout(); assert.deepEqual(rt.drafts, {}); assert.deepEqual(rt.timelines, {}); assert.equal(rt.snapshot().sessions.length, 0);
});
test('revocation removes sessions and cached drafts from the visible account immediately', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login(); rt.draft('demo-review', 'private');
  await rt.command('revoke', ['demo-mac'], 'revoke'); assert.equal(rt.snapshot().sessions.some(s => s.id === 'demo-review'), false);
  assert.equal(rt.timelines['demo-review'], undefined); assert.equal(rt.drafts['demo-review'], undefined);
});
test('history/live race fetches the new gap that appeared while the first fetch was in flight', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login();
  const id = 'demo-review'; const s = g.session(id); rt.timelines = {};
  const original = g.events.bind(g); let resolveFirst, calls = 0;
  g.events = (key, after) => { calls++; if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; }); return original(key, after); };
  const work = rt.loadTimeline(id); const initial = g.history[id].slice();
  g.connection = 'offline'; g.card(s, { itemId: 'lost', type: 'status', text: 'missing' });
  g.connection = 'online'; g.card(s, { itemId: 'live', type: 'status', text: 'live' });
  resolveFirst(initial); await work;
  assert.equal(rt.timelines[id].gap, null); assert.equal(rt.timelines[id].cursor, g.history[id].length); assert.ok(calls >= 2);
});
test('logout fences an outstanding history request from restoring private data', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); rt.auth = true;
  let release; g.events = () => new Promise(resolve => { release = resolve; });
  const pending = rt.loadTimeline('demo-review'); rt.logout(); release(g.history['demo-review']); await pending;
  assert.deepEqual(rt.timelines, {});
});
test('logout fences in-flight command receipts and cannot restore old account operation state', async t => {
  const g = gateway(t); const rt = new Runtime(g); t.after(() => rt.dispose()); await rt.login();
  const pending = rt.command('create', [input], 'old-account'); rt.logout();
  await assert.rejects(pending, /账号状态已改变/); assert.deepEqual(rt.operations, {});
});
test('a revoked approval capability rejects a previously displayed choice', async t => {
  const g = gateway(t); g.data.agents[0].capabilities.approval = false;
  await assert.rejects(g.respond('demo-approval', 'demo-allow-once', 'unsupported'), { code: 'CONTROL_UNAVAILABLE' });
  assert.equal(g.data.requests[0].state, 'pending');
});
