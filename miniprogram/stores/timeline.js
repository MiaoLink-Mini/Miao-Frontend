// Internal view events: demo 生成 demo-view/1；真实网关事件经 services/wire.js 投影为 weagent-view/1。
const VIEW_VERSIONS = ['demo-view/1', 'weagent-view/1'];
function emptyTimeline(sessionId) {
  return { sessionId, cursor: 0, items: [], pending: {}, gap: null, warnings: [] };
}
function valid(event, sessionId) {
  return event && VIEW_VERSIONS.includes(event.version) && event.sessionId === sessionId &&
    Number.isSafeInteger(event.sequence) && event.sequence > 0 &&
    typeof event.type === 'string' && typeof event.id === 'string' &&
    (typeof event.turnId === 'string' || event.version === 'weagent-view/1' && event.turnId === null) && event.data && typeof event.data === 'object';
}
function apply(state, event) {
  const data = event.data;
  if (event.type === 'view.noop') return; // 状态/队列/能力/差异快照元数据：只推进游标，不产出卡片。
  const key = `${event.turnId}:${data.itemId || event.id}`;
  const index = state.items.findIndex(item => item.key === key);
  if (event.type === 'message.delta') {
    if (typeof data.text !== 'string') return;
    const old = state.items[index];
    if (old && old.complete) return;
    const role = data.role === 'user' ? 'user' : 'assistant';
    const item = { key, id: data.itemId, turnId: event.turnId, type: role, title: role === 'user' ? '你' : 'Agent', text: (old ? old.text : '') + data.text, complete: false };
    if (index >= 0) state.items[index] = item; else state.items.push(item);
  } else if (event.type === 'message.completed') {
    if (typeof data.text !== 'string') return;
    const role = data.role === 'user' ? 'user' : 'assistant';
    const item = { key, id: data.itemId, turnId: event.turnId, type: role, title: role === 'user' ? '你' : 'Agent', text: data.text, complete: true, truncated: !!data.truncated };
    if (index >= 0) state.items[index] = item; else state.items.push(item);
  } else if (event.type === 'card.upsert') {
    const known = ['user', 'assistant', 'tool', 'approval', 'question', 'plan', 'diff', 'result', 'status', 'error', 'usage'];
    const item = Object.assign({}, data, { key, turnId: event.turnId, type: known.includes(data.type) ? data.type : 'unknown' });
    if (index >= 0) state.items[index] = item; else state.items.push(item);
  } else {
    state.items.push({ key, type: 'unknown', title: '暂不支持的事件', text: '请在主机查看此事件。需要输入的请求仍须在主机处理。', turnId: event.turnId });
  }
}
function mergeEvents(previous, events) {
  const state = JSON.parse(JSON.stringify(previous));
  for (const event of events) {
    if (!valid(event, state.sessionId)) {
      state.warnings = [...state.warnings, 'INVALID_VIEW_EVENT'].slice(-20);
      continue;
    }
    if (event.sequence > state.cursor && !state.pending[event.sequence]) state.pending[event.sequence] = event;
  }
  while (state.pending[state.cursor + 1]) {
    const event = state.pending[state.cursor + 1];
    apply(state, event);
    delete state.pending[++state.cursor];
  }
  const next = Object.keys(state.pending).map(Number).sort((a, b) => a - b)[0];
  state.gap = next ? { after: state.cursor, before: next } : null;
  return state;
}
function fromHistory(sessionId, events) { return mergeEvents(emptyTimeline(sessionId), events); }
// Presentation only: keep persisted event ordering/cursors unchanged.
function usageAtTurnEnd(items) {
  const last=new Map(),usage=new Map();
  items.forEach((item,index)=>{if(item.turnId){last.set(item.turnId,index);if(item.type==='usage'){const list=usage.get(item.turnId)||[];list.push(item);usage.set(item.turnId,list);}}});
  const result=[];
  items.forEach((item,index)=>{
    if(item.type!=='usage'||!item.turnId)result.push(item);
    if(last.get(item.turnId)===index)result.push(...(usage.get(item.turnId)||[]));
  });
  return result;
}
module.exports = { emptyTimeline, mergeEvents, fromHistory, valid, usageAtTurnEnd };
