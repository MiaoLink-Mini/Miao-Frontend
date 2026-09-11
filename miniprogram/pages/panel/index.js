const {
  definePage,runtime,toast
}
=require('../../utils/page');
const {
  capability,controlReason
}
=require('../../utils/policy');
const navigation=require('../../utils/navigation');
const PANELS={
  menu:{
    title:'会话设置与更多',intro:''
  }
  ,plan:{
    title:'执行计划',intro:'',groups:['L']
  }
  ,diff:{
    title:'文件改动',intro:'',groups:['M']
  }
  ,usage:{
    title:'用量与上下文',intro:'',groups:['O']
  }
  ,history:{
    title:'历史与分支',intro:'',groups:['F']
  }
  ,config:{
    title:'原生模型',intro:''
  }
  ,compact:{
    title:'压缩上下文',intro:''
  }
  ,input:{
    title:'附件与命令',intro:'',groups:['G','N']
  }
  ,queue:{
    title:'待执行消息',intro:'',groups:['G']
  }
  ,tasks:{
    title:'子任务与后台任务',intro:'',groups:['L']
  }
  ,files:{
    title:'文件与成果',intro:'',groups:['M']
  }
  ,extensions:{
    title:'扩展与加载诊断',intro:'',groups:['N']
  }
  ,account:{
    title:'Agent 账号与额度',intro:'',groups:['E','O']
  }
  ,checkpoints:{
    title:'检查点与文件还原',intro:'',groups:['M']
  }
}
;
const MENU=[['plan','计划与目标'],['diff','文件改动'],['tasks','子任务与后台任务'],['usage','用量、上下文与重试'],['config','原生模型'],['compact','压缩上下文'],['queue','待执行消息'],['history','历史、分支与整理'],['files','文件与成果'],['checkpoints','检查点与还原'],['input','附件、Skills 与命令'],['extensions','扩展与诊断']];
definePage({
  data:{
    kind:'menu',sessionId:'',projectId:'',agentId:'',itemKey:'',collapsed:{},fileLimit:80,models:[],selectedModel:null,modelNotice:'',modelsLoaded:false,thinkingEntry:null
  }
  ,onLoad(q){
    let itemKey=q.itemKey||'';
    try { itemKey=decodeURIComponent(itemKey); } catch (_) { /* Keep malformed keys unmatched. */ }
    this.setData({
      kind:PANELS[q.kind]?q.kind:'menu',sessionId:q.sessionId||'',projectId:q.projectId||'',agentId:q.agentId||'',itemKey
    }
    );
  }
  ,async onShow(){
      const rt=runtime(),epoch=rt.epoch,life=this.pageLife;
    const workspaceKinds={input:'attachments',files:'files',tasks:'tasks',extensions:'extensions',checkpoints:'checkpoints',account:'account',queue:'queue',history:'history'};
    if(runtime().live&&this.data.sessionId&&workspaceKinds[this.data.kind]){
      wx.redirectTo({url:'/pages/workspace/index?id='+encodeURIComponent(this.data.sessionId)+'&kind='+workspaceKinds[this.data.kind]});return;
    }

      if(this.data.sessionId)await runtime().loadTimeline(this.data.sessionId);
      if(runtime()!==rt||rt.epoch!==epoch||this.pageLife!==life||this.data.pageActive===false)return;
      this.refresh();
      if(runtime().live&&this.data.kind==='config')await this.loadModels();
    if(runtime().live&&this.data.kind==='diff'&&this.data.detail){
      for(const file of this.data.detail.files){
        await runtime().gateway.diffFile(file.id,this.data.sessionId);
      }
      this.refresh();
    }
  }
  ,refresh(){
    const v=runtime().view(),s=v.sessions.find(s=>s.id===this.data.sessionId),project=v.projects.find(p=>p.id===this.data.projectId),agent=v.agents.find(a=>a.id===this.data.agentId);
    const invalid=!!((this.data.sessionId&&!s)||(this.data.projectId&&!project)||(this.data.agentId&&!agent));
    const panel=PANELS[this.data.kind];
    const timeline=runtime().timelines[this.data.sessionId];
    const items=timeline?timeline.items:[];
    const selected=this.data.itemKey?items.find(i=>i.key===this.data.itemKey):items.slice().reverse().find(i=>i.type===this.data.kind);
    const detail=selected||null;
    const files=detail&&detail.files?detail.files.map(f=>{
      const snapshot=runtime().live&&runtime().gateway.files[f.id];
      const lines=snapshot?require('../../services/wire').patchLines(snapshot.patch):(f.lines||[]);
      return Object.assign({},f,{patch:snapshot?snapshot.patch:(typeof f.patch==='string'?f.patch:lines.map(line=>line.text).join('\n')),truncated:!!(snapshot&&snapshot.truncated),visibleLines:lines.slice(0,this.data.fileLimit),hasMore:lines.length>this.data.fileLimit});
    }):[];
    const groups=panel.groups||[]; // Historical panel metadata; no user-facing implementation checklist.
    const key=this.data.kind==='compact'?'compact':'models';
    const nativeReason=!runtime().live?'演示模式不调用原生运行时':!s?'会话不可访问':controlReason(s,s.node,v.connection)||(!capability(s,key)?'当前会话未开放此原生能力':s.active?'请等待本轮结束后操作':'');
    if(!s || this.modelTurn && this.modelTurn!==s.turnId){this.modelTurn=null;this.setData({models:[],modelsLoaded:false,selectedModel:null,modelNotice:'',thinkingEntry:null});}
    this.setData({demo:!runtime().live,
      nativeReason,nativeSupported:!!(runtime().live&&s&&capability(s,key)),
      title:panel.title,intro:panel.intro,session:s||null,menuGroups:navigation.sessionGroups(s,runtime().live),invalid,detail:invalid?null:detail,files:invalid?[]:files,menu:MENU.filter(([kind])=>!['plan','diff','usage','compact'].includes(kind)||s&&capability(s.capabilities ? s : s.agent,kind)).map(([kind,label])=>({
        kind,label
      }
      )),requirements:[],queue:s?s.queue:[]
    }
    );
  }
  ,loadModels(){
    this.refresh();if(this.data.nativeReason||this.data.busy||this.data.unknown)return;
    const turn=this.data.session.turnId;
    return this.action('native',[this.data.sessionId,turn,{action:'models'}],result=>{
      this.modelTurn=turn;this.setData({models:result.models,selectedModel:result.selected,modelsLoaded:true,modelNotice:result.truncated?'目录已截断，仅显示前 100 项。':''});
    });
  }
  ,chooseModel(e){
    this.refresh();if(this.data.nativeReason||this.data.busy||this.data.unknown)return;
    const model=this.data.models.find(m=>m.id===e.currentTarget.dataset.id);if(!model||this.data.selectedModel===model.id)return;
    const turn=this.data.session.turnId;
    this.action('native',[this.data.sessionId,turn,{action:'set_model',modelId:model.id}],result=>{
      this.setData({selectedModel:result.modelId,thinkingEntry:Array.isArray(model.thinking)&&model.thinking.length?{id:model.id,label:model.label,levels:model.thinking}:null});
      toast(result.applied?'模型已切换':'已暂存，下次发送生效');
    });
  }
  ,openThinking(){
      if(this.data.nativeReason||this.data.busy||this.data.unknown||!this.data.session?.capabilities?.workspace)return;
      this.open('/pages/workspace/index?id='+encodeURIComponent(this.data.sessionId)+'&kind=thinking');
  }
  ,compact(){
    this.refresh();if(this.data.nativeReason||this.data.busy||this.data.unknown)return;
    const turn=this.data.session.turnId;
    wx.showModal({title:'确认压缩上下文？',content:'主机可能调用模型并产生费用。上下文会被摘要替换，不能保证保留所有细节。移动端历史与文件不受清理。',confirmText:'开始压缩',success:r=>{
      if(r.confirm)this.action('native',[this.data.sessionId,turn,{action:'compact'}],result=>this.setData({modelNotice:result.status==='completed'?'原生压缩已完成。':'主机已受理压缩，不代表完成；请在会话时间线查看最终状态。'}));
    }});
  }
  ,moreLines(){
    this.setData({
      fileLimit:this.data.fileLimit+80
    }
    );
    this.refresh();
  }
  ,toggleFile(e){
    const key='collapsed.'+e.currentTarget.dataset.index;
    this.setData({
      [key]:!(this.data.collapsed&&this.data.collapsed[e.currentTarget.dataset.index])
    }
    );
  }
  ,openFile(e){
    this.open('/pages/file/index?sessionId='+this.data.sessionId+'&itemKey='+encodeURIComponent(this.data.detail.key)+'&fileId='+e.currentTarget.dataset.id);
  }
}
);
