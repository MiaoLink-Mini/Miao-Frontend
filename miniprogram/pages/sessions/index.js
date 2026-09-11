const {definePage,runtime} = require('../../utils/page');
const {consumeList} = require('../../utils/navigation');
const {errorText} = require('../../utils/error-display');
const SCOPES = {
  nodeIndex:{id:'nodeId',options:'nodeOptions'},
  projectIndex:{id:'projectId',options:'projectOptions'},
  agentIndex:{id:'agentId',options:'agentOptions'}
};
function options(items,id,label,missingLabel,staged){
  const result=[{id:'',name:label},...items];
  if(id&&!items.some(item=>item.id===id))result.push({id,name:missingLabel});
  if(staged&&staged!==id&&!items.some(item=>item.id===staged))result.push({id:staged,name:missingLabel});
  return result;
}
definePage({
  revealSession(e){this.setData({swipedId:e.detail.id});},
  async renameSession(e){
    if(this.renaming||this.deleting||this.data.busy||this.data.unknown)return;
    const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife,id=e.detail.id;
    const current=()=>runtime()===rt&&rt.auth&&epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&this.data.pageActive!==false;
    let s=rt.view().sessions.find(x=>x.id===id);if(!s||!rt.live)return;
    this.renaming=true;
    try{
      const result=await new Promise(resolve=>wx.showModal({title:'重命名会话',editable:true,content:s.title,placeholderText:'输入会话名称',confirmText:'保存',success:resolve,fail:()=>resolve({confirm:false})}));
      if(!result.confirm||!current())return;
      s=rt.view().sessions.find(x=>x.id===id);if(!s)return;
      const title=String(result.content||'').trim();
      const value={revision:s.revision,title,pinned:!!s.pinned,archived:!!s.archived,tags:s.tags||[]};
      require('../../services/wire').validate('SessionMetadata',value);
      if(title===s.title){this.setData({swipedId:''});return;}
      await this.action('organizeSession',[id,value],()=>{this.setData({swipedId:''});this.refresh();});
    }catch(error){if(current())this.setData({error:errorText(error)});}
    finally{this.renaming=false;}
  },
  async deleteSession(e){
    if(this.deleting||this.renaming||this.data.busy||this.data.unknown)return;
    const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife,id=e.detail.id;
    const current=()=>runtime()===rt&&rt.auth&&epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&this.data.pageActive!==false;
    let s=rt.view().sessions.find(x=>x.id===id);if(!s||!rt.live)return;
    if(s.active||['idle','running','waiting_approval','waiting_input','cancelling'].includes(s.state)){this.setData({error:errorText('SESSION_NOT_CLOSED')});return;}
    this.deleting=true;
    try{
      const confirmed=await new Promise(resolve=>wx.showModal({title:'删除会话？',content:'仅删除此 喵连 会话记录，不删除子会话、电脑文件或原生历史。尚未关闭的空闲会话将先关闭。',confirmText:'删除',success:r=>resolve(r.confirm),fail:()=>resolve(false)}));
      if(!confirmed||!current())return;
      s=rt.view().sessions.find(x=>x.id===id);if(!s)return;
      if(s.state!=='closed'){
        if(s.active){this.setData({error:errorText('SESSION_NOT_CLOSED')});return;}
        let closed=false;
        await this.action('native',[id,s.turnId,{action:'workspace',request:{kind:'close'}}],()=>{closed=true;});
        if(!closed||!current())return;
        await rt.ensure('sessions',id,true);if(!current())return;
        s=rt.view().sessions.find(x=>x.id===id);
      }
      if(!s||s.state!=='closed'){this.setData({error:errorText('SESSION_NOT_CLOSED')});return;}
      await this.action('deleteHistory',[id,{revision:s.revision,scope:'platform',includeDescendants:false}],()=>{this.setData({swipedId:''});});
    }catch(error){if(current())this.setData({error:errorText(error)});}
    finally{this.deleting=false;}
  },
  fetchList:require('../../utils/query-list').fetchList,
  data:{query:'',filter:'all',organization:'all',nodeId:'',projectId:'',agentId:'',nodeIndex:0,agentIndex:0,projectIndex:0,filterSheet:false,filterDraft:{}},
  onShow(){
    const intent=consumeList(runtime(),'sessions');
    if(intent)this.setData(Object.assign({query:''},intent));
    this.refresh();return this.fetchList();
  },
  onHide(){clearTimeout(this.searchTimer);this.queryGeneration=(this.queryGeneration||0)+1;this.setData({filterSheet:false,listLoading:false,swipedId:''});},
  onUnload(){clearTimeout(this.searchTimer);this.queryGeneration=(this.queryGeneration||0)+1;},
  loadMore(){return this.fetchList(true);},
  listSource(){
    const filters={q:this.data.query.trim()};
    if(this.data.organization==='pinned')filters.pinned=true;
    if(this.data.organization==='archived')filters.archived=true;
    for(const key of ['nodeId','projectId','agentId'])if(this.data[key])filters[key]=this.data[key];
    const states=this.data.filter==='active'?['running','waiting_approval','waiting_input','cancelling']:
      this.data.filter==='attention'?['waiting_approval','waiting_input']:this.data.filter==='all'?['']:[this.data.filter];
    return {kind:'sessions',queries:states.map(state=>Object.assign({},filters,state?{state}:{}))};
  },
  refresh(){
    const rt=runtime(),v=rt.view(),d=this.data;
    const nodeOptions=options(v.nodes.filter(node=>!node.revoked),d.nodeId,'全部设备','所选设备不可访问',d.filterSheet&&d.filterDraft.nodeId);
    const projectOptions=options(v.projects,d.projectId,'全部项目','所选项目不可访问',d.filterSheet&&d.filterDraft.projectId);
    const agentOptions=options(v.agents,d.agentId,'全部 Agent','所选 Agent 不可访问',d.filterSheet&&d.filterDraft.agentId);
    const q=d.query.trim().toLowerCase();
    const list=v.sessions.filter(session=>
      (d.organization==='pinned'?session.pinned:d.organization==='archived'?session.archived:true)&&
      (!rt.live||!d.remoteIds||d.remoteIds.includes(session.id))&&
      (!q||(rt.live?[session.title]:[session.title,(session.project||{}).name,(session.node||{}).name,(session.agent||{}).name]).join(' ').toLowerCase().includes(q))&&
      (d.filter==='all'||(d.filter==='active'?session.active:d.filter==='attention'?session.pending>0:session.state===d.filter))&&
      (!d.nodeId||session.nodeId===d.nodeId)&&(!d.projectId||session.projectId===d.projectId)&&(!d.agentId||session.agentId===d.agentId));
    const scopeCount=[d.nodeId,d.projectId,d.agentId].filter(Boolean).length;
    this.setData(Object.assign({},v,{demo:!rt.live,list:list.sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)),nodeOptions,projectOptions,agentOptions,
      nodeIndex:nodeOptions.findIndex(item=>item.id===d.nodeId),projectIndex:projectOptions.findIndex(item=>item.id===d.projectId),agentIndex:agentOptions.findIndex(item=>item.id===d.agentId),
      scopeCount,hasFilters:!!q||d.filter!=='all'||d.organization!=='all'||scopeCount>0}));
    if(d.filterSheet)this.setData({draftNodeIndex:Math.max(0,nodeOptions.findIndex(x=>x.id===d.filterDraft.nodeId)),draftProjectIndex:Math.max(0,projectOptions.findIndex(x=>x.id===d.filterDraft.projectId)),draftAgentIndex:Math.max(0,agentOptions.findIndex(x=>x.id===d.filterDraft.agentId))});
  },
  organize(event){const value=event.currentTarget.dataset.value;if(!['all','pinned','archived'].includes(value))return;this.setData({organization:value});this.refresh();return this.fetchList();},
  search(event){this.setData({query:event.detail.value});this.refresh();clearTimeout(this.searchTimer);this.queryGeneration=(this.queryGeneration||0)+1;this.searchTimer=setTimeout(()=>this.fetchList(),400);},
  clearSearch(){clearTimeout(this.searchTimer);this.setData({query:''});this.refresh();return this.fetchList();},
  filter(event){const value=event.currentTarget.dataset.value;if(!['all','active','attention','completed','failed','cancelled','closed'].includes(value))return;this.setData({filter:value});this.refresh();return this.fetchList();},
  select(event){const scope=SCOPES[event.currentTarget.dataset.key];if(!scope)return;const item=this.data[scope.options][Number(event.detail.value)];if(!item)return;this.setData({[scope.id]:item.id});this.refresh();return this.fetchList();},
  openFilters(){this.setData({filterSheet:true,filterDraft:{nodeId:this.data.nodeId,projectId:this.data.projectId,agentId:this.data.agentId},draftNodeIndex:this.data.nodeIndex,draftProjectIndex:this.data.projectIndex,draftAgentIndex:this.data.agentIndex});},
  closeFilters(){this.setData({filterSheet:false});},
  selectDraft(event){
    const scope=SCOPES[event.currentTarget.dataset.key];if(!scope)return;
    const index=Number(event.detail.value),item=this.data[scope.options][index];if(!item)return;
    const indexKey={nodeId:'draftNodeIndex',projectId:'draftProjectIndex',agentId:'draftAgentIndex'}[scope.id];
    this.setData({filterDraft:Object.assign({},this.data.filterDraft,{[scope.id]:item.id}),[indexKey]:index});
  },
  resetDraft(){this.setData({filterDraft:{nodeId:'',projectId:'',agentId:''},draftNodeIndex:0,draftProjectIndex:0,draftAgentIndex:0});},
  applyFilters(){this.setData(Object.assign({filterSheet:false},this.data.filterDraft));this.refresh();return this.fetchList();},
  resetFilters(){clearTimeout(this.searchTimer);this.setData({query:'',filter:'all',organization:'all',nodeId:'',projectId:'',agentId:''});this.refresh();return this.fetchList();}
});
