const { errorText } = require('../../utils/error-display');
const {definePage,runtime,toast}=require('../../utils/page');
const {shareLabel,query}=require('../../services/shared-session');
const {validate}=require('../../services/wire');
const TTL=[{label:'15 分钟',value:900},{label:'1 小时',value:3600},{label:'1 天',value:86400},{label:'7 天',value:604800},{label:'自定义',value:0}];
const operationNames={accepted:'已受理',delivered:'等待确认',confirmed:'已确认',failed:'失败',reconciling:'正在核实'};
const actionNames={send:'发送指令',cancel:'停止本轮',respond:'回复请求'};
definePage({resource:'sessions',data:{id:'',permission:'read',ttlIndex:1,ttls:TTL,minutes:'60',shares:[],activity:[],hasInvite:false,creating:false,pending:false},
 onLoad(q){this.setData({id:q.id||''});},
 async onShow(){this.setData({creating:false,pending:!!this.pendingCreate});if(typeof wx.hideShareMenu==='function')wx.hideShareMenu({menus:['shareAppMessage','shareTimeline']});if(!runtime().live)return;const life=this.pageLife;await this.load();if(life===this.pageLife)this.timer=setInterval(()=>{if(!this.paginated)this.load().catch(()=>{});},10000);},
 onHide(){if(this.pendingCreate)this.setData({pending:true});this.setData({creating:false});clearInterval(this.timer);this.loadGeneration=(this.loadGeneration||0)+1;this.activityGeneration=(this.activityGeneration||0)+1;},
 onUnload(){clearInterval(this.timer);this.loadGeneration=(this.loadGeneration||0)+1;this.activityGeneration=(this.activityGeneration||0)+1;this.invite=null;this.pendingCreate=null;},
 refresh(){const rt=runtime();if(this.shareEpoch!==rt.epoch||this.shareContent!==rt.contentEpoch){this.shareEpoch=rt.epoch;this.shareContent=rt.contentEpoch;this.loadGeneration=(this.loadGeneration||0)+1;this.activityGeneration=(this.activityGeneration||0)+1;this.invite=null;this.setData({shares:[],activity:[],hasInvite:false,invitation:null});}if(this.pendingCreate&&this.pendingCreate.epoch!==rt.epoch){this.pendingCreate=null;this.setData({pending:false,creating:false,shares:[],activity:[]});}const s=rt.view().sessions.find(v=>v.id===this.data.id);if(this.invite&&(this.invite.epoch!==rt.epoch||this.invite.contentEpoch!==rt.contentEpoch||!rt.auth||this.invite.deadline<=Date.now())){this.invite=null;this.setData({hasInvite:false});}this.setData({session:s||null,live:rt.live});},
 choosePermission(e){if(this.data.creating||this.data.pending)return;const p=e.currentTarget.dataset.id;if(['read','control'].includes(p))this.setData({permission:p});},
 chooseTTL(e){if(this.data.creating||this.data.pending)return;const i=Number(e.currentTarget.dataset.index);if(Number.isInteger(i)&&TTL[i])this.setData({ttlIndex:i});},
 minutes(e){if(!this.data.creating&&!this.data.pending)this.setData({minutes:e.detail.value});},
 async load(more=false){
  more=more===true;this.paginated=more;const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife,generation=this.loadGeneration=(this.loadGeneration||0)+1;
  if(!rt.live||!this.data.id)return;
  try{const result=await rt.gateway.request('/sessions/'+encodeURIComponent(this.data.id)+'/shares?'+query({pageToken:more?this.nextShare:undefined}),'ShareList');
   if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife||generation!==this.loadGeneration)return;
   this.nextShare=result.nextPageToken;const shares=result.items.map(v=>shareLabel(v,result.serverTime));this.setData({shares:more?this.data.shares.concat(shares):shares,moreShares:!!this.nextShare,error:''});
   if(this.invite){const match=this.data.shares.find(v=>v.id===this.invite.id);if(match&&(!match.active||match.acceptedAt)){this.invite=null;this.setData({hasInvite:false});}}
   if(!more)await this.loadActivity();
  }catch(error){if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&generation===this.loadGeneration){this.invite=null;this.setData({error:errorText(error),hasInvite:false});}}
 },
 loadMore(){return this.load(true);},
 async loadActivity(more=false){
  more=more===true;const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;
  const generation=this.activityGeneration=(this.activityGeneration||0)+1;
  try{const result=await rt.gateway.request('/sessions/'+encodeURIComponent(this.data.id)+'/share-activity?'+query({pageToken:more?this.nextActivity:undefined}),'ShareActivity');
  if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife||generation!==this.activityGeneration)return;this.nextActivity=result.nextPageToken;
  const activity=result.items.map(v=>Object.assign({},v,{actionLabel:actionNames[v.action],stateLabel:operationNames[v.state]}));this.setData({activity:more?this.data.activity.concat(activity):activity,moreActivity:!!this.nextActivity});
  }catch(error){if(runtime()===rt&&epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&generation===this.activityGeneration)this.setData({error:errorText(error)});}
 },
 moreActivity(){return this.loadActivity(true);},
 create(){
  if(this.data.creating||this.data.pending||!this.data.live||!this.data.session)return;
  let ttl=TTL[this.data.ttlIndex].value;
  if(!ttl){if(!/^\d+$/.test(this.data.minutes)){toast(errorText('SHARE_TTL_INVALID'));return;}ttl=Number(this.data.minutes)*60;}
  if(ttl<900||ttl>604800){toast(errorText('SHARE_TTL_INVALID'));return;}
  const rt=runtime(),epoch=rt.epoch,contentEpoch=rt.contentEpoch,life=this.pageLife;const body={permission:this.data.permission,ttlSeconds:ttl};validate('CreateShare',body);
  const content=body.permission==='control'?'对方可阅读此会话及工具输出，发送指令和回复审批。操作可修改项目文件；撤销不撤回已受理的任务。':'对方可阅读此会话的全部历史、工具输出与代码改动。';
  wx.showModal({title:body.permission==='control'?'允许控制会话？':'分享会话记录？',content,confirmText:'创建邀请',success:r=>{if(r.confirm&&runtime()===rt&&rt.auth&&epoch===rt.epoch&&contentEpoch===rt.contentEpoch&&life===this.pageLife)this.submitCreate(body);}});
 },
 async submitCreate(body){
  if(this.data.creating)return;const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;this.setData({creating:true,error:''});
  try{if(!this.pendingCreate){const id=await rt.gateway.id('share');if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife)return;this.pendingCreate={id,body,epoch};}
   if(this.pendingCreate.epoch!==epoch){this.pendingCreate=null;throw Error('登录已更新');}
   const started=Date.now(),p=this.pendingCreate,result=await rt.gateway.request('/sessions/'+encodeURIComponent(this.data.id)+'/shares','ShareInvitation','POST',p.body,'CreateShare',p.id);
   if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife)return;
   this.pendingCreate=null;this.invite=result.token?{id:result.share.id,token:result.token,epoch,contentEpoch:content,deadline:started+Date.parse(result.share.expiresAt)-Date.parse(result.serverTime)}:null;
   this.setData({hasInvite:!!this.invite,pending:false,invitation:shareLabel(result.share,result.serverTime)});await this.load();
  }catch(error){if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife){if(!error.uncertain)this.pendingCreate=null;this.setData({error:errorText(error),pending:!!this.pendingCreate});}}
  finally{if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife)this.setData({creating:false});}
 },
 recoverInvite(){if(this.pendingCreate)return this.submitCreate(this.pendingCreate.body);},
 onShareAppMessage(event){
  const rt=runtime(),invite=this.invite;
  if(event.from!=='button'||!invite||invite.epoch!==rt.epoch||invite.contentEpoch!==rt.contentEpoch||!rt.auth||Date.now()>=invite.deadline)return {title:'喵连',path:'/pages/login/index',imageUrl:'/assets/share-card.png'};
  return {title:this.data.invitation.permission==='control'?'邀你一起完成这个任务':'与你分享一个会话',path:'/pages/shared/index?token='+encodeURIComponent(invite.token),imageUrl:'/assets/share-card.png'};
 },
 revoke(e){const id=e.currentTarget.dataset.id,rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;
  wx.showModal({title:'撤销这个分享？',content:'对方将无法继续访问。已受理的操作不会自动停止。',confirmText:'撤销',success:async r=>{if(!r.confirm||epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife)return;try{await rt.gateway.request('/session-shares/'+encodeURIComponent(id)+'/revoke','SessionShare','POST');if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife)return;if(this.invite&&this.invite.id===id){this.invite=null;this.setData({hasInvite:false});}await this.load();}catch(error){if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife)this.setData({error:errorText('OPERATION_UNKNOWN')});}}});
 }
});
