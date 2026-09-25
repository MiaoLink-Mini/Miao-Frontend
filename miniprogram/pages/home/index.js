const {definePage,runtime} = require('../../utils/page');
const {switchList} = require('../../utils/navigation');
definePage({
  public: true,
  data: {},
  refresh() {
    const rt=runtime(),v=rt.view();
    const visibleNodes=v.nodes.filter(node=>!node.revoked);
    const recent=v.sessions.filter(session=>!session.archived).slice(0,3);
    const attention=v.requests.filter(request=>request.state==='deciding'||request.state==='pending'&&!request.expired).slice(0,2);
    this.setData(Object.assign({},v,{
      demo:!rt.live,guest:!rt.auth,visibleNodes,recent,attention,
      recentProjects:v.projects.filter(project=>visibleNodes.some(node=>node.id===project.nodeId)).slice(0,3),
      createTarget:visibleNodes.length?'/pages/create/index':'/pages/pair/index'
    }));
  },
  activeSessions(){switchList(runtime(),'sessions',{filter:'active',organization:'all',nodeId:'',projectId:'',agentId:''});},
  allSessions(){switchList(runtime(),'sessions',{filter:'all',organization:'all',nodeId:'',projectId:'',agentId:''});},
  pendingRequests(){switchList(runtime(),'inbox',{filter:'pending'});}
});
