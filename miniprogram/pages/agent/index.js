const {definePage,runtime}=require('../../utils/page');
const nav=require('../../utils/navigation');
const tools=require('../../utils/context-tools');
const labels={
  send:'发送指令',cancel:'取消当前轮次',approval:'权限审批',question:'问题回答',plan:'计划',diff:'文件改动',usage:'用量',queue:'完成后排队',steer:'追加本轮指令',models:'原生模型目录与选择',compact:'原生上下文压缩'
}
;

definePage(Object.assign({
 resource:'agents',data:{id:'',toolPicker:false,toolSessions:[],toolMessage:'',showUnavailable:false},
 onLoad(q){this.setData({id:q.id||''});},onHide(){this.closeToolPicker();},
 refresh(){const rt=runtime(),v=rt.view(),agent=v.agents.find(a=>a.id===this.data.id),node=agent?v.nodes.find(n=>n.id===agent.nodeId):null;
  const capabilities=agent?Object.keys(labels).map(key=>({key,label:labels[key],enabled:agent.capabilities[key]===true})):[];
  this.setData({demo:!rt.live,connection:v.connection,connectionLabel:v.connectionLabel,agent:agent||null,node:node||null,capabilities,enabledCapabilities:capabilities.filter(c=>c.enabled),unavailableCapabilities:capabilities.filter(c=>!c.enabled),sessions:agent?nav.contextSessions(v,{agentId:agent.id}).filter(s=>!s.archived):[],newUrl:agent?nav.createUrl({nodeId:agent.nodeId,agentId:agent.id}):'',canStart:!!node&&node.online&&!node.revoked&&!!agent&&agent.state==='ready'});
 },
 toggleCapabilities(){this.setData({showUnavailable:!this.data.showUnavailable});},
 allSessions(){const a=this.data.agent;if(a)nav.switchList(runtime(),'sessions',{agentId:a.id,nodeId:a.nodeId,projectId:'',filter:'all',organization:'all'});}
},tools.methods(function(){return this.data.agent?{agentId:this.data.agent.id,nodeId:this.data.agent.nodeId}:null;},['extensions','account'])));
