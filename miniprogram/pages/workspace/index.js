const { errorText } = require('../../utils/error-display');
const {definePage,runtime,toast}=require('../../utils/page');
const client=require('../../services/workspace-client');
const nav=require('../../utils/navigation');
const workspaceNav=require('../../utils/workspace-navigation');
const {validate}=require('../../services/wire');
const sections=new Set(['overview','project','files','attachments','artifacts','account','config','thinking','permissions','sources','output_styles','agents','skills','commands','extensions','mcp','tasks','checkpoints','retry','queue','history','diagnostics','goal','widgets','review_targets']);
const clone=x=>JSON.parse(JSON.stringify(x));
// Native pickers can temporarily hide a page; keep their original session scope
// but never attach selected data to another account, purged body or unloaded page.
const context=(page,visible=true)=>{
  const rt=runtime(),sid=page.data.id,epoch=rt.epoch,content=rt.contentEpoch,body=(rt.bodyEpoch||{})[sid]||0,life=page.pageLife;
  return {rt,sid,current:()=>runtime()===rt&&rt.auth&&!page.workspaceDisposed&&sid===page.data.id&&epoch===rt.epoch&&content===rt.contentEpoch&&body===((rt.bodyEpoch||{})[sid]||0)&&(!visible||life===page.pageLife&&page.data.pageActive!==false)};
};
const confirm=(title,content)=>client.invoke(wx,'showModal',{title,content,confirmText:'\u786e\u8ba4',cancelText:'\u53d6\u6d88'}).then(r=>r.confirm);
definePage({
  resource:'sessions',
  data:{id:'',kind:'overview',pageTitle:workspaceNav.LABELS.overview,globalForms:[],catalogGroups:[],view:null,forms:[],entries:[],jobs:[],busy:false,unknown:false,error:'',selection:[],metadataTitle:'',metadataTags:'',metadataPinned:false,metadataArchived:false,metadataDirty:false,deleteChildren:false,downloaded:null},
  onLoad(q){if(q.nodeId&&q.projectId&&q.agentId)this.setData({projectHistory:{nodeId:q.nodeId,projectId:q.projectId,agentId:q.agentId}});const kind=q.kind==='organization'||sections.has(q.kind)?q.kind:'overview';this.setData({id:q.id||'',restoreSource:q.source||'',kind,pageTitle:workspaceNav.LABELS[kind]});},
  async onShow(){if(!runtime().live){this.setData({error:errorText('LIVE_REQUIRED')});return;}this.contentEpoch=runtime().contentEpoch;this.bodyEpoch=runtime().bodyEpoch[this.data.id]||0;await this.load();},
  onHide(){clearInterval(this.fileWatch);this.fileWatch=null;},
  onUnload(){this.workspaceDisposed=true;clearInterval(this.fileWatch);this.fileWatch=null;},
  refresh(){
    const rt=runtime(),session=rt.view().sessions.find(s=>s.id===this.data.id);
    if(this.data.projectHistory){const scope=this.data.projectHistory;try{client.projectFence(rt,scope)();this.setData({session:Object.assign({title:'',agent:rt.gateway.lookup('agents',scope.agentId)},scope),jobs:[],selection:[]});}catch(e){this.setData({view:null,entries:[],forms:[],globalForms:[],error:errorText(e)});}return;}
    const stale=this.contentEpoch!==undefined&&(this.contentEpoch!==rt.contentEpoch||this.bodyEpoch!==(rt.bodyEpoch[this.data.id]||0));
    if(!session||session.historyState==='purged'||stale){clearInterval(this.fileWatch);this.fileWatch=null;this.pending=null;this._controls={};this.setData({view:null,entries:[],forms:[],globalForms:[],catalogGroups:[],downloaded:null,session:session||null,selection:[],jobs:[],unknown:false});return;}
    this.setData({session,children:rt.view().sessions.filter(s=>s.parentSessionId===session.id),selection:client.inputItems(rt,this.data.id),jobs:(rt.uploadJobs[this.data.id]||[]).map(j=>({id:j.id,name:j.name,size:j.size,offset:j.offset,state:j.state,error:j.error?errorText(j.error):'',previewPath:j.previewPath||'',resourceId:j.resourceId||''}))});
    if(!this.data.metadataDirty)this.setData({metadataTitle:session.title,metadataTags:(session.tags||[]).join(','),metadataPinned:!!session.pinned,metadataArchived:!!session.archived});
  },
  showView(result){
    clearInterval(this.fileWatch);this.fileWatch=null;
    const view=clone(result.view);const controls={};const forms=[];
    if(this.data.restoreSource && result.requestKind==='history'){
      view.entries=view.entries.filter(e=>e.origin&&e.origin.sourceSessionId===this.data.restoreSource);
      view.title='恢复会话';
      view.notice=view.entries.length?'已定位原生会话。点击恢复即可继续，不会发送任务或重新发送旧消息。':'未找到可恢复的原生历史。请确认使用原设备、原项目，且原生历史未被清理。';
    }
    const add=c=>{
      const value=clone(c);value.fields=(value.fields||[]).map(f=>Object.assign({},f,{value:value.request[f.key]===undefined?(f.type==='boolean'?false:f.type==='select'&&(f.options||[]).length?f.options[0].value:''):value.request[f.key],selected:Math.max(0,(f.options||[]).findIndex(o=>o.value===value.request[f.key]))}));
      value.fields.forEach(f=>{value.request[f.key]=f.value;});controls[value.id]=value;forms.push(value);return value.id;
    };
    const entries=view.entries.map(e=>Object.assign({},e,{controlIds:(e.controls||[]).map(add)}));
    const globalControlIds=view.controls.map(add);this._controls=controls;this._globalControlIds=globalControlIds;
    this.setData({entries,forms});this.projectForms();
    if(this.data.pageActive!==false&&result.requestKind==='read_file'&&view.transfer&&!view.transfer.content){
      const token={resourceId:view.transfer.id,version:view.transfer.version},rt=runtime(),sid=this.data.id,check=client.fence(rt,sid);
      this.fileWatch=setInterval(async()=>{
        if(this.data.busy||this.watching||this.data.unknown)return;this.watching=true;
        try{check();const status=await client.step(rt,sid,{kind:'file_status',...token},{},'status');check();
          if(status.view.entries[0]?.state!=='unchanged'){clearInterval(this.fileWatch);this.fileWatch=null;this.setData({fileNotice:errorText('RESOURCE_CHANGED')});}
        }catch(error){clearInterval(this.fileWatch);this.fileWatch=null;this.setData({fileNotice:errorText(error)});}finally{this.watching=false;}
      },15000);
    }
    this.setData({view,catalogGroups:workspaceNav.groups(entries),hasOrigins:entries.some(e=>e.origin||e.preset),fileNotice:'',unknown:false,error:'',receipt:'\u4e3b\u673a\u56de\u6267\u5df2\u786e\u8ba4',downloaded:null});
  },
  async run(request,resume=false){
    if(this.data.busy||this.data.unknown&&!resume)return;
    const rt=runtime(),sid=this.data.id;
    this.setData({busy:true,error:'',receipt:'\u7b49\u5f85\u7f51\u5173\u548c\u4e3b\u673a\u56de\u6267'});
    try{
      const check=this.data.projectHistory?client.projectFence(rt,this.data.projectHistory):client.fence(rt,sid);check();
      if(!resume){if(sections.has(request.kind))this.setData({kind:request.kind,pageTitle:workspaceNav.LABELS[request.kind]});if(workspaceNav.repeatable(request))this.readRequest=clone(request);this.pending={request:clone(request),steps:{}};}
      const pending=this.pending;if(!pending)throw Error('No pending operation');
      const result=this.data.projectHistory?await client.projectStep(rt,this.data.projectHistory,pending.request,pending.steps,'request'):await client.step(rt,sid,pending.request,pending.steps,'request');check();
      this.showView(result);
      if(result.view.transfer&&typeof result.view.transfer.content==='string'){
        const saved=await client.download(rt,sid,pending.request,result,(offset,size)=>this.setData({receipt:`${offset} / ${size} bytes`}));check();this.setData({downloaded:saved});
      }
      this.pending=null;this.setData({unknown:false});
    }catch(error){this.setData({error:errorText(error),unknown:!!error.uncertain,receipt:error.uncertain?'\u7ed3\u679c\u672a\u77e5\uff0c\u4e0d\u8981\u91cd\u590d\u521b\u5efa\u64cd\u4f5c':'\u64cd\u4f5c\u672a\u5b8c\u6210'});}
    finally{this.setData({busy:false});this.refresh();}
  },
  load(){
    if(this.data.kind==='organization'){
      this.setData({view:null,entries:[],forms:[],globalForms:[],catalogGroups:[],pageTitle:workspaceNav.LABELS.organization,error:''});this.refresh();return;
    }
    return this.run(this.readRequest||{kind:this.data.kind});
  },
  returnToSession(){if(this.data.projectHistory){wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/sessions/index'})});return;}nav.returnToSession(this.data.id);},
  reload(){this.contentEpoch=runtime().contentEpoch;this.bodyEpoch=runtime().bodyEpoch[this.data.id]||0;return this.load();},
  retryPending(){return this.pending?this.run(null,true):this.reconcile();},
  home(){this.readRequest=null;this.setData({kind:'overview',pageTitle:workspaceNav.LABELS.overview});return this.load();},
  showOrganization(){if(this.data.busy||this.data.unknown)return;clearInterval(this.fileWatch);this.fileWatch=null;this.readRequest=null;this.pending=null;this.setData({kind:'organization'});return this.load();},
  showAttachments(){if(this.data.busy||this.data.unknown)return;this.readRequest=null;this.setData({kind:'attachments'});return this.load();},
  finishSelection(){if(!this.data.busy&&!this.data.unknown)nav.returnToSession(this.data.id);},
  projectForms(){
    const controls=this._controls||{};
    const global=(this._globalControlIds||[]).map(id=>clone(controls[id]));
    const pagination=form=>form.request?.kind==='extensions'&&Number.isSafeInteger(form.request.offset)&&form.request.offset>=0&&!form.fields.length&&!form.confirm;
    this.setData({entries:this.data.entries.map(e=>Object.assign({},e,{formItems:(e.controlIds||[]).map(id=>clone(controls[id]))})),paginationForms:global.filter(pagination),globalForms:global.filter(form=>!pagination(form))});
  },
  toggleForm(e){const c=this._controls&&this._controls[e.currentTarget.dataset.id];if(!c)return;c.expanded=!c.expanded;this.setData({forms:this.data.forms.map(x=>x.id===c.id?clone(c):x)});this.projectForms();},
  openEntry(e){const item=this.data.entries.find(x=>x.id===e.currentTarget.dataset.id);if(item&&item.request)return this.run(item.request);},
  async chooseThinking(e){const item=this.data.entries.find(x=>x.id===e.currentTarget.dataset.id);const cid=item&&item.controlIds&&item.controlIds[0];if(!cid)return;await this.perform({currentTarget:{dataset:{id:cid}}});if(this.data.kind==='thinking'&&!this.data.error&&!this.data.busy)this.reload();},
  fieldInput(e){
    const {id,key}=e.currentTarget.dataset,c=this._controls&&this._controls[id];if(!c)return;
    const f=c.fields.find(x=>x.key===key);if(!f)return;
    if(f.type==='select'){const i=Number(e.detail.value);if(!Number.isInteger(i)||!f.options[i])return;f.selected=i;f.value=f.options[i].value;}
    else f.value=f.type==='boolean'?!!e.detail.value:e.detail.value;
    c.request[key]=f.value;this.setData({forms:this.data.forms.map(x=>x.id===id?clone(c):x)});this.projectForms();
  },
  async perform(e){
    const scope=context(this);
    const c=this._controls&&this._controls[e.currentTarget.dataset.id];if(!c)return;
    try{validate('WorkspaceRequest',c.request);}catch(error){this.setData({error:errorText(error)});return;}
    if(c.confirm&&!await confirm(c.label,c.notice||'\u8be5\u64cd\u4f5c\u4f1a\u6539\u53d8\u4e3b\u673a\u4e0a\u7684\u72b6\u6001\u3002\u8bf7\u786e\u8ba4\u76ee\u6807\u548c\u5f71\u54cd\u8303\u56f4\u3002'))return;
    if(!scope.current())return;
    return this.run(c.request);
  },
  select(e){const item=this.data.entries.find(x=>x.id===e.currentTarget.dataset.id);if(!item||!item.referenceId)return;try{runtime().selectInput(this.data.id,item);toast('\u5df2\u52a0\u5165\u8f93\u5165\u9009\u62e9\uff0c\u5c1a\u672a\u53d1\u9001');this.refresh();}catch(error){this.setData({error:errorText(error)});}},
  clearSelection(){delete runtime().inputDrafts[this.data.id];runtime().changed();this.refresh();},
  async chooseImage(){
    if(this.data.busy||this.data.unknown)return;const scope=context(this,false);
    try{const data=await client.invoke(wx,'chooseMedia',{count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['compressed']});if(!scope.current())return;const f=data.tempFiles[0];if(!f)return;
      await this.addFile({path:f.tempFilePath,size:f.size,name:'image'},f.tempFilePath,scope);
    }catch(error){if(scope.current()&&this.data.pageActive!==false)this.setData({error:errorText(error)});}
  },
  async chooseFile(){if(this.data.busy||this.data.unknown)return;const scope=context(this,false);try{const data=await client.invoke(wx,'chooseMessageFile',{count:1,type:'file'});if(!scope.current())return;const f=data.tempFiles[0];if(f)await this.addFile({path:f.path,size:f.size,name:f.name},null,scope);}catch(error){if(scope.current()&&this.data.pageActive!==false)this.setData({error:errorText(error)});}},
  async addFile(file,previewPath,scope=context(this,false)){if(!scope.current())return;const job=await client.createUpload(scope.rt,scope.sid,file);if(!scope.current())return;if(previewPath)job.previewPath=previewPath;if(this.data.pageActive!==false)this.refresh();},
  async uploadJob(e){
    if(this.data.busy)return;const job=(runtime().uploadJobs[this.data.id]||[]).find(j=>j.id===e.currentTarget.dataset.id);if(!job)return;
    this.setData({busy:true,error:''});
    try{await client.upload(runtime(),this.data.id,job,()=>this.refresh());toast('\u4e3b\u673a\u5df2\u6536\u5230\uff0c\u5c1a\u672a\u53d1\u7ed9 Agent');}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});this.refresh();}
  },
  selectUpload(e){const j=(runtime().uploadJobs[this.data.id]||[]).find(x=>x.id===e.currentTarget.dataset.id);if(j&&['received','accepted'].includes(j.state)){runtime().selectInput(this.data.id,{referenceId:j.resourceId,label:j.name,state:j.state,size:j.size});this.refresh();}},
  async removeUpload(e){
    const scope=context(this);
    const rt=runtime(),list=rt.uploadJobs[this.data.id]||[],j=list.find(x=>x.id===e.currentTarget.dataset.id);if(!j||j.running||this.data.busy)return;
    if(j.state==='unknown'){this.setData({error:errorText('OPERATION_UNKNOWN')});return;}
    if(j.resourceId){if(!await confirm('\u79fb\u9664\u9644\u4ef6\uff1f','\u5220\u9664\u8be5\u4e3b\u673a\u6682\u5b58\u526f\u672c\uff0c\u4e0d\u64a4\u56de\u5df2\u53d1\u9001\u7684\u4efb\u52a1\u3002'))return;if(!scope.current())return;await this.run({kind:'discard_upload',resourceId:j.resourceId});if(this.data.unknown||this.data.error)return;}
    if(!scope.current())return;
    rt.uploadJobs[this.data.id]=list.filter(x=>x!==j);const selected=rt.inputDrafts[this.data.id];if(selected)selected.attachments=selected.attachments.filter(x=>x.id!==j.resourceId);rt.changed();this.refresh();
  },
  async preview(e){const path=e.currentTarget.dataset.path;if(path)await client.invoke(wx,'previewImage',{urls:[path],current:path}).catch(error=>this.setData({error:errorText(error)}));},
  async share(){if(!this.data.downloaded)return;try{await client.invoke(wx,'shareFileMessage',{filePath:this.data.downloaded.filePath,fileName:this.data.downloaded.name});}catch(error){this.setData({error:errorText(error)});}},
  copyExternal(){if(this.data.view&&this.data.view.externalUrl)wx.setClipboardData({data:this.data.view.externalUrl});},
  async prefill(){const scope=context(this);if(!this.data.view||!this.data.view.prefill)return;if(!await confirm('\u8ffd\u52a0\u5230\u8349\u7a3f\uff1f','\u4fdd\u7559\u73b0\u6709\u8349\u7a3f\uff0c\u4e0d\u4f1a\u81ea\u52a8\u53d1\u9001\u3002'))return;if(!scope.current())return;const text=(runtime().draft(this.data.id)+'\n'+this.data.view.prefill).trim();if(text.length>4000){this.setData({error:errorText('PAYLOAD_TOO_LARGE')});return;}runtime().draft(this.data.id,text);toast('\u5df2\u8ffd\u52a0\u5230\u8349\u7a3f');},
  async requestOriginPrompt(){
    if((this.data.originPrompt||'').trim())return this.data.originPrompt;
    return new Promise(resolve=>wx.showModal({title:'起始任务',editable:true,placeholderText:'输入分支、克隆或导入后的任务',success:r=>resolve(r.confirm?(r.content||'').trim():null),fail:()=>resolve(null)}));
  },
  async branch(e){
    const scope=context(this);
    const entry=this.data.entries.find(x=>x.id===e.currentTarget.dataset.id);if(!entry||!entry.origin)return;
    const mode=e.currentTarget.dataset.mode,origin=clone(entry.origin);if(!['resume','fork','clone','import'].includes(mode))return;if((origin.mode==='import')!==(mode==='import'))return;origin.mode=mode;if(mode!=='fork'){delete origin.pointId;delete origin.pointLabel;}
    if(mode==='resume'){
      const s=this.data.session;
      await this.action('create',[{nodeId:s.nodeId,projectId:s.projectId,agentId:s.agentId,historyOnly:true,origin}],created=>this.open('/pages/session/index?id='+encodeURIComponent(created.id)));
      return;
    }
    if(!await confirm(mode==='import'?'导入历史':'创建分支 / 克隆','将创建独立会话，不发送任务，不覆盖原历史。请先停止原终端任务。'))return;
    if(!scope.current())return;
    const s=this.data.session;
    await this.action('create',[{nodeId:s.nodeId,projectId:s.projectId,agentId:s.agentId,historyOnly:true,origin}],created=>this.open('/pages/session/index?id='+created.id));
  },
  async usePreset(e){
    const scope=context(this);
    const item=this.data.entries.find(x=>x.id===e.currentTarget.dataset.id); if(!item||!item.preset)return;
    const prompt=await this.requestOriginPrompt();if(!scope.current()||prompt===null)return;if(!prompt.trim()){this.setData({error:errorText('EMPTY_INPUT')});return;}
    if(!await confirm(item.label,'Create a new managed session with the discovered native agent definition? The current session is unchanged.'))return;
    if(!scope.current())return;
    const s=this.data.session;await this.action('create',[{nodeId:s.nodeId,projectId:s.projectId,agentId:s.agentId,prompt,preset:clone(item.preset)}],created=>this.open('/pages/session/index?id='+created.id));
  },
  originInput(e){this.setData({originPrompt:e.detail.value});},
  metadataInput(e){const key=e.currentTarget.dataset.key;if(!['metadataTitle','metadataTags','metadataPinned','metadataArchived'].includes(key))return;this.setData({[key]:e.detail.value,metadataDirty:true});},
  async saveMetadata(){const s=this.data.session;if(!s)return;const value={revision:s.revision,title:this.data.metadataTitle,pinned:!!this.data.metadataPinned,archived:!!this.data.metadataArchived,tags:this.data.metadataTags.split(',').map(s=>s.trim()).filter(Boolean)};try{validate('SessionMetadata',value);}catch(error){this.setData({error:errorText(error)});return;}await this.action('organizeSession',[s.id,value],()=>{this.setData({metadataDirty:false});this.refresh();});},
  async exportTranscript(){
    if(this.data.busy)return;const rt=runtime(),sid=this.data.id;this.setData({busy:true,error:''});
    try{const check=client.fence(rt,sid),transcript=await rt.gateway.exportHistory(sid);check();const saved=await client.saveLocal(rt,sid,JSON.stringify(transcript,null,2),'weagent-transcript.json','application/json',check);this.setData({downloaded:saved,receipt:transcript.truncated?'\u5bfc\u51fa\u5305\u542b\u622a\u65ad\u6807\u8bb0\uff0c\u4e0d\u662f\u5b8c\u6574\u539f\u751f\u5b58\u6863':'\u53ea\u8bfb\u6587\u672c\u5feb\u7167\u5df2\u5bfc\u51fa'});}catch(error){this.setData({error:errorText(error)});}finally{this.setData({busy:false});}
  },
  async importTranscript(){
    if(this.data.busy)return;
    try{const check=client.fence(runtime(),this.data.id),selected=await client.invoke(wx,'chooseMessageFile',{count:1,type:'file',extension:['json']});check();const file=selected.tempFiles[0];if(!file)return;if(file.size>60000)throw Error('Import exceeds 60,000 bytes');const raw=await client.invoke(wx.getFileSystemManager(),'readFile',{filePath:file.path,encoding:'utf8',position:0,length:file.size});check();const transcript=validate('HistoryExport',JSON.parse(raw.data));
      if(!await confirm('\u5bfc\u5165\u53ea\u8bfb\u6587\u672c\u5feb\u7167\uff1f','\u4e0d\u6267\u884c\u6587\u4ef6\u5185\u7684\u6307\u4ee4\uff0c\u4e0d\u590d\u7528\u539f\u8fdc\u7a0b\u6807\u8bc6\uff0c\u4e0d\u81ea\u52a8\u542f\u52a8 Agent\u3002'))return;
      check();const s=this.data.session;await this.action('importHistory',[{nodeId:s.nodeId,projectId:s.projectId,agentId:s.agentId,transcript}],created=>this.open('/pages/session/index?id='+created.id));
    }catch(error){this.setData({error:errorText(error)});}
  },
  deleteChildrenInput(e){this.setData({deleteChildren:!!e.detail.value});},
  async deleteTranscript(){
    const scope=context(this);
    const s=this.data.session;if(!s||s.state!=='closed'){this.setData({error:errorText('SESSION_NOT_CLOSED')});return;}
    const includeDescendants=!!this.data.deleteChildren;
    const description=includeDescendants?'\u6e05\u9664\u5f53\u524d\u4f1a\u8bdd\u53ca\u5176\u5b50\u4f1a\u8bdd\u7684\u5e73\u53f0\u6b63\u6587\uff08\u6700\u591a 100 \u4e2a\uff09\u3002\u6240\u6709\u76ee\u6807\u5fc5\u987b\u5df2\u5173\u95ed\u3002':'\u4ec5\u6e05\u9664\u5f53\u524d\u5e73\u53f0\u4f1a\u8bdd\u7684\u6b63\u6587\uff0c\u4e0d\u5220\u9664\u5b50\u4f1a\u8bdd\u3002';
    if(!await confirm('\u6e05\u9664\u5e73\u53f0\u5386\u53f2\uff1f',description+'\u4e0d\u5220\u9664\u4e3b\u673a\u6587\u4ef6\u6216\u539f\u751f\u5386\u53f2\uff0c\u64cd\u4f5c\u56de\u6267\u4f1a\u4fdd\u7559\u3002'))return;
    if(!scope.current())return;
    await this.action('deleteHistory',[s.id,{revision:s.revision,scope:'platform',includeDescendants}],()=>this.setData({view:null,forms:[],entries:[],deleteChildren:false}));
  }
});
