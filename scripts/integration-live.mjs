// Real frontend transport/runtime -> real Go/PostgreSQL -> independent Node process.
// Only the native model endpoints are fixtures: no paid prompts or host modifications.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Runtime } = require('../miniprogram/services/runtime');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const { mount } = require('../tests/helpers');
const WebSocket = require('../../WeAgent-Node/node_modules/ws');
const base = process.env.WEAGENT_TEST_GATEWAY;
assert.match(base || '', /^http:\/\/127\.0\.0\.1:\d+$/);
const directory = mkdtempSync(join(tmpdir(), 'weagent-frontend-integration-'));
const events = [], metrics = { posts: 0, sockets: 0, requests: 0 }, errors = [];
const child = fork(fileURLToPath(new URL('../../WeAgent-Node/tests/fixtures/daemon-child.mjs', import.meta.url)), [base, join(directory, 'node')], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
child.stderr.resume(); child.on('message', message => events.push(message));
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  do { const result = await predicate(); if (result) return result; await sleep(100); } while (Date.now() < end);
  throw new Error('Timed out: ' + label + (gateway.lastError ? ' [' + gateway.lastError.code + ']' : ''));
}
function ipc(event) { return until(() => { const index = events.findIndex(e => e.event === event); return index >= 0 && events.splice(index, 1)[0]; }, 'Node ' + event); }
const wx = {
  getDeviceInfo: () => ({ platform: 'devtools' }),
  getRandomValues(o) { const bytes = randomBytes(o.length); o.success({ randomValues: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }); },
  request(o) {
    metrics.requests++; if (o.method === 'POST') metrics.posts++;
    fetch(o.url, { method: o.method, headers: o.header, body: o.method === 'GET' ? undefined : JSON.stringify(o.data), signal: AbortSignal.timeout(o.timeout) })
      .then(async response => o.success({ statusCode: response.status, data: await response.json(), header: Object.fromEntries(response.headers) }))
      .catch(() => o.fail({ errMsg: 'network failure' }));
  },
  connectSocket(o) {
    metrics.sockets++; const socket = new WebSocket(o.url, { headers: o.header });
    return {
      onOpen: fn => socket.on('open', fn), onClose: fn => socket.on('close', fn), onError: fn => socket.on('error', fn),
      onMessage: fn => socket.on('message', data => fn({ data: data.toString() })),
      send(o) { socket.send(o.data, error => error ? o.fail(error) : o.success({})); },
      close(o) { socket.close(o.code, o.reason); }
    };
  }
};
const gateway = new LiveGateway({ gatewayURL: base, wx, authMode: 'development', developmentIdentity: 'integration-' + randomBytes(12).toString('hex'), operationWaitMs: 12000 });
const runtime = new Runtime(gateway);
gateway.subscribe(message => { if (message.kind === 'connection' && message.state === 'error') errors.push(gateway.lastError?.code); });
async function command(method, args) {
  const id = await gateway.id('op'); let result = await runtime.command(method, args, id);
  if (result?.unknown) {
    const op = await until(async () => { const value = await gateway.operation(id); await sleep(800); return ['confirmed', 'failed'].includes(value.state) && value; }, 'operation confirmation');
    assert.equal(op.state, 'confirmed'); result = await gateway.operationResult(op);
  }
  return result;
}
async function state(id, expected) { return until(() => gateway.lookup('sessions', id)?.state === expected && gateway.lookup('sessions', id), 'session ' + expected); }
async function request(id, kind) { return until(() => gateway.data.requests.find(r => r.sessionId === id && r.kind === kind && r.state === 'pending'), kind); }
try {
  await runtime.login(); assert.equal(runtime.auth, true); assert.equal(runtime.connection, 'online');
  assert.equal(Object.keys(runtime.timelines).length, 0);
  const pairing = await ipc('pairing'), ticket = await gateway.previewPair(pairing.code);
  assert.equal(ticket.keyFingerprint, pairing.keyFingerprint);
  const node = await command('confirmPair', [ticket.id]); await ipc('connected');
  await gateway.syncChanges(); await until(() => gateway.lookup('nodes', node.id)?.online, 'online inventory');
  const agents = gateway.data.agents.filter(a => a.nodeId === node.id), project = gateway.data.projects.find(p => p.nodeId === node.id);
  assert.equal(agents.length, 3);
  for (const agent of agents) {
    const session = await command('create', [{ nodeId: node.id, projectId: project.id, agentId: agent.id, prompt: 'approval' }]);
    await runtime.loadTimeline(session.id); runtime.watchSession(session.id);
    const approval = await request(session.id, 'approval'); await state(session.id, 'waiting_approval');
    const view = mount('pages/request/index.js', runtime); view.onLoad({ id: approval.id }); view.refresh();
    assert.equal(view.data.reason, '');
    await view.action('respond', [approval.id, 'deny']); assert.equal(view.data.unknown, false);
    assert.equal(view.data.error, ''); await state(session.id, 'completed');
    await command('send', [session.id, gateway.lookup('sessions', session.id).turnId, 'question', 'send']);
    const question = await request(session.id, 'question');
    const answers = Object.fromEntries(question.questions.map(q => [q.id, q.type === 'multiple' ? [q.options[0].id] : q.type === 'single' ? q.options[0].id : 'fixture answer']));
    await command('respond', [question.id, answers]); await state(session.id, 'completed');
    await command('send', [session.id, gateway.lookup('sessions', session.id).turnId, 'hold', 'send']); await state(session.id, 'running');
    await command('cancel', [session.id, gateway.lookup('sessions', session.id).turnId]); await state(session.id, 'cancelled');
    // Exercise real page actions, not direct plugin calls or literal slash prompts.
    const modelsPage = mount('pages/panel/index.js', runtime); modelsPage.onLoad({ kind: 'config', sessionId: session.id }); modelsPage.refresh();
    assert.equal(modelsPage.data.nativeReason, ''); await modelsPage.loadModels();
    assert.equal(modelsPage.data.error, ''); assert.equal(modelsPage.data.models.length, 2);
    const model = modelsPage.data.models[1]; modelsPage.chooseModel({ currentTarget: { dataset: { id: model.id } } });
    await until(() => !modelsPage.data.busy && !modelsPage.data.unknown, 'model selection');
    assert.equal(modelsPage.data.error, ''); assert.equal(modelsPage.data.selectedModel, model.id);
    if (agent.capabilities.compact) {
      const compactPage = mount('pages/panel/index.js', runtime); compactPage.onLoad({ kind: 'compact', sessionId: session.id }); compactPage.refresh(); compactPage.compact();
      await until(() => !compactPage.data.busy && !compactPage.data.unknown, 'compaction receipt');
      assert.equal(compactPage.data.error, ''); await state(session.id, 'completed');
    }
    await runtime.loadTimeline(session.id);
    const timeline = runtime.timelines[session.id];
    assert.equal(timeline.gap, null); assert.ok(timeline.cursor > 0);
    assert.ok(timeline.items.some(i => i.type === 'user')); assert.ok(timeline.items.some(i => i.type === 'assistant'));
    assert.equal(new Set(timeline.items.map(i => i.key)).size, timeline.items.length);
    const before = JSON.stringify(timeline.items), posts = metrics.posts;
    runtime.disconnect(); await runtime.recover();
    assert.equal(JSON.stringify(runtime.timelines[session.id].items), before);
    assert.equal(metrics.posts, posts, 'reconnect must not replay commands');
    runtime.unwatchSession(session.id);
    console.log(`PASS frontend -> Gateway -> Node/${agent.name}: create, approval page, send, question, cancel, model page, ${agent.capabilities.compact ? 'native compact, ' : ''}history and reconnect`);
  }
  const sessionsPage = mount('pages/sessions/index.js', runtime); sessionsPage.refresh(); sessionsPage.setData({ query: 'approval' });
  await sessionsPage.fetchList(); assert.equal(sessionsPage.data.listError, ''); assert.equal(sessionsPage.data.list.length, 3);
  const historyPage = mount('pages/inbox/index.js', runtime); historyPage.setData({ filter: 'history' }); await historyPage.fetchList();
  assert.equal(historyPage.data.listError, ''); assert.equal(historyPage.data.list.length, 6);
  // Claude's advertised native compact command uses its input stream; Codex/Pi use dedicated RPCs.
  child.send({ type: 'stats' }); const stats = await ipc('stats'); assert.equal(stats.nativePromptCalls, 10);
  assert.deepEqual(errors, [], 'normal task and reconnect flows must have no transport errors');
  await command('revoke', [node.id]); assert.equal(gateway.data.sessions.length, 0); assert.equal(Object.keys(runtime.timelines).length, 0);
  await runtime.logout(); assert.equal(gateway.token, ''); assert.equal(runtime.auth, false);
  assert.equal(gateway.socket, null); assert.equal(events.some(e => ['halted', 'gateway-error', 'protocol-conflict'].includes(e.event)), false);
  // Gateway deliberately closes client sockets after revocation to fence queued private frames.
  assert.ok(errors.every(code => code === 'NETWORK_ERROR'));
  console.log(`PASS server search, request history, revocation and logout; native input count = ${stats.nativePromptCalls} (9 tasks + Claude compact; fixtures only)`);
  console.log(`Frontend integration passed (${metrics.requests} HTTP requests, ${metrics.sockets} sequential sockets).`);
} finally {
  runtime.dispose();
  if (child.connected) child.send({ type: 'stop' });
  const end = Date.now() + 5000; while (child.exitCode === null && !child.signalCode && Date.now() < end) await sleep(100);
  if (child.exitCode === null && !child.signalCode) { child.kill(); await sleep(1000); }
  const target = resolve(directory), path = relative(resolve(tmpdir()), target);
  if (!path || path.startsWith('..') || isAbsolute(path) || !path.startsWith('weagent-frontend-integration-')) throw new Error('Unsafe fixture cleanup target');
  rmSync(target, { recursive: true, force: true });
}
