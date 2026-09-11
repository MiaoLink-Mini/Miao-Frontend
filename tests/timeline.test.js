const test = require('node:test');
const assert = require('node:assert/strict');
const { emptyTimeline, mergeEvents, fromHistory } = require('../miniprogram/stores/timeline');
function event(sequence, type = 'message.delta', data = { itemId: 'm', text: String(sequence) }, sessionId = 's') {
  return { id: `e${sequence}`, version: 'demo-view/1', sessionId, turnId: 't', sequence, type, data };
}
test('out-of-order events wait at the gap, duplicates are not appended twice', () => {
  let state = mergeEvents(emptyTimeline('s'), [event(3), event(1), event(3)]);
  assert.equal(state.cursor, 1); assert.equal(state.items[0].text, '1');
  assert.deepEqual(state.gap, { after: 1, before: 3 });
  state = mergeEvents(state, [event(2), event(1), event(2)]);
  assert.equal(state.cursor, 3); assert.equal(state.items[0].text, '123'); assert.equal(state.gap, null);
});
test('final text replaces preview and late deltas cannot mutate a completed message', () => {
  const state = fromHistory('s', [event(1), event(2, 'message.completed', { itemId: 'm', text: '最终正文' }), event(3)]);
  assert.equal(state.items.length, 1); assert.equal(state.items[0].text, '最终正文'); assert.equal(state.items[0].complete, true);
});
test('session, version and malformed sequence boundaries reject foreign input', () => {
  const state = fromHistory('s', [event(1, 'message.delta', { text: 'foreign' }, 'other'), { ...event(1), version: 'future/2' }, { ...event(1), sequence: NaN }]);
  assert.equal(state.cursor, 0); assert.equal(state.items.length, 0); assert.equal(state.warnings.length, 3);
});
test('unknown events produce a visible fallback without dropping a pending decision', () => {
  const state = fromHistory('s', [event(1, 'unknown.request', { requiresInput: true }), event(2)]);
  assert.equal(state.cursor, 2); assert.equal(state.items[0].type, 'unknown'); assert.match(state.items[0].text, /需要输入/);
});
test('card updates replace same-turn cards but preserve different turns', () => {
  const first = event(1, 'card.upsert', { itemId: 'plan', type: 'plan', text: '旧计划' });
  const update = event(2, 'card.upsert', { itemId: 'plan', type: 'plan', text: '新计划' });
  const nextTurn = { ...event(3, 'card.upsert', { itemId: 'plan', type: 'plan', text: '下一轮' }), turnId: 't2' };
  const state = fromHistory('s', [first, update, nextTurn]);
  assert.deepEqual(state.items.map(i => i.text), ['新计划', '下一轮']);
});
test('merging does not mutate the earlier snapshot', () => {
  const previous = fromHistory('s', [event(1)]); const next = mergeEvents(previous, [event(2)]);
  assert.equal(previous.items[0].text, '1'); assert.equal(previous.cursor, 1); assert.equal(next.cursor, 2);
});
