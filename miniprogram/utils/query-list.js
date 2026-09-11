const { errorText } = require('./error-display');
// Page-owned cursors are never reused after a search/filter change.
async function fetchList(more = false) {
  more = more === true; // A native bindtap passes an event object, not a pagination flag.
  const rt = getApp().runtime;
  if (!rt.live) return;
  if (more && this.data.listLoading) return;
  const generation = (this.queryGeneration || 0) + 1, epoch = rt.epoch;
  this.queryGeneration = generation;
  const source = this.listSource(), cursors = more ? this.queryCursors : source.queries.map(() => undefined);
  if (!more) this.setData({ remoteIds: [], moreResults: false });
  this.setData({ listLoading: true, listError: '' });
  try {
    const ids = more ? (this.data.remoteIds || []).slice() : [], next = [];
    for (let i = 0; i < source.queries.length; i++) {
      if (more && !cursors[i]) { next[i] = null; continue; }
      const page = await rt.gateway.list(source.kind, source.queries[i], cursors[i]);
      if (epoch !== rt.epoch || generation !== this.queryGeneration) return;
      ids.push(...page.items.map(item => item.id)); next[i] = page.nextPageToken;
    }
    this.queryCursors = next;
    this.setData({ remoteIds: Array.from(new Set(ids)), moreResults: next.some(Boolean) }); this.refresh();
  } catch (error) {
    if (epoch === rt.epoch && generation === this.queryGeneration) this.setData({ listError: errorText(error) });
  } finally { if (generation === this.queryGeneration) this.setData({ listLoading: false }); }
}
module.exports = { fetchList };
