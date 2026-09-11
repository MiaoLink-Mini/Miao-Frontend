const {definePage,runtime}=require('../../utils/page');
const nav=require('../../utils/navigation');
const tools=require('../../utils/context-tools');
definePage(Object.assign({
  resource:'projects',data:{id:'',toolPicker:false,toolSessions:[],toolMessage:''},
  onLoad(q){this.setData({id:q.id||''});},
  onHide(){this.closeToolPicker();},
  refresh(){
    const rt=runtime(),v=rt.view(),project=v.projects.find(p=>p.id===this.data.id),node=project?v.nodes.find(n=>n.id===project.nodeId):null;
    const sessions=project?nav.contextSessions(v,{projectId:project.id}):[];
    this.setData({demo:!rt.live,connection:v.connection,connectionLabel:v.connectionLabel,project:project||null,node:node||null,sessions:sessions.filter(s=>!s.archived),newUrl:project?nav.createUrl({nodeId:project.nodeId,projectId:project.id}):'',canStart:!!project&&!!node&&node.online&&!node.revoked&&project.valid,activeCount:sessions.filter(s=>s.active).length});
  },
  allSessions(){const p=this.data.project;if(p)nav.switchList(runtime(),'sessions',{projectId:p.id,nodeId:p.nodeId,agentId:'',filter:'all',organization:'all'});}
},tools.methods(function(){return this.data.project?{projectId:this.data.project.id,nodeId:this.data.project.nodeId}:null;},['files'])));
