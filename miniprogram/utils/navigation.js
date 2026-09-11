const { capability } = require('./policy');

// These UI routes are deliberately explicit. Native requests are never derived
// from a label, a casing convention, or a user-supplied arbitrary route.
const PANELS = new Set(['menu', 'plan', 'diff', 'usage', 'config', 'compact']);
const WORKSPACES = {
  input: 'attachments', files: 'files', tasks: 'tasks', extensions: 'extensions',
  checkpoints: 'checkpoints', account: 'account', queue: 'queue', history: 'history',
  organization: 'organization', overview: 'overview', project: 'project',
  skills: 'skills', commands: 'commands', retry: 'retry', goal: 'goal'
};
const LEGACY = new Set(['input', 'files', 'tasks', 'extensions', 'checkpoints', 'account', 'queue', 'history']);
function sessionUrl(kind, id, live) {
  if (typeof id !== 'string' || !id) return null;
  const sid = encodeURIComponent(id);
  if (kind === 'share') return live ? '/pages/share/index?id=' + sid : null;
  if (PANELS.has(kind)) return '/pages/panel/index?kind=' + kind + '&sessionId=' + sid;
  if (live && Object.prototype.hasOwnProperty.call(WORKSPACES, kind)) return '/pages/workspace/index?id=' + sid + '&kind=' + WORKSPACES[kind];
  if (!live && LEGACY.has(kind)) return '/pages/panel/index?kind=' + kind + '&sessionId=' + sid;
  return null;
}
const GROUPS = [
  { title: '本轮工作', items: [
    ['plan', '执行计划', '步骤与进度', 'plan', 'plan'],
    ['diff', '代码变更', '逐文件查看 Diff', 'diff', 'diff'],
    ['queue', '消息队列', '本轮完成后执行', 'queue', 'queue'],
    ['usage', '本轮用量', 'Token 与费用', 'usage', 'clock']
  ]},
  { title: '会话工具', items: [
    ['config', '模型', '选择下一轮模型', 'models', 'sliders'],
    ['input', '附件与引用', '图片、文件与命令', null, 'attachment'],
    ['files', '项目文件', '只读查看与下载', null, 'folder'],
    ['tasks', '子任务', '后台任务与输出', null, 'task'],
    ['compact', '压缩上下文', '确认后执行', 'compact', 'download'],
    ['extensions', '扩展', 'Skills · MCP · 插件', null, 'extension']
  ]},
  { title: '管理', items: [
    ['organization', '整理会话', '命名、置顶与归档', null, 'archive'],
    ['history', '历史与分支', '恢复、分支与克隆', null, 'history'],
    ['share', '分享会话', '阅读或限时协作', null, 'share'],
    ['overview', '全部工具', '账号、检查点与设置', null, 'more']
  ]}
];
function sessionGroups(session, live) {
  if (!session) return [];
  const subject = session.capabilities ? session : session.agent;
  const caps=subject?.capabilities||{},sections=session.agent?.capabilities?.workspaceSections||caps.workspaceSections||[];
  const online=session.node?.online!==false,closed=session.state==='closed',readonly=session.mode==='readonly',idle=['completed','cancelled','failed'].includes(session.state);
  const available=kind=>{
    if(['plan','diff','usage','organization','share'].includes(kind))return session.historyState!=='purged';
    if(readonly||!online)return false;
    if(['config','compact'].includes(kind))return !closed&&idle;
    if(!caps.workspace)return false;
    if(kind==='history')return !!(caps.historyImport||session.agent?.capabilities?.historyImport)&&sections.includes('history');
    if(kind==='files')return true;
    if(kind==='overview')return !closed;
    if(closed)return false;
    if(['tasks','extensions'].includes(kind))return sections.includes(kind);
    if(kind==='input')return !!caps.send;
    return true;
  };
  return GROUPS.map(group => ({ title: group.title, items: group.items
    .filter(([kind, , , cap]) => available(kind) && (!cap || capability(subject, cap)) &&
      (live || !['files','tasks','extensions','history'].includes(kind)) &&
      (session.mode !== 'readonly' || !['config','compact','queue','input'].includes(kind)))
    .map(([kind,label,note, ,icon]) => ({ kind,label,note,icon,url:sessionUrl(kind,session.id,live) }))
    .filter(item => item.url)
  })).filter(group => group.items.length);
}
function createUrl({ nodeId, projectId, agentId } = {}) {
  const args = [];
  for (const [key,value] of [['nodeId',nodeId],['projectId',projectId],['agentId',agentId]]) {
    if (typeof value === 'string' && value) args.push(key + '=' + encodeURIComponent(value));
  }
  return '/pages/create/index' + (args.length ? '?' + args.join('&') : '');
}
function returnToSession(id, api = wx, pages = typeof getCurrentPages === 'function' ? getCurrentPages() : []) {
  if (typeof id !== 'string' || !id) return api.switchTab({url:'/pages/sessions/index'});
  for (let index = pages.length - 2; index >= 0; index--) {
    const page = pages[index];
    if (page.route === 'pages/session/index' && page.data && page.data.id === id) {
      return api.navigateBack({delta:pages.length - 1 - index});
    }
  }
  return api.redirectTo({url:'/pages/session/index?id=' + encodeURIComponent(id)});
}
// switchTab does not accept query strings. One-shot, account-scoped UI intent
// stays in memory and is consumed by the target tab, never in persistent storage.
const intents = new WeakMap();
function switchList(rt, target, filters, api = wx) {
  if (!['sessions','inbox'].includes(target)) return;
  const allowed = target === 'sessions' ? ['filter','organization','nodeId','projectId','agentId'] : ['filter'];
  const value = {};
  for (const key of allowed) if (typeof filters[key] === 'string') value[key] = filters[key];
  intents.set(rt, {target,epoch:rt.epoch,value});
  api.switchTab({url:'/pages/' + target + '/index'});
}
function consumeList(rt, target) {
  const item = intents.get(rt);
  if (!item) return null;
  if (item.epoch !== rt.epoch || !rt.auth) {intents.delete(rt); return null;}
  if (item.target !== target) return null;
  intents.delete(rt);
  return item.value;
}
function contextSessions(view, scope) {
  return view.sessions.filter(session => session.historyState !== 'purged' &&
    (!scope.nodeId || session.nodeId === scope.nodeId) &&
    (!scope.projectId || session.projectId === scope.projectId) &&
    (!scope.agentId || session.agentId === scope.agentId));
}
module.exports = {sessionUrl,sessionGroups,createUrl,returnToSession,switchList,consumeList,contextSessions};
