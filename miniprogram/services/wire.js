const schema = require('./protocol.generated');
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function matches(s, value) {
  if (typeof s === 'boolean') return s;
  if (s.$ref && !matches(schema.$defs[s.$ref.slice('#/$defs/'.length)], value)) return false;
  if (s.const !== undefined && value !== s.const) return false;
  if (s.enum && !s.enum.includes(value)) return false;
  if (s.not && matches(s.not, value)) return false;
  if (s.anyOf && !s.anyOf.some(x => matches(x, value))) return false;
  if (s.oneOf && s.oneOf.filter(x => matches(x, value)).length !== 1) return false;
  if (s.allOf && !s.allOf.every(x => matches(x, value))) return false;
  if (s.if && !matches(matches(s.if, value) ? (s.then || {}) : (s.else || {}), value)) return false;
  const object = value !== null && typeof value === 'object' && !Array.isArray(value);
  if (s.type && !({ null: value === null, object, array: Array.isArray(value), string: typeof value === 'string', boolean: typeof value === 'boolean', integer: Number.isSafeInteger(value), number: typeof value === 'number' && Number.isFinite(value) })[s.type]) return false;
  if (typeof value === 'string') {
    const length = Array.from(value).length;
    if (s.minLength !== undefined && length < s.minLength || s.maxLength !== undefined && length > s.maxLength) return false;
    if (s.pattern && !(new RegExp(s.pattern, 'u')).test(value)) return false;
    if (s.format === 'date-time') {
      const m = /^(\d{4})-(\d\d)-(\d\d)[tT](\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:[zZ]|[+-](\d\d):(\d\d))$/.exec(value);
      if (!m || !Number.isFinite(Date.parse(value)) || +m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate() || +m[4] > 23 || +m[5] > 59 || +m[6] > 59 || +(m[7] || 0) > 23 || +(m[8] || 0) > 59) return false;
    }
  }
  if (typeof value === 'number' && (s.minimum !== undefined && value < s.minimum || s.maximum !== undefined && value > s.maximum)) return false;
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems || s.maxItems !== undefined && value.length > s.maxItems) return false;
    if (s.items && !value.every(x => matches(s.items, x))) return false;
    if (s.uniqueItems && new Set(value.map(x => JSON.stringify(x))).size !== value.length) return false;
  }
  if (object) {
    const keys = Object.keys(value), properties = s.properties || {};
    if (s.required && !s.required.every(key => own(value, key))) return false;
    if (s.maxProperties !== undefined && keys.length > s.maxProperties) return false;
    for (const key of keys) {
      if (s.propertyNames && !matches(s.propertyNames, key)) return false;
      if (own(properties, key)) { if (!matches(properties[key], value[key])) return false; }
      else if (s.additionalProperties === false || typeof s.additionalProperties === 'object' && !matches(s.additionalProperties, value[key])) return false;
    }
  }
  return true;
}
function validate(name, value) {
  if (!schema.$defs[name] || !matches(schema.$defs[name], value)) {
    const error = new Error('Gateway 协议校验失败：' + name); error.code = 'INVALID_PROTOCOL'; throw error;
  }
  return value;
}
function normalize(value) {
  const result = Object.assign({}, value);
  ['createdAt', 'updatedAt', 'expiresAt', 'deadlineAt', 'lastSeen'].forEach(key => {
    if (typeof result[key] === 'string') result[key] = Date.parse(result[key]);
  });
  if (result.decision) result.answer = result.decision.kind === 'approval' ? result.decision.choiceId : result.decision.answers;
  return result;
}
function itemView(item, request) {
  const out = Object.assign({}, item, { id: item.itemId, key: item.turnId + ':' + item.itemId });
  if (item.type === 'message') { out.type = item.role; out.title = item.role === 'user' ? '你' : 'Agent'; }
  if (item.type === 'tool') { out.text = item.summary; out.detail = item.output || ''; }
  if (item.type === 'plan') out.steps = item.steps.map(s => Object.assign({}, s, { label: s.text }));
  if (item.type === 'diff') {
    out.text = item.summary; out.source = '主机上报的只读差异';
    out.files = item.files.map(f => Object.assign({}, f, { id: f.fileId, name: f.path, lines: [] }));
  }
  if (item.type === 'usage') {
    out.title = '本轮用量'; out.input = item.inputTokens == null ? '未提供' : item.inputTokens;
    out.output = item.outputTokens == null ? '未提供' : item.outputTokens;
    out.costLabel = item.cost ? item.cost.amount + ' ' + item.cost.currency : '未提供'; out.source = 'Agent 原生上报';
    out.costUnavailable = !item.cost;
    const used=item.contextUsedTokens,limit=item.contextWindowTokens;
    out.contextLabel = Number.isSafeInteger(used)&&used>=0
      ? (Number.isSafeInteger(limit)&&limit>0 ? (used/limit*100).toFixed(1)+'% · '+used+' / '+limit+' tokens' : used+' tokens · 上限未上报')
      : '尚未上报';
    out.text = '输入 ' + out.input + ' / 输出 ' + out.output + ' tokens';
    if (item.cost) out.text += '\n预估费用 ' + out.costLabel;
  }
  if (item.type === 'request') {
    Object.assign(out, request ? { type: request.kind, title: request.title, text: request.summary, state: request.state } : { type: 'status', title: '交互请求', text: '请求未加载或已失效，请在待处理中核实。' });
  }
  return out;
}
function projectEvent(event, request) {
  validate('SessionEvent', event);
  const out = Object.assign({}, event, { version: 'weagent-view/1' });
  if (event.type === 'item.upsert') { out.type = 'card.upsert'; out.turnId = event.data.turnId; out.data = itemView(event.data, request); }
  else if (event.type === 'request.upsert') {
    out.type = 'card.upsert'; out.turnId = event.data.turnId;
    out.data = itemView({ type: 'request', itemId: event.data.id, turnId: event.data.turnId, requestId: event.data.id }, event.data);
  } else if (!event.type.startsWith('message.')) { out.type = 'view.noop'; out.data = {}; }
  return out;
}
function patchLines(patch) {
  return patch.split('\n').map((text, index) => ({ number: index + 1, text, kind: text.startsWith('+') && !text.startsWith('+++') ? 'added' : text.startsWith('-') && !text.startsWith('---') ? 'removed' : 'context' }));
}
module.exports = { validate, matches, normalize, itemView, projectEvent, patchLines };
