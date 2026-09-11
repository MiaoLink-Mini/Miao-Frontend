const { fixtures } = require('./fixtures');
const { ACTIVE, controlReason, requestReason, capability } = require('../utils/policy');
const copy = value => JSON.parse(JSON.stringify(value));
function fault(code, message) { const error = new Error(message); error.code = code; return error; }
class FakeGateway {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.delay = options.delay === undefined ? 280 : options.delay;
    this.data = fixtures(this.now()); this.history = {}; this.listeners = new Set();
    this.operations = new Map(); this.timers = new Set(); this.counter = 0;
    this.connection = 'online'; this.pairings = new Map();
    for (const session of this.data.sessions) this.seedHistory(session);
  }
  id(prefix) { return `${prefix}-${this.now()}-${++this.counter}`; }
  snapshot() { return copy(this.data); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  notify(payload) { if (this.connection === 'online') this.listeners.forEach(fn => fn(copy(payload))); }
  later(fn, multiplier = 1) {
    const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, this.delay * multiplier);
    this.timers.add(timer); return timer;
  }
  dispose() { this.timers.forEach(clearTimeout); this.timers.clear(); this.listeners.clear(); }
  session(id) { return this.data.sessions.find(s => s.id === id); }
  emit(session, type, data) {
    const events = this.history[session.id] || (this.history[session.id] = []);
    const event = { id: this.id('event'), version: 'demo-view/1', sessionId: session.id, turnId: session.turnId, sequence: events.length + 1, type, data };
    events.push(event); session.updatedAt = this.now(); this.notify({ kind: 'event', event });
  }
  card(session, data) { this.emit(session, 'card.upsert', data); }
  seedHistory(s) {
    this.card(s, { itemId: 'prompt', type: 'user', title: '你', text: s.title });
    this.card(s, { itemId: 'intro', type: 'assistant', title: 'Agent', text: '已读取任务说明。我会先检查现有实现，再给出可审阅的结果。以下为模拟事件。' });
    this.card(s, { itemId: 'tool', type: 'tool', title: '读取项目文件', text: '已检查 3 个相关文件', state: 'completed', detail: '演示工具结果：读取完成。真实文件内容尚未接入。', truncated: false });
    this.card(s, { itemId: 'plan', type: 'plan', title: '执行计划', text: '已检查现有实现 · 等待下一步', steps: [{ label: '检查项目与需求', state: 'completed' }, { label: '实现并验证改动', state: s.state === 'completed' ? 'completed' : 'running' }, { label: '整理结果', state: s.state === 'completed' ? 'completed' : 'pending' }], panel: 'plan' });
    const request = this.data.requests.find(r => r.sessionId === s.id);
    if (request) this.card(s, { itemId: request.id, type: request.kind, title: request.title, text: request.summary, requestId: request.id, state: 'pending' });
    if (s.state === 'completed') this.result(s);
  }
  events(id, after = 0) { return Promise.resolve(copy((this.history[id] || []).filter(e => e.sequence > after))); }
  assertControl(s, cap) {
    const node = s && this.data.nodes.find(n => n.id === s.nodeId);
    const agent = s && this.data.agents.find(a => a.id === s.agentId);
    const reason = controlReason(s, node, this.connection, capability(agent, cap));
    if (reason) throw fault('CONTROL_UNAVAILABLE', reason);
  }
  mutate(id, fingerprint, apply) {
    if (!id) return Promise.reject(fault('MISSING_IDENTITY', '缺少操作标识'));
    const previous = this.operations.get(id);
    if (previous) return previous.fingerprint === fingerprint ? previous.promise : Promise.reject(fault('IDEMPOTENCY_CONFLICT', '同一操作标识不可用于不同内容'));
    if (this.connection !== 'online') return Promise.reject(fault('OFFLINE', '连接已断开，请恢复后再操作'));
    const record = { id, fingerprint, state: 'accepted', result: null };
    record.promise = new Promise((resolve, reject) => {
      this.later(() => {
        record.state = 'delivered'; this.notify({ kind: 'operation', id, state: record.state });
        this.later(() => {
          try {
            record.result = apply(); record.state = 'confirmed';
            this.data.audit.unshift({ id, title: fingerprint.split(':')[0], state: '演示回执已确认', createdAt: this.now() });
            this.notify({ kind: 'snapshot' }); resolve(copy(record.result));
          } catch (error) { record.state = 'failed'; record.error = error; reject(error); }
          this.notify({ kind: 'operation', id, state: record.state });
        });
      });
    });
    this.operations.set(id, record);
    return record.promise;
  }
  operation(id) {
    const op = this.operations.get(id);
    return op ? { id, state: op.state, result: copy(op.result), error: op.error ? op.error.message : '' } : null;
  }
  create(input, id) {
    return this.mutate(id, `创建会话:${JSON.stringify(input)}`, () => {
      const project = this.data.projects.find(p => p.id === input.projectId && p.nodeId === input.nodeId && p.valid);
      const agent = this.data.agents.find(a => a.id === input.agentId && a.nodeId === input.nodeId && a.state === 'ready');
      const node = this.data.nodes.find(n => n.id === input.nodeId && n.online && !n.revoked);
      if (!project || !agent || !node) throw fault('RESOURCE_UNAVAILABLE', '所选设备、项目或 Agent 已不可用');
      if(input.historyOnly && input.prompt===undefined && !input.origin && !input.preset){
        const s={id:this.id('session'),turnId:this.id('turn'),title:'新会话',projectId:project.id,nodeId:node.id,agentId:agent.id,state:'completed',mode:'managed',updatedAt:this.now(),queue:[]};
        this.data.sessions.unshift(s);return s;
      }
      if (!input.prompt || !input.prompt.trim()) throw fault('EMPTY_INPUT', '请输入任务说明');
      const s = { id: this.id('session'), turnId: this.id('turn'), title: input.prompt.trim().slice(0, 32), projectId: project.id, nodeId: node.id, agentId: agent.id, state: 'running', mode: 'managed', updatedAt: this.now(), queue: [] };
      this.data.sessions.unshift(s); this.card(s, { itemId: this.id('prompt'), type: 'user', title: '你', text: input.prompt }); this.run(s); return s;
    });
  }
  send(sessionId, turnId, text, mode, id) {
    return this.mutate(id, `发送指令:${JSON.stringify([sessionId, turnId, text, mode])}`, () => {
      const s = this.session(sessionId); this.assertControl(s, 'send');
      if (s.turnId !== turnId) throw fault('STALE_TURN', '原轮次已结束，请核对当前会话');
      if (!text.trim()) throw fault('EMPTY_INPUT', '请输入内容');
      if (ACTIVE.includes(s.state)) {
        const agent = this.data.agents.find(a => a.id === s.agentId);
        if (mode !== 'queue' || !capability(agent, 'queue') || s.state === 'cancelling') throw fault('BUSY', '当前轮次尚未结束');
        s.queue.push({ id, text }); return { queued: true };
      }
      s.turnId = this.id('turn'); s.state = 'running';
      this.card(s, { itemId: this.id('prompt'), type: 'user', title: '你', text }); this.run(s); return { queued: false };
    });
  }
  run(s) {
    const turn = s.turnId; const itemId = this.id('message'); const parts = ['已收到你的任务。', '正在检查相关文件与执行计划。', '\n这是 Fake Gateway 的演示输出，尚未执行远程代码。'];
    parts.forEach((text, index) => this.later(() => {
      if (s.turnId !== turn || s.state !== 'running') return;
      this.emit(s, 'message.delta', { itemId, text });
      if (index === parts.length - 1) {
        this.emit(s, 'message.completed', { itemId, text: parts.join('') });
        this.card(s, { itemId: this.id('tool'), type: 'tool', title: '检查任务输入', state: 'completed', text: '演示检查完成', detail: '模拟工具返回，未读取或改动远程文件。' });
        this.result(s); s.state = 'completed';
        this.data.notifications.unshift({ id: this.id('notice'), sessionId: s.id, title: `${s.title} · 本轮完成`, summary: '演示结果已就绪', kind: 'completed', read: false, createdAt: this.now() });
        this.notify({ kind: 'snapshot' });
        if (s.queue.length) this.later(() => {
          if (s.state !== 'completed' || s.turnId !== turn) return;
          const next = s.queue.shift(); if (!next) return;
          s.turnId = this.id('turn'); s.state = 'running';
          this.card(s, { itemId: next.id, type: 'user', title: '你 · 队列执行', text: next.text }); this.run(s); this.notify({ kind: 'snapshot' });
        }, 3);
      }
    }, 3 + index * 4));
  }
  result(s) {
    if (!s.deniedAction) this.card(s, { itemId: 'demo-diff', type: 'diff', title: '改动预览', text: '1 个演示文件 · +2 −1', panel: 'diff', source: '本轮演示快照', files: [{ id: 'demo-file', name: 'pages/sessions/index.wxss', version: 'demo-snapshot/1', lines: [{ kind: 'context', text: '.session-card {' }, { kind: 'removed', text: '-  padding: 20rpx;' }, { kind: 'added', text: '+  padding: 28rpx;' }, { kind: 'added', text: '+  border-radius: 24rpx;' }, { kind: 'context', text: '}' }] }] });
    this.card(s, { itemId: 'result', type: 'result', title: '本轮结果', text: '演示流程已完成。以上文件与执行结果均为模拟数据，未修改远程项目。' });
    this.card(s, { itemId: 'usage', type: 'usage', title: '本轮用量', text: '演示统计 · 输入 1,280 / 输出 420 tokens', panel: 'usage', input: 1280, output: 420, cost: null });
  }
  cancel(sessionId, turnId, id) {
    if (this.operations.has(id)) return this.mutate(id, `取消当前轮次:${sessionId}:${turnId}`, () => ({}));
    const s = this.session(sessionId);
    try { this.assertControl(s, 'cancel'); } catch (e) { return Promise.reject(e); }
    if (s.turnId !== turnId || !ACTIVE.includes(s.state)) return Promise.reject(fault('STALE_TURN', '该轮次已结束'));
    return this.mutate(id, `取消当前轮次:${sessionId}:${turnId}`, () => {
      this.assertControl(s, 'cancel');
      if (s.turnId !== turnId || !ACTIVE.includes(s.state)) throw fault('STALE_TURN', '该轮次已结束');
      s.state = 'cancelled';
      this.data.requests.filter(r => r.sessionId === s.id && r.turnId === turnId && r.state === 'pending').forEach(r => { r.state = 'cancelled'; });
      this.card(s, { itemId: this.id('cancel'), type: 'status', title: '当前轮次已取消', text: '已经完成的文件修改不会自动撤回。队列保留，请查看待执行消息。' }); return { state: s.state };
    });
  }
  respond(requestId, answer, id) {
    return this.mutate(id, `处理请求:${JSON.stringify([requestId, answer])}`, () => {
      const r = this.data.requests.find(x => x.id === requestId);
      if (!r) throw fault('NOT_FOUND', '请求不存在');
      if (r.state === 'resolved') return { alreadyResolved: true, answer: r.answer };
      const s = this.session(r.sessionId), node = this.data.nodes.find(n => n.id === s.nodeId);
      this.assertControl(s, r.kind);
      const reason = requestReason(r, s, node, this.connection, this.now());
      if (reason) throw fault('REQUEST_UNAVAILABLE', reason);
      if (r.kind === 'approval' && !r.choices.some(c => c.id === answer)) throw fault('INVALID_CHOICE', '不允许的审批选择');
      if (r.kind === 'question') {
        if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw fault('INVALID_ANSWER', '回答格式无效');
        if (Object.keys(answer).some(key => !r.questions.some(q => q.id === key))) throw fault('INVALID_ANSWER', '问题身份不匹配');
        r.questions.forEach(q => {
          const value = answer[q.id];
          if (q.required && (value === undefined || value === '' || (Array.isArray(value) && !value.length))) throw fault('REQUIRED', '请完成必填问题');
          if (value === undefined || value === '') return;
          if (q.type === 'single' && !q.options.some(o => o.id === value)) throw fault('INVALID_CHOICE', '无效选项');
          if (q.type === 'text' && typeof value !== 'string') throw fault('INVALID_ANSWER', '文字回答格式无效');
          if (q.type === 'multiple' && (!Array.isArray(value) || new Set(value).size !== value.length || value.some(v => !q.options.some(o => o.id === v)) || (q.max && value.length > q.max))) throw fault('INVALID_CHOICE', '多选答案不符合约束');
        });
      }
      r.state = 'resolved'; r.answer = answer;
      if (r.kind === 'approval' && answer === 'demo-deny') s.deniedAction = true;
      this.card(s, { itemId: r.id, type: r.kind, title: r.title, text: '该请求已处理，可查看处理结果。', requestId: r.id, state: 'resolved' });
      s.state = 'running'; this.run(s); return { answer };
    });
  }
  previewPair(code) {
    if (this.connection !== 'online') return Promise.reject(fault('OFFLINE', '连接尚未恢复'));
    if (code !== 'GOLINK-DEMO' && code !== 'WEAGENT-DEMO') return Promise.reject(fault('INVALID_PAIR_CODE', '配对码无效。演示码为 GOLINK-DEMO，字符区分大小写。'));
    if (this.data.nodes.some(n => n.id === 'demo-paired' && !n.revoked)) return Promise.reject(fault('ALREADY_PAIRED', '此演示设备已绑定'));
    const ticket = { id: this.id('pair'), name: '新工作站', platform: 'Linux · 演示', version: 'demo-node/1', expiresAt: this.now() + 60000 };
    this.pairings.set(ticket.id, ticket); return Promise.resolve(copy(ticket));
  }
  confirmPair(ticketId, id) {
    return this.mutate(id, `绑定设备:${ticketId}`, () => {
      const ticket = this.pairings.get(ticketId);
      if (!ticket || ticket.expiresAt <= this.now()) throw fault('PAIR_EXPIRED', '配对已过期，请重新获取');
      if (this.data.nodes.some(n => n.id === 'demo-paired' && !n.revoked)) throw fault('ALREADY_PAIRED', '设备已绑定');
      this.pairings.delete(ticketId); this.data.nodes = this.data.nodes.filter(n => n.id !== 'demo-paired');
      const node = { id: 'demo-paired', name: ticket.name, platform: ticket.platform, version: ticket.version, online: true, revoked: false, lastSeen: this.now() };
      this.data.nodes.push(node); return node;
    });
  }
  revoke(nodeId, id) {
    return this.mutate(id, `撤销远程访问:${nodeId}`, () => {
      const node = this.data.nodes.find(n => n.id === nodeId);
      if (!node) throw fault('NOT_FOUND', '设备不存在');
      node.revoked = true; node.online = false; return { nodeId };
    });
  }
  markRead(id) { const item = this.data.notifications.find(n => n.id === id); if (item) item.read = true; this.notify({ kind: 'snapshot' }); }
  setOnline(id, online) { const node = this.data.nodes.find(n => n.id === id); if (node) { node.online = online; node.lastSeen = this.now(); this.notify({ kind: 'snapshot' }); } }
}
module.exports = { FakeGateway, fault };
