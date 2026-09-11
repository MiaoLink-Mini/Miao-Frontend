const { FakeGateway } = require('./fake-gateway');
const { LiveGateway } = require('./live-gateway');
const { emptyTimeline, mergeEvents } = require('../stores/timeline');
const { STATE_NAMES, ACTIVE } = require('../utils/policy');
const config = require('../config');
const { agentIcon } = require('../utils/agent-brand');
const { errorText } = require('../utils/error-display');
class Runtime {
  constructor(gateway) {
    this.gateway = gateway || (config.mode === 'demo' ? new FakeGateway() : new LiveGateway());
    this.live = this.gateway.isLive === true;
    this.auth = false; this.connection = this.live ? 'offline' : 'online'; this.listeners = new Set();
    this.timelines = {}; this.loading = {}; this.drafts = {}; this.operations = {}; this.recoveryEvents = {};
    this.inputDrafts = {}; this.uploadJobs = {}; this.localFiles = {};
    this.preferences = { largeText: false, completedNotices: true }; this.epoch = 0; this.bodyEpoch = {}; this.contentEpoch = 0;
    this.unsubscribe = this.gateway.subscribe(event => this.receive(event));
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() {
    if (this.renderTimer) return;
    this.renderTimer = setTimeout(() => { this.renderTimer = null; this.listeners.forEach(fn => fn()); }, 80);
  }
  async login(mode) {
    const epoch = ++this.epoch; this.clearWorkspaceContent();
    if (this.live) {
      this.auth = false; this.timelines = {}; this.loading = {}; this.recoveryEvents = {}; this.drafts = {}; this.operations = {}; this.changed();
      // 真实认证 + 初始 hydrate（token、bootstrap），失败时错误直接上抛，不回退演示数据。
      await this.gateway.login(mode);
      if (epoch !== this.epoch) return;
      this.auth = true; this.connection = 'recovering'; this.changed();
      await this.recover();
      return;
    }
    this.auth = true; await this.recover(); this.changed();
  }
  async logout() {
    this.epoch++; this.auth = false; this.clearWorkspaceContent();
    this.timelines = {}; this.loading = {}; this.drafts = {}; this.operations = {};
    this.recoveryEvents = {}; this.connection = this.live ? 'offline' : 'online'; this.changed();
    if (this.live) { try { await this.gateway.logout(); } catch (_) { /* 本地登出不受网络影响 */ } }
    this.connection = this.live ? 'offline' : 'online'; this.changed();
  }
  async clearLocalContent() {
    // Clearing bodies must not cancel authentication or lose an accepted command.
    // A separate epoch fences history/checkpoint reads without changing auth epoch.
    this.contentEpoch++; this.clearWorkspaceContent();
    this.timelines = {}; this.loading = {}; this.drafts = {}; this.recoveryEvents = {}; this.bodyEpoch = {};
    if (this.live) this.gateway.clearLocalContent();
    this.changed();
    if (!this.live || !this.auth) return { reconnected: true };
    try { await this.recover(); return { reconnected: true }; }
    catch (_) { return { reconnected: false }; } // Bodies are cleared even offline.
  }
  receive(payload) {
    if (!this.auth) return;
    if (payload.kind === 'connection') {
      this.connection = payload.state;
    } else if (payload.kind === 'event') {
      const id = payload.event.sessionId;
      if (this.live && !(id in this.gateway.watched)) return;
      const session = this.snapshot().sessions.find(s => s.id === id);
      if (!session || session.historyState === 'purged') return;
      if (this.recoveryEvents[id]) this.recoveryEvents[id].push(payload.event);
      this.timelines[id] = mergeEvents(this.timelines[id] || emptyTimeline(id), [payload.event]);
      if (this.live && this.gateway.watched && id in this.gateway.watched) this.gateway.watched[id] = this.timelines[id].cursor;
      if (this.timelines[id].gap) this.loadTimeline(id).catch(() => { this.connection = 'error'; this.changed(); });
    } else if (payload.kind === 'operation') {
      this.operations[payload.id] = payload.state;
    } else if (payload.kind === 'purge') {
      if (payload.sessionId) { this.clearWorkspaceContent(payload.sessionId); this.bodyEpoch[payload.sessionId] = (this.bodyEpoch[payload.sessionId] || 0) + 1; delete this.timelines[payload.sessionId]; delete this.drafts[payload.sessionId]; }
      this.purgeRevoked();
    } else if (payload.kind === 'reset-body') {
      this.clearWorkspaceContent();
      new Set([...Object.keys(this.timelines), ...Object.keys(this.loading)]).forEach(id => { this.bodyEpoch[id] = (this.bodyEpoch[id] || 0) + 1; });
      this.timelines = {}; this.loading = {}; this.recoveryEvents = {}; this.drafts = {};
    } else if (payload.kind === 'unauthenticated') {
      this.clearWorkspaceContent();
      this.epoch++; this.auth = false; this.timelines = {}; this.loading = {}; this.recoveryEvents = {}; this.drafts = {}; this.operations = {};
    }
    this.purgeRevoked(); this.changed();
  }
  purgeRevoked() {
    const data = this.gateway.snapshot(); const allowed = new Set(data.nodes.filter(n => !n.revoked).map(n => n.id));
    const ids = new Set(data.sessions.filter(s => allowed.has(s.nodeId) && s.historyState !== 'purged').map(s => s.id));
    new Set([...Object.keys(this.timelines), ...Object.keys(this.drafts), ...Object.keys(this.inputDrafts), ...Object.keys(this.uploadJobs), ...Object.keys(this.localFiles)]).forEach(id => {
      if (!ids.has(id)) { delete this.timelines[id]; delete this.drafts[id]; this.clearWorkspaceContent(id); }
    });
  }
  clearWorkspaceContent(sessionId) {
    const ids = sessionId ? [sessionId] : new Set([...Object.keys(this.inputDrafts), ...Object.keys(this.uploadJobs), ...Object.keys(this.localFiles)]);
    for (const id of ids) {
      delete this.inputDrafts[id]; delete this.uploadJobs[id];
      for (const path of this.localFiles[id] || []) {
        try { const api = this.live ? this.gateway.api() : null; if (api && api.getFileSystemManager) api.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) { /* Never delete a path not created by this process. */ }
      }
      delete this.localFiles[id];
    }
  }
  inputSelection(id) { return this.inputDrafts[id] || { attachments: [], references: [], command: null }; }
  selectInput(id, item) {
    const value = this.inputSelection(id);
    const copy = { attachments: value.attachments.slice(), references: value.references.slice(), command: value.command };
    const selected = { id: item.referenceId, label: item.label, size: item.size || 0 };
    if (item.state === 'command' || item.state === 'skill') copy.command = selected;
    else {
      const key = ['received', 'accepted'].includes(item.state) ? 'attachments' : 'references';
      if (!copy[key].some(x => x.id === selected.id)) copy[key].push(selected);
      if (copy[key].length > 8) throw new Error('Maximum 8 attachments or file references per input');
    }
    this.inputDrafts[id] = copy; this.changed(); return copy;
  }
  selectedInput(id) {
    const value = this.inputSelection(id);
    return { attachments: value.attachments.map(x => x.id), references: value.references.map(x => x.id), ...(value.command ? { commandId: value.command.id } : {}) };
  }
  snapshot() {
    if (!this.auth) return { nodes: [], projects: [], agents: [], sessions: [], requests: [], notifications: [], audit: [] };
    const data = this.gateway.snapshot(); const allowed = data.nodes.filter(n => !n.revoked).map(n => n.id);
    // Paginated resources are authorized by the Gateway, not by whether their parents
    // happened to appear in bootstrap's first page. System notices have no session.
    if (this.live) return data;
    data.sessions = data.sessions.filter(s => allowed.includes(s.nodeId));
    const ids = data.sessions.map(s => s.id);
    data.requests = data.requests.filter(r => ids.includes(r.sessionId));
    data.notifications = data.notifications.filter(n => ids.includes(n.sessionId));
    data.projects = data.projects.filter(p => allowed.includes(p.nodeId));
    data.agents = data.agents.filter(a => allowed.includes(a.nodeId));
    return data;
  }
  async loadTimeline(id, until) {
    if (this.live) return this.loadLiveTimeline(id, until);
    if (this.loading[id]) return this.loading[id];
    const epoch = this.epoch, contentEpoch = this.contentEpoch;
    const work = (async () => {
      // If no body exists, start at zero even if a previous cursor was saved.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (!this.snapshot().sessions.some(s => s.id === id)) return;
        try {
          let baseline = this.timelines[id] || emptyTimeline(id), guard = 0;
          for (;;) {
            const page = await this.gateway.events(id, baseline.cursor);
            if (epoch !== this.epoch || contentEpoch !== this.contentEpoch) return;
            const events = Array.isArray(page) ? page : page.events;
            this.timelines[id] = mergeEvents(this.timelines[id] || baseline, events);
            baseline = this.timelines[id];
            if (!Array.isArray(page) && page.hasMore) {
              // 屏障内固定 highWater 分页，直到消费完为止（frontend-contract §5）。
              if (++guard > 100) throw new Error('历史事件分页过多，请重新同步');
              continue;
            }
            break;
          }
          if (!baseline.gap) break;
        } catch (error) {
          // 游标过期/历史被清理：live 走检查点重建；其余错误直接上抛。
          if (!this.live || attempt === 4 || !['CURSOR_EXPIRED', 'HISTORY_PURGED', 'INVALID_PROTOCOL'].includes(error.code)) throw error;
        }
        if (this.live) {
          const snap = await this.gateway.checkpoint(id);
          if (epoch !== this.epoch || contentEpoch !== this.contentEpoch) return;
          this.timelines[id] = { sessionId: id, cursor: snap.sequence, items: snap.items, pending: {}, gap: null, warnings: [] };
          this.changed();
        }
      }
      if (this.timelines[id] && this.timelines[id].gap) throw new Error('历史事件仍有缺口，请重新同步');
      this.changed();
    })();
    this.loading[id] = work;
    try { await work; } finally { if (this.loading[id] === work) delete this.loading[id]; }
  }
  async ensure(kind, id, force = false) {
    if (!this.live || !id) return;
    await this.gateway.ensure(kind, id, force); this.changed();
  }
  now() { return this.live ? this.gateway.now() : Date.now(); }
  async loadLiveTimeline(id, until) {
    if (!id || !this.auth) return;
    if (this.loading[id]) {
      await this.loading[id];
      if (until === undefined || this.timelines[id] && this.timelines[id].cursor >= until) return;
    }
    const epoch = this.epoch, contentEpoch = this.contentEpoch, bodyEpoch = this.bodyEpoch[id] || 0;
    const buffer = []; this.recoveryEvents[id] = buffer;
    const current = () => epoch === this.epoch && contentEpoch === this.contentEpoch && bodyEpoch === (this.bodyEpoch[id] || 0) && this.auth && this.snapshot().sessions.some(s => s.id === id && s.historyState !== 'purged');
    const work = (async () => {
      await this.ensure('sessions', id);
      if (!current()) return;
      let after = (this.timelines[id] || emptyTimeline(id)).cursor, barrier = until;
      if (barrier !== undefined && after >= barrier) return;
      for (;;) {
        let page;
        try { page = await this.gateway.events(id, after, barrier); }
        catch (error) {
          if (!current()) return;
          if (error.code === 'HISTORY_PURGED') {
            delete this.timelines[id]; delete this.drafts[id];
            await this.ensure('sessions', id, true); throw error;
          }
          if (error.code !== 'CURSOR_EXPIRED') throw error;
          const checkpoint = await this.gateway.checkpoint(id);
          if (!current()) return;
          const old = this.timelines[id] || emptyTimeline(id);
          // Body and cursor install atomically; live events beyond the checkpoint survive.
          const pending = [...Object.values(old.pending), ...buffer].filter(e => e.sequence > checkpoint.sequence);
          this.timelines[id] = mergeEvents(Object.assign(emptyTimeline(id), { cursor: checkpoint.sequence, items: checkpoint.items }), pending);
          after = checkpoint.sequence; barrier = undefined;
          continue;
        }
        if (!current()) return;
        if (page.after !== after || barrier !== undefined && page.highWater !== barrier || page.nextAfter < after || page.hasMore && page.nextAfter === after) throw new Error('历史分页没有遵守固定屏障');
        barrier = page.highWater;
        this.timelines[id] = mergeEvents(this.timelines[id] || emptyTimeline(id), page.events);
        if (this.timelines[id].cursor < page.nextAfter) throw new Error('历史正文不完整，不能推进游标');
        after = page.nextAfter;
        if (!page.hasMore) break;
      }
      if (id in this.gateway.watched) this.gateway.watched[id] = this.timelines[id].cursor;
      this.changed();
    })();
    this.loading[id] = work;
    try { await work; } finally {
      if (this.loading[id] === work) delete this.loading[id];
      if (this.recoveryEvents[id] === buffer) delete this.recoveryEvents[id];
    }
    // A live event can reveal a gap beyond the pinned HTTP barrier while it is loading.
    if (current() && this.timelines[id] && this.timelines[id].gap) return this.loadLiveTimeline(id);
  }
  watchSession(id) {
    if (!this.live || !this.auth) return;
    const cursor = this.timelines[id] ? this.timelines[id].cursor : 0;
    this.gateway.watch(id, cursor).catch(() => { /* 传输层错误由网关统一恢复 */ });
  }
  unwatchSession(id) {
    if (!this.live) return;
    if (typeof this.gateway.unwatch !== 'function') return;
    this.gateway.unwatch([id]).catch(() => {});
  }
  async recover() {
    if (!this.auth) return;
    const epoch = this.epoch;
    if (this.live) {
      // 登录/前台恢复：建立实时通道；ready 屏障后由 onBarrier 统一补历史。
      this.gateway.onBarrier = sessions => this.onBarrier(sessions);
      try { await this.gateway.connect(); }
      catch (error) { if (epoch === this.epoch) { this.connection = 'error'; this.changed(); } throw error; }
      return;
    }
    this.connection = 'recovering'; this.gateway.connection = 'online'; this.changed();
    // Subscription is already attached, so live events are buffered in the reducer
    // while the history fetch closes gaps. Never unsubscribe between the two.
    await Promise.all(this.snapshot().sessions.map(s => this.loadTimeline(s.id)));
    if (epoch !== this.epoch) return;
    this.purgeRevoked();
    Object.keys(this.operations).forEach(id => { const op = this.gateway.operation(id); if (op) this.operations[id] = op.state; });
    this.connection = Object.values(this.timelines).some(t => t.gap) ? 'recovering' : 'online'; this.changed();
  }
  async onBarrier(sessions) {
    // ready 屏障：资源增量已由网关 syncChanges 合并，这里补齐各会话历史与非终态操作。
    const epoch = this.epoch;
      if (epoch !== this.epoch) return;
      // The promise must reach Gateway.ready: only watched sessions, exact ready highWater,
      // no swallowed history error and no fetching all private bodies at login.
      await Promise.all(sessions.map(s => this.loadTimeline(s.sessionId, s.highWater)));
      if (epoch !== this.epoch) return;
      const open = Object.keys(this.operations).filter(id => !['confirmed', 'failed'].includes(this.operations[id]));
      await Promise.all(open.map(async id => {
        try { const op = await this.gateway.operation(id); if (epoch === this.epoch) this.operations[id] = op.state; }
        catch (_) { /* 保持当前状态，等待下一轮屏障 */ }
      }));
      if (epoch !== this.epoch) return;
      this.connection = this.gateway.connection; this.changed();
  }
  async foreground() {
    if (!this.auth) return;
    if (!this.live) return this.recover();
    const epoch = this.epoch;
    try {
      if (this.gateway.connection !== 'online') await this.gateway.connect();
      else await this.gateway.syncChanges();
    } catch (_) {
      if (epoch === this.epoch) { this.connection = this.gateway.connection === 'error' ? 'error' : 'recovering'; this.changed(); }
      return;
    }
    if (epoch !== this.epoch) return;
    await Promise.all(Object.keys(this.timelines).filter(id => this.timelines[id].gap).map(id => this.loadTimeline(id).catch(() => { })));
    this.connection = this.gateway.connection; this.changed();
  }
  background() { this.changed(); } // Never terminate a remote task on page/app hide.
  disconnect() {
    this.connection = 'offline';
    // FakeGateway 无 disconnect 方法，直接置位以拦截演示事件；LiveGateway 走传输层断开。
    if (typeof this.gateway.disconnect === 'function') this.gateway.disconnect();
    else this.gateway.connection = 'offline';
    this.changed();
  }
  draft(id, value) { if (value === undefined) return this.drafts[id] || ''; this.drafts[id] = value; }
  async command(method, args, id) {
    if (!this.auth) throw new Error('请先进入应用');
    if (this.connection !== 'online') throw new Error('连接未恢复，请稍后再试');
    const epoch = this.epoch;
    this.operations[id] = 'submitting'; this.changed();
    try {
      const receipt = await this.gateway[method](...args, id);
      if (epoch !== this.epoch || !this.auth) throw new Error('账号状态已改变，请在主机核实结果');
      this.operations[id] = this.live ? receipt.state : 'accepted'; this.changed();
      if (!this.live) {
        if (this.connection !== 'online') { this.operations[id] = 'unknown'; return { unknown: true, operationId: id }; }
        this.operations[id] = 'confirmed'; return receipt;
      }
      // live：accepted 只是受理，等待服务端回执到 confirmed 再取业务结果。
      const result = await this.gateway.awaitOperation(receipt);
      if (epoch !== this.epoch || !this.auth) throw new Error('账号状态已改变，请在主机核实结果');
      if (result && result.unknown) { this.operations[id] = 'unknown'; return result; }
      this.operations[id] = 'confirmed'; return result;
    } catch (error) {
      if (epoch === this.epoch && this.auth) {
        this.operations[id] = error.uncertain ? 'unknown' : 'failed';
        if (error.uncertain) return { unknown: true, operationId: id };
      }
      throw error;
    } finally { this.changed(); }
  }
  view() {
    const data = this.snapshot(), now = this.now(); const time = timestamp => {
      if (timestamp === null) return '尚未上线';
      const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
      return minutes < 1 ? '刚刚' : minutes < 60 ? `${minutes} 分钟前` : `${Math.floor(minutes / 60)} 小时前`;
    };
    // Keep deletion tombstones in the transport snapshot for synchronization,
    // but never present them as ordinary conversations in UI lists.
    data.sessions = data.sessions.filter(s => s.historyState !== 'purged');
    data.nodes = data.nodes.map(n => Object.assign(n, { lastSeenLabel: time(n.lastSeen), active: data.sessions.filter(s => s.nodeId === n.id && ACTIVE.includes(s.state)).length }));
    const agentStates = {
      ready: { stateLabel: '就绪', stateClass: 'online' },
      unavailable: { stateLabel: '不可用', stateClass: 'offline' },
      error: { stateLabel: '错误', stateClass: 'failed' }
    };
    data.agents = data.agents.map(agent => Object.assign({}, agent,
      { icon: agentIcon(agent) },
      agentStates[agent.state] || { stateLabel: '状态未提供', stateClass: '' }));
    data.sessions = data.sessions.map(s => {
      const node = data.nodes.find(n => n.id === s.nodeId); const agent = data.agents.find(a => a.id === s.agentId); const project = data.projects.find(p => p.id === s.projectId);
      return Object.assign(s, { node, agent, project, stateLabel: STATE_NAMES[s.state] || '状态未提供', timeLabel: time(s.updatedAt), active: ACTIVE.includes(s.state), pending: data.requests.filter(r => r.sessionId === s.id && (r.state === 'deciding' || r.state === 'pending' && r.expiresAt > now)).length });
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    data.requests = data.requests.map(r => Object.assign(r, { expired: r.state === 'expired' || r.state === 'pending' && r.expiresAt <= now, timeLabel: time(r.createdAt), session: data.sessions.find(s => s.id === r.sessionId), stateLabel: ({ resolved: '已处理', cancelled: '已取消', deciding: '正在回传', expired: '已过期' })[r.state] || (r.expiresAt <= now ? '已过期' : '待处理') }));
    const pending = data.requests.filter(r => r.state === 'deciding' || r.state === 'pending' && !r.expired);
    const counts = this.live && this.auth ? this.gateway.counts || {} : {};
    return Object.assign(data, { approvals: pending.filter(r => r.kind === 'approval').length, questions: pending.filter(r => r.kind === 'question').length, pendingCount: counts.pendingRequests === undefined ? pending.length : counts.pendingRequests, sessionCount: counts.sessions === undefined ? data.sessions.length : counts.sessions, onlineCount: counts.onlineNodes === undefined ? data.nodes.filter(n => n.online && !n.revoked).length : counts.onlineNodes, activeCount: data.sessions.filter(s => s.active).length, connection: this.connection, connectionLabel: ({ online: '连接正常', offline: '手机连接已断开', recovering: '正在同步历史与待办', error: errorText('NETWORK_ERROR') })[this.connection], preferences: this.preferences });
  }
  dispose() { this.unsubscribe(); this.gateway.dispose(); clearTimeout(this.renderTimer); this.listeners.clear(); }
}
module.exports = { Runtime };
