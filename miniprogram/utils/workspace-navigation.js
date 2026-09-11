const LABELS={overview:'全部工具',organization:'整理会话',project:'项目信息',files:'项目文件',attachments:'附件与引用',artifacts:'生成文件',account:'认证与额度',config:'原生配置',thinking:'思考档位',permissions:'权限与沙箱',sources:'指令来源',output_styles:'输出风格',agents:'子 Agent',skills:'Skills',commands:'命令与模板',extensions:'扩展',mcp:'MCP 服务',tasks:'子任务',checkpoints:'检查点',retry:'压缩与重试',queue:'消息队列',history:'历史与分支',diagnostics:'扩展诊断',goal:'会话目标',widgets:'扩展消息',review_targets:'代码审查'};
const GROUPS=[
 {title:'工作与输入',kinds:['project','files','attachments','artifacts','commands','queue','goal','tasks','review_targets']},
 {title:'模型与扩展',kinds:['thinking','config','permissions','sources','output_styles','agents','skills','extensions','mcp','widgets']},
 {title:'历史与管理',kinds:['history','checkpoints','retry','account','diagnostics']}
];
// Refresh must only repeat navigational reads, never writes, authorization,
// restores or a native run. Download continuation is handled by workspace-client.
const READS=new Set([...Object.keys(LABELS).filter(x=>x!=='organization'),'list_files','read_file','mcp_tools','task','history_messages']);
function repeatable(request){return !!request&&READS.has(request.kind)&&!(request.kind==='read_file'&&request.format==='base64');}
function groups(entries){
 const seen=new Set();const output=GROUPS.map(g=>({title:g.title,items:entries.filter(e=>e.request&&g.kinds.includes(e.request.kind)).map(e=>{seen.add(e.id);return Object.assign({},e,{title:LABELS[e.request.kind]});})})).filter(g=>g.items.length);
 const rest=entries.filter(e=>!seen.has(e.id));if(rest.length)output.push({title:'其他',items:rest.map(e=>Object.assign({},e,{title:e.label}))});return output;
}
module.exports={LABELS,groups,repeatable};
