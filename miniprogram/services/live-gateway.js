const { validate, normalize, projectEvent, itemView } = require('./wire');
const config = require('../config');
const MODELS = { nodes: 'Node', projects: 'Project', agents: 'Agent', sessions: 'Session', requests: 'InteractionRequest', notifications: 'Notification', audit: 'Audit' };
const PAGES = { nodes: 'NodesPage', projects: 'ProjectsPage', agents: 'AgentsPage', sessions: 'SessionsPage', requests: 'RequestsPage', notifications: 'NotificationsPage', audit: 'AuditsPage' };
const KINDS = { node: 'nodes', project: 'projects', agent: 'agents', session: 'sessions', request: 'requests', notification: 'notifications', audit: 'audit' };
const clone = value => JSON.parse(JSON.stringify(value));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const query = values => Object.keys(values).filter(k => values[k] !== undefined && values[k] !== '').map(k => encodeURIComponent(k) + '=' + encodeURIComponent(values[k])).join('&');
function fault(code, message) { return Object.assign(new Error(message), { code }); }
class LiveGateway {
  constructor(options = {}) {
    this.options = Object.assign({}, config, options); this.wx = options.wx || null;
    this.base = (this.options.gatewayURL || '').replace(/\/$/, '');
    if (!/^https:\/\/[^/?#@]+$/.test(this.base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(this.base)) throw fault('LIVE_NOT_CONFIGURED', '请配置 HTTPS Gateway 地址；HTTP 仅允许本机联调。');
    this.isLive = true; this.listeners = new Set(); this.generation = 0; this.socketEpoch = 0; this.bodyGeneration = 0;
    this.connection = 'offline'; this.token = ''; this.clear();
  }
  api() { return this.wx || wx; }
  clear() {
    this.bodyGeneration++;
    this.data = {}; Object.keys(MODELS).forEach(k => { this.data[k] = []; });
    this.pages = {}; this.ops = {}; this.files = {}; this.fetches = {}; this.invalidations = {}; this.removed = {};
    this.watched = {}; this.metadataSequence = {}; this.revision = 0; this.hydrated = false; this.user = null; this.counts = {}; this.clockOffset = 0;
  }
  clearLocalContent() {
    this.bodyGeneration++;
    this.watched = {}; this.files = {}; this.metadataSequence = {};
    // Close the old transport instead of racing an unwatch ACK with old frames.
    // Runtime reconnects metadata-only; the next explicit visit watches from zero.
    this.disconnect();
  }
  assertBodyGeneration(generation) {
    if (generation !== this.bodyGeneration) throw fault('CONTENT_CLEARED', '本地内容已清除，请重新打开会话');
  }
  now() { return Date.now() + this.clockOffset; }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(value) { this.listeners.forEach(fn => fn(value)); }
  state(value) { this.connection = value; this.emit({ kind: 'connection', state: value }); }
  snapshot() { return clone(this.data); }
  async id(prefix = 'op') {
    const result = await new Promise((resolve, reject) => {
      const api = this.api();
      if (typeof api.getRandomValues !== 'function') return reject(fault('CRYPTO_UNAVAILABLE', '请升级微信基础库以使用安全随机数。'));
      api.getRandomValues({ length: 16, success: resolve, fail: () => reject(fault('CRYPTO_UNAVAILABLE', '安全随机数生成失败')) });
    });
    // 开发者工具的回调对象来自另一个 JS realm，instanceof ArrayBuffer 恒为 false；按 byteLength 鸭子类型判断。
    const bytes = result.randomValues;
    if (!bytes || Object.prototype.toString.call(bytes) !== '[object ArrayBuffer]' || bytes.byteLength !== 16) throw fault('CRYPTO_UNAVAILABLE', '安全随机数不可用');
    return prefix + '_' + Array.from(new Uint8Array(bytes)).map(x => x.toString(16).padStart(2, '0')).join('');
  }
  async request(path, model, method = 'GET', data, inputModel, operationId) {
    if (inputModel) validate(inputModel, data);
    if (operationId) validate('Id', operationId);
    if (Date.now() < (this.rateUntil || 0)) throw fault('RATE_LIMITED', '请求过于频繁，请稍后重试');
    const generation = this.generation, token = this.token;
    let response;
    try {
      response = await new Promise((resolve, reject) => this.api().request({
        url: this.base + '/v1' + path, method, data, timeout: this.options.requestTimeoutMs || 15000,
        header: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}, operationId ? { 'Idempotency-Key': operationId } : {}),
        success: resolve, fail: event => reject(Object.assign(fault('NETWORK_ERROR', 'Gateway 网络请求失败，请检查网络连接'), {
          nativeDetail: require('../utils/socket-error').nativeDetail(event), phase: 'request',
          endpoint: this.base + '/v1' + path.split('?')[0]
        }))
      }));
    } catch (error) { if (operationId) error.uncertain = true; throw error; }
    if (generation !== this.generation) throw Object.assign(fault('AUTH_CHANGED', '连接上下文已改变，请核实结果'), { uncertain: !!operationId });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      let body;
      try { body = validate('ErrorResponse', response.data).error; }
      catch (error) { if (operationId) error.uncertain = true; throw error; }
      const error = Object.assign(new Error(body.message), body, { status: response.statusCode, uncertain: !!operationId && response.statusCode >= 500 });
      if (response.statusCode === 429) {
        const headers = response.header || {}, seconds = Number(headers['Retry-After'] || headers['retry-after']) || 60;
        this.rateUntil = Date.now() + Math.min(3600, seconds) * 1000;
      }
      if (response.statusCode === 401) { this.reset(); this.emit({ kind: 'unauthenticated' }); }
      throw error;
    }
    try { return validate(model, response.data); }
    catch (error) { if (operationId) error.uncertain = true; throw error; }
  }
  async login(mode) {
    this.reset(); const generation = this.generation, authMode = mode || this.options.authMode || 'wechat';
    let code;
    if (authMode === 'development') {
      const api = this.api(), info = api.getDeviceInfo ? api.getDeviceInfo() : api.getSystemInfoSync();
      if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(this.base) || info.platform !== 'devtools') throw fault('DEV_AUTH_DISABLED', '开发身份仅可在开发者工具连接本机 Gateway 时使用');
      code = 'dev:' + (this.options.developmentIdentity || 'weagent-local');
    } else if (authMode === 'wechat') {
      const result = await new Promise((resolve, reject) => this.api().login({ success: resolve, fail: () => reject(fault('LOGIN_FAILED', '微信登录未完成')) })); code = result.code;
    } else throw fault('LOGIN_FAILED', '未知登录模式');
    if (generation !== this.generation) throw fault('AUTH_CHANGED', '登录已取消');
    const result = await this.request('/auth/wechat', 'LoginResult', 'POST', { code }, 'Login');
    this.token = result.accessToken; this.user = normalize(result.user); this.authMode = authMode;
    try { await this.bootstrap(true); } catch (error) { this.reset(); throw error; }
  }
  async getProfile() {
    return this.request('/me/profile', 'UserProfile');
  }
  async saveProfile(profile) {
    const value = await this.request('/me/profile', 'UserProfile', 'PATCH', profile, 'UpdateUserProfile');
    if (this.user) this.user.displayName = value.displayName;
    return value;
  }
  async logout() {
    const work = this.token ? this.request('/auth/logout', 'Health', 'POST', {}, 'Empty') : Promise.resolve();
    this.reset(); try { await work; } catch (_) { /* Local logout also succeeds when the network is unavailable. */ }
  }
  reset() { require('../utils/profile-image').clearAvatars(this.wx || (typeof wx !== 'undefined' ? wx : null)); this.generation++; this.token = ''; this.disconnect(); this.clear(); this.rateUntil = 0; }
  lookup(kind, id) { return this.data[kind].find(x => x.id === id); }
  allowed(value) {
    const node = value.nodeId && this.lookup('nodes', value.nodeId), session = value.sessionId && this.lookup('sessions', value.sessionId);
    return !(node && node.revoked) && !(session && (session.historyState === 'purged' || this.lookup('nodes', session.nodeId) && this.lookup('nodes', session.nodeId).revoked));
  }
  put(kind, value) {
    if (this.removed[kind + ':' + value.id] || value.nodeId && this.removed['nodes:' + value.nodeId] || value.sessionId && this.removed['sessions:' + value.sessionId] || !this.allowed(value)) return;
    const old = this.lookup(kind, value.id);
    if (old && (old.revision > value.revision || kind === 'nodes' && old.revoked && !value.revoked)) return;
    const next = normalize(value);
    if (old) this.data[kind][this.data[kind].indexOf(old)] = next; else this.data[kind].push(next);
    if (kind === 'nodes' && next.revoked) this.purgeNode(next.id);
    if (kind === 'sessions' && next.historyState === 'purged') this.purgeSession(next.id, false);
  }
  invalidate(kind, id) { const key = kind + ':' + id; this.invalidations[key] = (this.invalidations[key] || 0) + 1; }
  remove(kind, id) {
    this.removed[kind + ':' + id] = true;
    this.invalidate(kind, id);
    if (kind === 'nodes') this.purgeNode(id);
    if (kind === 'sessions') this.purgeSession(id, true);
    this.data[kind] = this.data[kind].filter(x => x.id !== id);
  }
  purgeNode(id) {
    this.removed['nodes:' + id] = true;
    const node = this.lookup('nodes', id); if (node) { node.online = false; node.revoked = true; }
    this.invalidate('nodes', id);
    this.data.sessions.filter(s => s.nodeId === id).forEach(s => this.purgeSession(s.id, true));
    ['projects', 'agents', 'sessions'].forEach(kind => {
      this.data[kind].filter(x => x.nodeId === id).forEach(x => this.invalidate(kind, x.id));
      this.data[kind] = this.data[kind].filter(x => x.nodeId !== id);
    }); this.emit({ kind: 'purge' });
  }
  purgeSession(id, removed) {
    this.removed['sessions:' + id] = true;
    delete this.watched[id]; delete this.metadataSequence[id]; this.invalidate('sessions', id);
    ['requests', 'notifications'].forEach(kind => {
      this.data[kind].filter(x => x.sessionId === id).forEach(x => this.invalidate(kind, x.id));
      this.data[kind] = this.data[kind].filter(x => x.sessionId !== id);
    });
    Object.keys(this.files).forEach(key => { if (this.files[key].sessionId === id) delete this.files[key]; });
    this.emit({ kind: 'purge', sessionId: id, removed });
  }
  async resource(kind, id, force = false) {
    validate('Id', id); const cached = this.lookup(kind, id);
    if (cached && !force) return cached;
    const key = kind + ':' + id, generation = this.generation, invalidation = this.invalidations[key] || 0;
    if (this.fetches[key]) return this.fetches[key];
    const work = (async () => {
      try {
        const value = await this.request('/' + kind + '/' + encodeURIComponent(id), MODELS[kind]);
        if (generation !== this.generation || invalidation !== (this.invalidations[key] || 0)) throw fault('RESOURCE_CHANGED', '资源已改变，请重新加载');
        this.put(kind, value); return this.lookup(kind, id);
      } catch (error) { if (generation === this.generation && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) this.remove(kind, id); throw error; }
    })();
    this.fetches[key] = work;
    try { return await work; } finally { if (this.fetches[key] === work) delete this.fetches[key]; }
  }
  async ensure(kind, id, force = false) {
    const value = await this.resource(kind, id, force);
    if (!value) throw fault('NOT_FOUND', '资源已失效');
    if (kind === 'sessions') await Promise.all([this.resource('nodes', value.nodeId), this.resource('projects', value.projectId), this.resource('agents', value.agentId)]);
    else if (kind === 'requests') await this.ensure('sessions', value.sessionId);
    else if (value.nodeId) await this.resource('nodes', value.nodeId);
    return value;
  }
  async list(kind, filters = {}, pageToken) {
    const page = await this.request('/' + kind + '?' + query(Object.assign({ limit: 100 }, filters, { pageToken })), PAGES[kind]);
    page.items.forEach(value => this.put(kind, value));
    if (kind === 'sessions' || kind === 'requests') await Promise.all(page.items.map(value => this.ensure(kind, value.id).catch(e => { if (!['FORBIDDEN', 'NOT_FOUND'].includes(e.code)) throw e; })));
    this.emit({ kind: 'resources' }); return page;
  }
  async bootstrap(initial = false) {
    const start = Date.now(), body = await this.request('/bootstrap', 'Bootstrap');
    this.clockOffset = Date.parse(body.serverTime) - Math.floor((start + Date.now()) / 2);
    this.user = normalize(body.user); this.counts = body.counts;
    Object.keys(MODELS).forEach(kind => { body[kind].items.forEach(value => this.put(kind, value)); this.pages[kind] = body[kind].nextPageToken; });
    if (initial) this.revision = body.revision;
    for (const kind of ['nodes', 'projects', 'agents']) {
      let cursor = body[kind].nextPageToken;
      while (cursor) { const page = await this.list(kind, {}, cursor); cursor = page.nextPageToken; }
      this.pages[kind] = null;
    }
    await Promise.all(this.data.sessions.map(s => this.ensure('sessions', s.id)));
    await Promise.all(this.data.requests.map(r => this.ensure('requests', r.id).catch(e => { if (!['NOT_FOUND', 'FORBIDDEN'].includes(e.code)) throw e; })));
    this.hydrated = true; this.emit({ kind: 'resources' }); return body;
  }
  async syncChanges(until) {
    if (this.syncing) { await this.syncing; if (until === undefined || this.revision >= until) return; }
    const generation = this.generation, bodyGeneration = this.bodyGeneration;
    const work = (async () => {
      let after = this.revision, barrier = until, more; const latest = {};
      if (until !== undefined && after >= until) return;
      try {
        do {
          const page = await this.request('/changes?' + query({ after, until: barrier, limit: 200 }), 'ChangesPage');
          if (page.after !== after || barrier !== undefined && page.highWater !== barrier || page.nextAfter < after || page.hasMore && page.nextAfter === after) throw fault('INVALID_PROTOCOL', '资源变更游标不连续');
          barrier = page.highWater; page.changes.forEach(c => { latest[c.resourceType + ':' + c.resourceId] = c; });
          after = page.nextAfter; more = page.hasMore;
        } while (more);
      } catch (e) {
        if (e.code !== 'CURSOR_EXPIRED') throw e;
        if (generation !== this.generation || bodyGeneration !== this.bodyGeneration) return;
        const watched = Object.keys(this.watched), operations = this.ops;
        this.generation++; this.clear(); this.ops = operations;
        const resetGeneration = this.bodyGeneration;
        this.emit({ kind: 'reset-body' }); await this.bootstrap(true);
        if (resetGeneration !== this.bodyGeneration) return;
        for (const id of watched) {
          try { await this.ensure('sessions', id); if (resetGeneration !== this.bodyGeneration) return; if (!this.removed['sessions:' + id]) this.watched[id] = 0; }
          catch (error) { if (!['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) throw error; }
        }
        return;
      }
      const changes = Object.values(latest);
      if (changes.length) {
        changes.filter(c => c.action === 'remove').forEach(c => { if (KINDS[c.resourceType]) this.remove(KINDS[c.resourceType], c.resourceId); });
        await this.bootstrap(false);
        for (const c of changes.filter(c => c.action === 'upsert')) {
          if (c.resourceType === 'operation') { if (this.ops[c.resourceId] && this.ops[c.resourceId].revision < c.resourceRevision) await this.operation(c.resourceId); continue; }
          const kind = KINDS[c.resourceType], old = this.lookup(kind, c.resourceId);
          if (old && old.revision >= c.resourceRevision || ['notifications', 'audit'].includes(kind)) continue;
          try { await this.ensure(kind, c.resourceId, true); } catch (e) { if (!['NOT_FOUND', 'FORBIDDEN'].includes(e.code)) throw e; }
        }
      }
      if (generation === this.generation) this.revision = after;
    })();
    this.syncing = work;
    try { await work; } finally { if (this.syncing === work) this.syncing = null; }
  }
  scheduleChanges() {
    if (this.changeTimer) return;
    const generation = this.generation;
    this.changeTimer = setTimeout(() => { this.changeTimer = null; this.syncChanges().catch(error => { if (generation === this.generation) this.transportError(error); }); }, this.options.changeDelayMs || 1200);
  }
  consume(event) {
    validate('SessionEvent', event);
    const session = this.lookup('sessions', event.sessionId);
    if (!session || !this.allowed(session) || session.historyState === 'purged') return null;
    const d = event.data, newer = event.sequence > (this.metadataSequence[event.sessionId] || 0);
    if (event.type === 'request.upsert') this.put('requests', d);
    if (event.type === 'diff.file') this.files[d.id] = normalize(d);
    if (newer) {
      this.metadataSequence[event.sessionId] = event.sequence;
      if (event.type === 'session.state' && d.revision >= session.revision) Object.assign(session, d);
      if (event.type === 'queue.updated' && event.sequence > session.lastSequence) session.queue = clone(d.items);
      if (event.type === 'capabilities.updated' && d.capabilityRevision >= session.capabilityRevision) Object.assign(session, d);
      session.lastSequence = Math.max(session.lastSequence, event.sequence);
    }
    return projectEvent(event, d.requestId && this.lookup('requests', d.requestId));
  }
  async events(id, after, until) {
    const bodyGeneration = this.bodyGeneration;
    const page = await this.request('/sessions/' + encodeURIComponent(id) + '/events?' + query({ after, until, limit: 200 }), 'EventsPage');
    this.assertBodyGeneration(bodyGeneration);
    if (page.sessionId !== id || page.after !== after || until !== undefined && page.highWater !== until) throw fault('INVALID_PROTOCOL', '会话历史屏障不匹配');
    let cursor = after;
    page.events.forEach(e => { if (e.sessionId !== id || e.sequence !== ++cursor) throw fault('INVALID_PROTOCOL', '会话历史不连续'); });
    if (cursor !== page.nextAfter || page.nextAfter > page.highWater || page.hasMore !== (page.nextAfter < page.highWater)) throw fault('INVALID_PROTOCOL', '会话历史游标不匹配');
    return Object.assign({}, page, { events: page.events.map(e => this.consume(e)).filter(Boolean) });
  }
  async checkpoint(id) {
    const bodyGeneration = this.bodyGeneration;
    const checkpoint = await this.request('/sessions/' + encodeURIComponent(id) + '/checkpoint', 'Checkpoint');
    this.assertBodyGeneration(bodyGeneration);
    if (checkpoint.sessionId !== id) throw fault('INVALID_PROTOCOL', '检查点会话不匹配');
    const items = []; let token;
    do {
      const page = await this.request('/checkpoints/' + encodeURIComponent(checkpoint.id) + '/items?' + query({ pageToken: token, limit: 100 }), 'CheckpointItemsPage');
      this.assertBodyGeneration(bodyGeneration);
      if (page.checkpointId !== checkpoint.id || page.sequence !== checkpoint.sequence || page.nextPageToken && page.nextPageToken === token) throw fault('INVALID_PROTOCOL', '检查点分页不匹配');
      items.push(...page.items); token = page.nextPageToken;
    } while (token);
    if (items.length !== checkpoint.itemCount) throw fault('INVALID_PROTOCOL', '检查点正文不完整');
    await Promise.all(items.filter(i => i.type === 'request').map(i => this.ensure('requests', i.requestId).catch(e => { if (!['NOT_FOUND', 'FORBIDDEN'].includes(e.code)) throw e; })));
    this.assertBodyGeneration(bodyGeneration);
    return { sequence: checkpoint.sequence, items: items.map(i => itemView(i, this.lookup('requests', i.requestId))) };
  }
  sendFrame(type, data) {
    const frame = validate('ClientFrame', { version: 'weagent/1', type, data });
    if (!this.socket) return Promise.reject(fault('NETWORK_ERROR', '实时连接尚未建立'));
    return new Promise((resolve, reject) => this.socket.send({ data: JSON.stringify(frame), success: resolve, fail: () => reject(fault('NETWORK_ERROR', '实时连接发送失败')) }));
  }
  sendWatch() { return this.sendFrame('watch', { revision: this.revision, sessions: Object.keys(this.watched).map(sessionId => ({ sessionId, after: this.watched[sessionId] })) }); }
  async watch(id, after) {
    if (!(id in this.watched) && Object.keys(this.watched).length >= 20) delete this.watched[Object.keys(this.watched)[0]];
    const added = !(id in this.watched); this.watched[id] = after;
    if (added && this.socket && this.connection === 'online') await this.sendWatch();
  }
  async unwatch(sessionIds) {
    const removed = sessionIds.filter(id => id in this.watched);
    removed.forEach(id => delete this.watched[id]);
    if (removed.length && this.socket && this.connection === 'online') await this.sendFrame('unwatch', { sessionIds: removed });
  }
  async ready(data) {
    const epoch = this.socketEpoch;
    await this.syncChanges(data.revision);
    if (epoch !== this.socketEpoch) return;
    if (this.onBarrier) await this.onBarrier(data.sessions.filter(s => s.sessionId in this.watched));
  }
  connect() {
    if (this.connection === 'online' && this.socket) return Promise.resolve();
    if (this.connecting) return this.connecting;
    if (!this.token) return Promise.reject(fault('UNAUTHENTICATED', '请先登录'));
    clearTimeout(this.retryTimer); this.state('recovering'); const epoch = ++this.socketEpoch;
    this.connecting = new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); this.connecting = null; error ? reject(error) : resolve(); };
      const timer = setTimeout(() => {
        const error = require('../utils/socket-error').socketError({ errMsg: 'realtime connection timeout' }, opened);
        finish(error); this.transportError(error);
      }, 15000);
      this.connectFinish = finish; let task, opened = false;
      const lost = event => {
        if (epoch !== this.socketEpoch) return;
        const error = require('../utils/socket-error').socketError(event, opened);
        finish(error); this.transportError(error);
      };
      // Native APIs can fail synchronously. Defer cleanup until the connection promise is assigned.
      try { task = this.api().connectSocket({ url: this.base.replace(/^http/, 'ws') + '/v1/ws/client', header: { Authorization: 'Bearer ' + this.token }, success() {}, fail: event => Promise.resolve().then(() => lost(event)) }); }
      catch (error) { Promise.resolve().then(() => lost(error)); return; }
      if (!task || typeof task.onOpen !== 'function') { Promise.resolve().then(() => lost({})); return; }
      this.socket = task;
      task.onOpen(() => { if (epoch === this.socketEpoch) { opened = true; this.sendWatch().catch(error => { if (epoch === this.socketEpoch) this.transportError(error); }); } });
      task.onMessage(message => {
        if (epoch !== this.socketEpoch) return;
        try {
          if (typeof message.data !== 'string' || message.data.length > 262144) throw fault('INVALID_PROTOCOL', '实时帧无效');
          const frame = validate('ServerFrame', JSON.parse(message.data));
          if (frame.type === 'ready') {
            clearInterval(this.heartbeat);
            // History may take longer than a heartbeat period. Keep the socket alive
            // during recovery, without enabling commands before the barrier completes.
            this.heartbeat = setInterval(async () => {
              try { const nonce = await this.id('ping'); if (epoch === this.socketEpoch) await this.sendFrame('heartbeat', { nonce }); }
              catch (error) { if (epoch === this.socketEpoch) this.transportError(error); }
            }, frame.data.heartbeatSeconds * 1000);
            this.readyChain = (this.readyChain || Promise.resolve()).then(async () => {
              if (epoch !== this.socketEpoch) return;
              await this.ready(frame.data); if (epoch !== this.socketEpoch) return;
              this.lastError = null; this.state('online'); this.retries = 0; finish();
            }).catch(error => { if (epoch === this.socketEpoch) { finish(error); this.transportError(error); } });
          } else if (frame.type === 'event' && frame.data.sessionId in this.watched) { const event = this.consume(frame.data); if (event) this.emit({ kind: 'event', event }); }
          else if (frame.type === 'operation') this.acceptOperation(frame.data);
          else if (frame.type === 'change') { if (frame.data.action === 'remove' && KINDS[frame.data.resourceType]) this.remove(KINDS[frame.data.resourceType], frame.data.resourceId); this.scheduleChanges(); }
          else if (frame.type === 'error') throw Object.assign(new Error(frame.data.message), frame.data);
        } catch (error) { finish(error); this.transportError(error); }
      });
      task.onClose(lost); task.onError(lost);
    });
    const work = this.connecting;
    work.then(() => { if (this.connecting === work) this.connecting = null; }, () => { if (this.connecting === work) this.connecting = null; });
    return work;
  }
  transportError(error) {
    if (error && error.code === 'UNAUTHENTICATED') { this.reset(); this.emit({ kind: 'unauthenticated' }); return; }
    this.lastError = error ? { code: error.code || 'NETWORK_ERROR', message: error.message, nativeDetail: error.nativeDetail || '', phase: error.phase || '', closeCode: error.closeCode || null } : { code: 'NETWORK_ERROR', message: '实时连接已断开' };
    this.disconnect(); this.state('error');
    if (this.token && !this.paused) {
      const delay = Math.max(Math.min(30000, 1000 * Math.pow(2, this.retries || 0)), (this.rateUntil || 0) - Date.now());
      this.retries = (this.retries || 0) + 1;
      const generation = this.generation;
      this.retryTimer = setTimeout(async () => {
        try {
          if (error && error.code === 'CURSOR_EXPIRED') {
            await this.syncChanges();
            if (this.onBarrier) await this.onBarrier(Object.keys(this.watched).map(sessionId => ({ sessionId })));
          }
          if (this.token && (generation === this.generation || error && error.code === 'CURSOR_EXPIRED')) await this.connect();
        } catch (failure) { if (generation === this.generation) this.transportError(failure); }
      }, delay);
    }
  }
  disconnect() {
    this.socketEpoch++; clearInterval(this.heartbeat); clearTimeout(this.changeTimer); clearTimeout(this.retryTimer);
    this.changeTimer = null; this.readyChain = null;
    if (this.connectFinish) this.connectFinish(fault('NETWORK_ERROR', '实时连接已关闭'));
    this.connectFinish = null; this.connecting = null;
    const task = this.socket; this.socket = null;
    if (task) task.close({ code: 1000, reason: 'client disconnect' }); this.state('offline');
  }
  acceptOperation(value) {
    validate('Operation', value); const old = this.ops[value.id];
    if (old && old.revision > value.revision) return old;
    this.ops[value.id] = normalize(value); this.emit({ kind: 'operation', id: value.id, state: value.state }); return this.ops[value.id];
  }
  async operation(id) { validate('Id', id); return this.acceptOperation(await this.request('/operations/' + encodeURIComponent(id), 'Operation')); }
  async awaitOperation(value) {
    // Methods return normalized receipts; do not revalidate UI timestamps as wire timestamps.
    let op = this.ops[value.id] || value, nextPoll = Date.now() + 1500;
    const end = Date.now() + (this.options.operationWaitMs || 10000), generation = this.generation;
    while (!['confirmed', 'failed'].includes(op.state) && Date.now() < end) {
      await sleep(100); if (generation !== this.generation) throw fault('AUTH_CHANGED', '登录身份已改变');
      op = this.ops[op.id] || op;
      if (Date.now() >= nextPoll) { try { op = await this.operation(op.id); } catch (_) { return { unknown: true, operationId: op.id }; } nextPoll = Date.now() + 2000; }
    }
    if (op.state === 'failed') throw Object.assign(new Error(op.error.message), op.error);
    if (op.state !== 'confirmed') return { unknown: true, operationId: op.id };
    try { return await this.operationResult(op); }
    catch (error) { error.uncertain = true; throw error; } // Accepted work is not undone by a failed UI refresh.
  }
  async operationResult(op) {
    const result = op.result || {};
    if (op.kind === 'native') { if(result.sessionId)await this.ensure('sessions', result.sessionId, true); return result.native; }
    if (op.kind === 'revoke' && result.nodeId) { this.purgeNode(result.nodeId); await this.resource('nodes', result.nodeId, true).catch(() => {}); }
    if (op.kind === 'pair' && result.nodeId) { await this.bootstrap(false); return this.ensure('nodes', result.nodeId); }
    if (op.kind === 'respond' && result.requestId) return this.ensure('requests', result.requestId, true);
    if (result.sessionId) return this.ensure('sessions', result.sessionId, true);
    return result;
  }
  issue(path, body, model, id) { return this.request(path, 'Operation', 'POST', body, model, id).then(value => this.acceptOperation(value)); }
  create(input, id) {
    const agent = this.lookup('agents', input.agentId);
    return this.issue('/sessions', Object.assign({}, input, { capabilityRevision: agent && agent.capabilityRevision }), 'CreateSession', id);
  }
  send(id, turnId, text, mode, opId) {
    const session = this.lookup('sessions', id);
    return this.issue('/sessions/' + encodeURIComponent(id) + '/messages', { expectedTurnId: turnId, text, mode, capabilityRevision: session && session.capabilityRevision }, 'SendMessage', opId);
  }
  workspaceStep(id, input, opId) { return this.issue('/sessions/' + encodeURIComponent(id) + '/native', input, 'NativeControl', opId); }
  projectHistory(input,opId) { return this.issue('/history/native',input,'ProjectHistory',opId); }
  sendInput(id, turnId, text, mode, input, opId) {
    const session = this.lookup('sessions', id);
    return this.issue('/sessions/' + encodeURIComponent(id) + '/messages', Object.assign({ expectedTurnId: turnId, text, mode, capabilityRevision: session && session.capabilityRevision }, input), 'SendMessage', opId);
  }
  organizeSession(id, metadata, opId) { return this.issue('/sessions/' + encodeURIComponent(id) + '/metadata', metadata, 'SessionMetadata', opId); }
  deleteHistory(id, selection, opId) { return this.issue('/sessions/' + encodeURIComponent(id) + '/history/delete', selection, 'DeleteHistory', opId); }
  exportHistory(id) { return this.request('/sessions/' + encodeURIComponent(id) + '/export', 'HistoryExport'); }
  importHistory(input, opId) { return this.issue('/history/import', input, 'ImportHistory', opId); }
  subscriptionConfig() { return this.request('/subscriptions/config', 'SubscriptionConfig'); }
  subscribeConsent(choices, opId) { return this.issue('/subscriptions/consent', { choices, nonce: opId }, 'SubscriptionConsent', opId); }
  cancel(id, turnId, opId) {
    const session = this.lookup('sessions', id);
    return this.issue('/sessions/' + encodeURIComponent(id) + '/cancel', { expectedTurnId: turnId, capabilityRevision: session && session.capabilityRevision }, 'CancelTurn', opId);
  }
  native(id, turnId, control, opId) {
    const session = this.lookup('sessions', id);
    return this.issue('/sessions/' + encodeURIComponent(id) + '/native', { expectedTurnId: turnId, capabilityRevision: session && session.capabilityRevision, control }, 'NativeControl', opId);
  }
  respond(id, answer, opId) {
    const request = this.lookup('requests', id), session = request && this.lookup('sessions', request.sessionId);
    if (!request || !session) throw fault('NOT_FOUND', '请先加载请求与会话');
    const decision = request.kind === 'approval' ? { kind: 'approval', choiceId: answer } : { kind: 'question', answers: answer };
    return this.issue('/requests/' + encodeURIComponent(id) + '/respond', { expectedTurnId: request.turnId, requestRevision: request.revision, capabilityRevision: session.capabilityRevision, decision }, 'RespondRequest', opId);
  }
  async previewPair(code) {
    const ticket = normalize(await this.request('/pairings/preview', 'PairPreview', 'POST', { code: code.trim().toUpperCase() }, 'PairPreviewInput'));
    return Object.assign(ticket, { id: ticket.ticketId, name: ticket.nodeName });
  }
  confirmPair(ticketId, id) { return this.issue('/pairings/confirm', { ticketId }, 'PairConfirm', id); }
  revoke(nodeId, id) { return this.issue('/nodes/' + encodeURIComponent(nodeId) + '/revoke', {}, 'Empty', id); }
  async markRead(notificationId, id) { return this.issue('/notifications/' + encodeURIComponent(notificationId) + '/read', {}, 'Empty', id || await this.id('read')); }
  async diffFile(id, sessionId) {
    const bodyGeneration = this.bodyGeneration;
    validate('Id', id); const value = await this.request('/diff-files/' + encodeURIComponent(id), 'DiffFile');
    this.assertBodyGeneration(bodyGeneration);
    if (this.removed['sessions:' + sessionId] || value.sessionId !== sessionId || !this.allowed(value)) throw fault('FORBIDDEN', '差异快照不属于当前会话');
    this.files[id] = normalize(value); return this.files[id];
  }
  dispose() { this.reset(); this.listeners.clear(); }
}
module.exports = { LiveGateway };
