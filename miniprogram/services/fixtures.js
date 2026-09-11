// Every resource and value in this file is fictional demo data.
function fixtures(now = Date.now()) {
  const caps = { send: true, cancel: true, approval: true, question: true, diff: true, plan: true, usage: true, queue: true, steer: false };
  return {
    nodes: [
      { id: 'demo-mac', name: 'MacBook Pro', platform: 'macOS · 演示', version: 'demo-node/1', online: true, lastSeen: now, revoked: false },
      { id: 'demo-linux', name: '开发服务器', platform: 'Linux · 演示', version: 'demo-node/1', online: true, lastSeen: now, revoked: false },
      { id: 'demo-laptop', name: '旅行笔记本', platform: 'Windows · 演示', version: 'demo-node/1', online: false, lastSeen: now - 7200000, revoked: false }
    ],
    projects: [
      { id: 'demo-web', nodeId: 'demo-mac', name: '喵连 Frontend', description: '微信小程序远程工作台', branch: 'demo/frontend', valid: true },
      { id: 'demo-api', nodeId: 'demo-linux', name: 'Agent Gateway', description: '统一会话与事件网关', branch: 'demo/main', valid: true }
    ],
    agents: [
      { id: 'demo-codex', nodeId: 'demo-mac', name: 'Codex', letter: 'C', color: 'green', state: 'ready', version: '未接入真实版本', adapterVersion: 'Fake Gateway', capabilities: Object.assign({}, caps) },
      { id: 'demo-claude', nodeId: 'demo-mac', name: 'Claude Code', letter: 'A', color: 'orange', state: 'ready', version: '未接入真实版本', adapterVersion: 'Fake Gateway', capabilities: Object.assign({}, caps) },
      { id: 'demo-pi', nodeId: 'demo-linux', name: 'Pi', letter: 'P', color: 'purple', state: 'ready', version: '未接入真实版本', adapterVersion: 'Fake Gateway', capabilities: Object.assign({}, caps, { queue: false }) }
    ],
    sessions: [
      { id: 'demo-review', nodeId: 'demo-mac', projectId: 'demo-web', agentId: 'demo-codex', title: '优化会话列表与状态展示', state: 'waiting_approval', turnId: 'demo-turn-1', mode: 'managed', updatedAt: now - 120000, queue: [] },
      { id: 'demo-question', nodeId: 'demo-mac', projectId: 'demo-web', agentId: 'demo-claude', title: '梳理移动端断线恢复流程', state: 'waiting_input', turnId: 'demo-turn-2', mode: 'managed', updatedAt: now - 300000, queue: [] },
      { id: 'demo-complete', nodeId: 'demo-linux', projectId: 'demo-api', agentId: 'demo-pi', title: '检查网关事件去重逻辑', state: 'completed', turnId: 'demo-turn-3', mode: 'managed', updatedAt: now - 1800000, queue: [] }
    ],
    requests: [
      { id: 'demo-approval', sessionId: 'demo-review', turnId: 'demo-turn-1', kind: 'approval', title: '允许更新会话列表样式？', summary: '修改已登记项目中的页面样式，让等待审批与执行中的状态更容易辨认。', action: '更新 pages/sessions/index.wxss', scope: '本次文件修改', state: 'pending', expiresAt: now + 1800000, createdAt: now - 120000, choices: [{ id: 'demo-allow-once', label: '允许这一次' }, { id: 'demo-deny', label: '拒绝请求' }] },
      { id: 'demo-input', sessionId: 'demo-question', turnId: 'demo-turn-2', kind: 'question', title: '断线后希望保留哪些内容？', summary: '请确认本次交互方案。回答只用于当前问题。', state: 'pending', expiresAt: now + 1800000, createdAt: now - 300000, questions: [{ id: 'demo-q1', label: '选择恢复策略', required: true, type: 'single', options: [{ id: 'demo-history', label: '保留已加载历史与输入草稿' }, { id: 'demo-draft', label: '只保留输入草稿' }] }, { id: 'demo-q2', label: '补充说明', required: false, type: 'text' }] }
    ],
    notifications: [{ id: 'demo-notice', sessionId: 'demo-complete', kind: 'completed', title: '网关事件检查已完成', summary: '可以查看本轮结果和演示用量。', read: false, createdAt: now - 1800000 }],
    audit: []
  };
}
module.exports = { fixtures };
