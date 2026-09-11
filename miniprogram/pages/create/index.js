const {definePage,runtime} = require('../../utils/page');
definePage({
  data:{nodeId:'',projectId:'',agentId:'',prompt:'',busy:false,nodeIndex:0,projectIndex:0,agentIndex:0},
  onLoad(query){
    this.setData({nodeId:query.nodeId||'',projectId:query.projectId||'',agentId:query.agentId||'',prompt:runtime().draft('create')});
  },
  refresh(){
    const v=runtime().view(),nodes=v.nodes.filter(node=>!node.revoked);
    // Resolve a supplied entity through its actual registry relation only.
    const contextProject=v.projects.find(project=>project.id===this.data.projectId);
    const contextAgent=v.agents.find(agent=>agent.id===this.data.agentId);
    const nodeId=this.data.nodeId||(contextProject&&contextProject.nodeId)||(contextAgent&&contextAgent.nodeId)||'';
    const node=nodeId?nodes.find(item=>item.id===nodeId):nodes.find(item=>item.online);
    const projects=v.projects.filter(project=>node&&project.nodeId===node.id&&project.valid);
    const agents=v.agents.filter(agent=>node&&agent.nodeId===node.id);
    const project=this.data.projectId?projects.find(item=>item.id===this.data.projectId):projects[0];
    const agent=this.data.agentId?agents.find(item=>item.id===this.data.agentId):agents.find(item=>item.state==='ready');
    let readiness='';
    if(!node)readiness='请选择可访问的设备';
    else if(!node.online)readiness='设备离线';
    else if(!project)readiness='请选择有效项目';
    else if(!agent||agent.state!=='ready')readiness='请选择已就绪的 Agent';
    else if(v.connection!=='online')readiness='等待连接恢复';
    this.setData({demo:!runtime().live,nodes,projects,agents,selectedNode:node||null,selectedProject:project||null,selectedAgent:agent||null,
      nodeId:node?node.id:nodeId,projectId:project?project.id:this.data.projectId,agentId:agent?agent.id:this.data.agentId,
      nodeIndex:nodes.indexOf(node),projectIndex:projects.indexOf(project),agentIndex:agents.indexOf(agent),
      connection:v.connection,ready:!readiness,readiness});
  },
  selectNode(event){
    if(this.data.busy||this.data.unknown)return;
    const node=this.data.nodes[Number(event.detail.value)];if(!node)return;
    this.setData({nodeId:node.id,projectId:'',agentId:''});this.refresh();
  },
  selectProject(event){
    if(this.data.busy||this.data.unknown)return;
    const project=this.data.projects[Number(event.detail.value)];if(!project)return;
    this.setData({projectId:project.id});this.refresh();
  },
  selectAgent(event){
    if(this.data.busy||this.data.unknown)return;
    const agent=event.currentTarget&&event.currentTarget.dataset.id
      ?this.data.agents.find(item=>item.id===event.currentTarget.dataset.id)
      :this.data.agents[Number(event.detail.value)];
    if(!agent||agent.state!=='ready')return;
    this.setData({agentId:agent.id});this.refresh();
  },
  input(event){this.setData({prompt:event.detail.value});runtime().draft('create',event.detail.value);},
  browseHistory(){
    this.refresh();
    if(!this.data.ready||this.data.busy||this.data.unknown||this.data.demo||!this.data.selectedAgent.capabilities.historyImport)return;
    wx.redirectTo({url:'/pages/workspace/index?kind=history&nodeId='+encodeURIComponent(this.data.nodeId)+'&projectId='+encodeURIComponent(this.data.projectId)+'&agentId='+encodeURIComponent(this.data.agentId)});
  },
  submit(){
    this.refresh();
    if(!this.data.ready||this.data.busy||this.data.unknown)return;
    const prompt=this.data.prompt;
    return this.action('create',[{nodeId:this.data.nodeId,projectId:this.data.projectId,agentId:this.data.agentId,...(prompt.trim()?{prompt}:{historyOnly:true})}],session=>{
      if(runtime().draft('create')===prompt)runtime().draft('create','');
      wx.redirectTo({url:'/pages/session/index?id='+encodeURIComponent(session.id)});
    });
  }
});
