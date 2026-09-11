const { capability } = require('./policy');

// Named UI entries, not arbitrary native slash execution. Remote actions use typed controls.
const COMMANDS = [
  { name:'model', label:'原生模型', description:'读取主机模型目录，设置下一轮模型', keywords:'模型 配置', panel:'config', capability:'models', remote:true },
  { name:'compact', label:'压缩上下文', description:'确认后调用主机原生压缩', keywords:'压缩 整理 上下文', panel:'compact', capability:'compact', remote:true },
  { name:'help', label:'会话菜单', description:'查看当前会话的功能入口', keywords:'帮助 菜单 命令', panel:'menu' },
  { name:'plan', label:'执行计划', description:'查看本轮步骤与完成情况', keywords:'计划 步骤', panel:'plan', capability:'plan' },
  { name:'diff', label:'文件改动', description:'只读查看变更与差异', keywords:'文件 改动 变更 差异', panel:'diff', capability:'diff' },
  { name:'usage', label:'本轮用量', description:'查看已提供的 token 统计', keywords:'用量 统计 上下文', panel:'usage', capability:'usage' },
  { name:'queue', label:'待执行消息', description:'查看完成本轮后排队的消息', keywords:'排队 队列 消息', panel:'queue', capability:'queue' },
  { name:'latest', label:'最新消息', description:'回到底部并恢复自动跟随', keywords:'最新 底部 跟随', action:'latest' }
];

function suggestions(draft, session) {
  const match = /^\/([^\s/]*)(?:[ \t]*)$/.exec(String(draft || ''));
  if (!match || !session || session.mode === 'readonly') return { query:null, items:[], command:null };
  const query=match[1].toLowerCase();
  const available=COMMANDS.filter(item=>!item.capability || capability(session.capabilities ? session : session.agent,item.capability));
  const items=available.filter(item=>item.name.startsWith(query) || item.keywords.includes(query));
  return { query, items, command:available.find(item=>item.name===query) || null };
}

module.exports={suggestions};
