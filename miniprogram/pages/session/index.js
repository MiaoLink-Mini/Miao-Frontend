const { errorText } = require('../../utils/error-display');
const {
  definePage,runtime,toast
}
=require('../../utils/page');
const {
  capability,controlReason
}
=require('../../utils/policy');
const { suggestions } = require('../../utils/slash-commands');
const navigation = require('../../utils/navigation');
definePage({
  resource: "sessions",
  async restoreSession(){
    this.refresh();
    const rt=runtime(),s=this.data.session;
    if(this.restoring||!rt.live||!s||s.state!=='closed'||s.mode==='readonly'||!s.agent?.capabilities?.historyImport||!s.node?.online||rt.connection!=='online'||this.data.busy||this.data.unknown)return;
    const epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;
    const current=()=>runtime()===rt&&rt.auth&&rt.epoch===epoch&&rt.contentEpoch===content&&this.pageLife===life&&this.data.pageActive!==false&&this.data.id===s.id;
    this.restoring=true;
    try{
      let resumed=false;
      await this.action('native',[s.id,s.turnId,{action:'workspace',request:{kind:'resume'}}],()=>{resumed=true;});
      if(!resumed||!current())return;
      await rt.ensure('sessions',s.id,true);
      if(current())this.refresh();
    }finally{this.restoring=false;}
  },
  shareSession(){this.open('/pages/share/index?id='+encodeURIComponent(this.data.id));},
  panelQuick(e){const url=navigation.sessionUrl(e.currentTarget.dataset.kind,this.data.id,runtime().live);if(url)this.open(url);},
  data:{
    id:'',draft:'',busy:false,limit:24,loading:true,following:true,scrollTarget:'',keyboardHeight:0,menuOpen:false,menuGroups:[],scrollAnimated:false,
    slashOpen:false,slashItems:[],slashCommand:null,slashPending:false,slashDismissed:false,slashLiteral:false,slashMaxHeight:260,composerFocused:false,sendDisabled:true
  }
  ,onLoad(q){
    this.setData({
      id:q.id||'',draft:runtime().draft(q.id||'')
    }
    );
  }
  ,onHide(){ runtime().unwatchSession(this.data.id); this.dragTop=undefined; this.setData({items:[],slashOpen:false,slashItems:[],menuOpen:false,keyboardHeight:0,composerFocused:false}); }
  ,onUnload(){
    runtime().unwatchSession(this.data.id);
  }
  ,async onShow(){
    const rt=runtime(),epoch=rt.epoch,life=this.pageLife;
    rt.watchSession(this.data.id);
    try{
      await runtime().loadTimeline(this.data.id);
    }
    catch(e){
      if(life!==this.pageLife||epoch!==rt.epoch)return;
      this.setData({
        error:errorText(e)
      }
      );
    }
    finally{
      if(life!==this.pageLife||epoch!==rt.epoch)return;
      this.setData({
        loading:false
      }
      );
      this.refresh();
    }
  }
  ,refresh(){
    const selected=runtime().inputSelection(this.data.id);
    this.setData({inputSummary:[...selected.attachments,...selected.references,...(selected.command?[selected.command]:[])].map(x=>x.label).join(" / "),live:runtime().live});
    const rt=runtime(),v=rt.view(),session=v.sessions.find(s=>s.id===this.data.id);
    if(!session){
      this.setData({
        session:null,items:[],draft:'',loading:false,slashOpen:false,slashItems:[],slashCommand:null,slashPending:false,sendDisabled:true
      }
      );
      return;
    }
    const timeline=rt.timelines[session.id],all=require('../../stores/timeline').usageAtTurnEnd(timeline?timeline.items:[]),items=all.slice(-this.data.limit);
    const reason=controlReason(session,session.node,v.connection),queueAllowed=capability(session.capabilities ? session : session.agent,'queue');
    const sendReason=reason||(!capability(session.capabilities ? session : session.agent,'send')?'当前会话不支持发送':session.active&&!queueAllowed?'请等待本轮结束后发送':'');
    this.setData({
      session,items,draft:rt.draft(this.data.id),menuGroups:navigation.sessionGroups(session,rt.live),pendingRequest:v.requests.find(request=>request.sessionId===session.id&&(request.state==='deciding'||request.state==='pending'&&!request.expired))||null,hasPlan:capability(session.capabilities ? session : session.agent,'plan'),hasDiff:capability(session.capabilities ? session : session.agent,'diff'),hasUsage:capability(session.capabilities ? session : session.agent,'usage'),hasMore:all.length>items.length,connection:v.connection,connectionLabel:v.connectionLabel,reason,sendReason,queueAllowed,canCancel:session.active&&capability(session.capabilities ? session : session.agent,'cancel')&&!reason,mode:session.active?'queue':'send',gap:!!(timeline&&timeline.gap),preferences:v.preferences,phase:rt.operations[this.operationId]||''
    }
    );
    const revision=items.map(i=>i.key+':'+(i.text||'').length+':'+(i.detail||'').length+':'+(i.state||'')).join('|');
    if(this.transcriptRevision!==revision){this.transcriptRevision=revision;if(this.data.following)this.latest();}
    this.updateComposer();
  }
  ,input(e){
    runtime().draft(this.data.id,e.detail.value);
    this.updateComposer({draft:e.detail.value,slashDismissed:false,slashLiteral:false});
  }
  ,updateComposer(patch){
    const data=Object.assign({},this.data,patch||{}),match=suggestions(data.draft,data.session);
    const pending=match.query!==null&&!data.slashLiteral;
    this.setData(Object.assign({},patch||{},{
      slashOpen:pending&&!data.slashDismissed&&!data.busy&&!data.unknown,
      slashItems:match.items,slashCommand:pending?match.command:null,slashPending:pending,
      sendLabel:pending?(match.command?'打开 /'+match.command.name:'补全命令'):data.session&&data.session.active?'加入队列':'发送',
      sendDisabled:!!(data.busy||data.unknown||!data.session||data.session.mode==='readonly'||(pending?!match.items.length:data.sendReason||!data.draft.trim()))
    }));
  }
  ,showCommands(){
    if(this.data.busy||this.data.unknown)return;
    if(this.data.draft.trim()&&suggestions(this.data.draft,this.data.session).query===null){
      toast('在输入开头键入 / 查看命令，当前草稿已保留');return;
    }
    const draft=this.data.draft.trim()?this.data.draft:'/';
    runtime().draft(this.data.id,draft);
    this.updateComposer({draft,slashDismissed:false,slashLiteral:false,composerFocused:true});
  }
  ,dismissCommands(){
    this.updateComposer({slashDismissed:true});
  }
  ,literalCommand(){
    this.updateComposer({slashDismissed:true,slashLiteral:true});
  }
  ,chooseCommand(e){
    this.refresh();
    if(this.data.busy||this.data.unknown)return;
    const name=e.currentTarget.dataset.name;
    const command=this.data.slashItems.find(item=>item.name===name);
    if(!command)return;
    const draft='/'+command.name;
    runtime().draft(this.data.id,draft);
    this.updateComposer({draft,slashDismissed:true,slashLiteral:false,composerFocused:true});
  }
  ,focusInput(){
    this.updateComposer({composerFocused:true});
  }
  ,blurInput(){
    this.setData({composerFocused:false});
  }
  ,send(){
    // Re-read session/capability state before interpreting or sending any draft.
    this.refresh();
    if(this.data.sendDisabled)return;
    if(this.data.slashPending){
      const command=this.data.slashCommand;
      if(!command){
        this.chooseCommand({currentTarget:{dataset:{name:this.data.slashItems[0].name}}});return;
      }
      runtime().draft(this.data.id,'');
      this.updateComposer({draft:'',slashDismissed:false,slashLiteral:false,composerFocused:false});
      if(command.panel){const url=navigation.sessionUrl(command.panel,this.data.id,runtime().live);if(url)this.open(url);}
      else if(command.action==='latest')this.latest();
      return;
    }
    const text=this.data.draft, rt=runtime(), selection=rt.inputDrafts[this.data.id];
    const method=rt.live?'sendInput':'send';
    const args=[this.data.id,this.data.session.turnId,text,this.data.mode];
    if(rt.live)args.push(rt.selectedInput(this.data.id));
    this.action(method,args,()=>{
      if(rt.inputDrafts[this.data.id]===selection)delete rt.inputDrafts[this.data.id];
      if(runtime().draft(this.data.id)===text){
        runtime().draft(this.data.id,'');
        this.updateComposer({
          draft:''
        }
        );
      }
      this.latest();
    }
    );
  }
  ,cancel(){
    if(!this.data.canCancel||this.data.busy)return;
    const turnId=this.data.session.turnId,epoch=runtime().epoch,life=this.pageLife;
    wx.showModal({
      title:'停止当前轮次？',content:`${this.data.session.node.name} / ${this.data.session.project.name} / ${this.data.session.agent.name}。已完成的文件修改不会自动撤回；排队消息会保留。`,confirmText:'停止本轮',success:r=>{
        if(r.confirm&&epoch===runtime().epoch&&life===this.pageLife){
          this.setData({
            cancelPending:true
          }
          );
          this.action('cancel',[this.data.id,turnId],()=>this.setData({
            cancelPending:false
          }
          )).finally(()=>this.setData({
            cancelPending:false
          }
          ));
        }
      }
    }
    );
  }
  ,removeInputs(){
    delete runtime().inputDrafts[this.data.id];runtime().changed();this.refresh();
  }

  ,more(){this.refresh();this.setData({menuOpen:true,slashOpen:false,composerFocused:false});}
  ,closeMenu(){this.setData({menuOpen:false});}
  ,selectMenu(e){
    this.refresh();
    const kind=e.currentTarget.dataset.kind;
    const entry=this.data.menuGroups.flatMap(group=>group.items).find(item=>item.kind===kind);
    if(!entry)return;
    this.setData({menuOpen:false});this.open(entry.url);
  }
  ,openPending(){const request=this.data.pendingRequest;if(request)this.open('/pages/request/index?id='+encodeURIComponent(request.id));}
  ,openQueue(){const url=navigation.sessionUrl('queue',this.data.id,runtime().live);if(url)this.open(url);}
  ,dragStart(e){this.dragTop=e.detail.scrollTop;}
  ,dragging(e){if(Number.isFinite(this.dragTop)&&e.detail.scrollTop<this.dragTop-3)this.pauseFollow();}
  ,dragEnd(){this.dragTop=undefined;}
  ,reachLatest(){this.setData({following:true});}

  ,openEvent(e){
    const item=e.detail.item;
    if(item.requestId)this.open('/pages/request/index?id='+item.requestId);
    else if(item.panel||['plan','diff','usage'].includes(item.type))this.open('/pages/panel/index?kind='+(item.panel||item.type)+'&sessionId='+this.data.id+'&itemKey='+encodeURIComponent(item.key));
  }
  ,quote(e){
    if(!e.detail.text)return;
    const text=(this.data.draft?this.data.draft+'\n':'')+'> '+e.detail.text+'\n';
    runtime().draft(this.data.id,text);
    this.updateComposer({
      draft:text,slashDismissed:false,slashLiteral:false
    }
    );
    toast('已加入输入草稿');
  }
  ,pauseFollow(){
    this.setData({
      following:false,scrollTarget:''
    }
    );
  }
  ,latest(event){
    this.setData({
      following:true,scrollTarget:'',scrollAnimated:!!event&&this.data.motionMode==='full'
    }
    ,()=>this.setData({
      scrollTarget:'latest'
    }
    ));
  }
  ,loadMore(){
    this.setData({
      limit:this.data.limit+24,following:false,scrollTarget:''
    }
    );
    this.refresh();
  }
  ,keyboard(e){
    const info=(wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync())||{};
    const height=Math.max(0,e.detail.height||0);
    this.setData({
      keyboardHeight:height,slashMaxHeight:Math.max(96,Math.min(260,(info.windowHeight||640)-height-235))
    }
    );
  }
  ,attachments(){
    const url=navigation.sessionUrl('input',this.data.id,runtime().live);if(url)this.open(url);
  }
}
);
