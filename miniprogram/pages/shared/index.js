const { errorText } = require('../../utils/error-display');
const {definePage,runtime,toast}=require('../../utils/page');
const {SharedSessionClient,shareLabel,query}=require('../../services/shared-session');
const {validate}=require('../../services/wire');
const {ACTIVE,STATE_NAMES}=require('../../utils/policy');
const TERMINAL={confirmed:'已确认',failed:'操作失败',accepted:'已受理',delivered:'等待确认',reconciling:'正在核实'};
definePage({public:true,data:{id:'',authenticated:false,invited:false,meta:null,items:[],shares:[],draft:'',busy:false,unknown:false,queueMode:false,limit:60,following:true,scrollTarget:'',scrollAnimated:false,answers:{},request:null,diff:null,keyboardHeight:0},
 onLoad(q){
  const app=getApp();try{
   if(q.token){validate('ShareToken',q.token);this.inviteToken=q.token;this.setData({invited:true});}
   else if(q.id){validate('Id',q.id);this.setData({id:q.id});}
   else if(app.pendingShareToken){validate('ShareToken',app.pendingShareToken);this.inviteToken=app.pendingShareToken;app.pendingShareToken=null;this.setData({invited:true});}
  }catch(_){this.setData({error:errorText('VALIDATION_FAILED'),unavailable:true});}
 },
 async onShow(){
  if(typeof wx.hideShareMenu==='function')wx.hideShareMenu({menus:['shareAppMessage','shareTimeline']});
  this.setData({busy:false});this.refresh();if(!runtime().auth)return;
  if(this.data.id)return this.startSession();
  if(!this.data.invited&&!this.data.unavailable)return this.loadShares();
 },
 onHide(){if(this.data.busy&&this.operationId)this.setData({unknown:true});this.stopSession();},onUnload(){this.stopSession();this.inviteToken=null;this.pendingText=null;},
 refresh(){const rt=runtime();if(this.operationEpoch!==undefined&&this.operationEpoch!==rt.epoch){this.operationId=null;this.pendingText=null;this.setData({unknown:false,busy:false,receipt:'',commandError:''});}this.setData({authenticated:!!rt.auth,live:rt.live,preferences:rt.preferences});if(!rt.auth){this.stopSession();this.setData({shares:[]});}},
 login(){if(this.inviteToken)getApp().pendingShareToken=this.inviteToken;wx.reLaunch({url:'/pages/login/index'});},
 async accept(){
  const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;if(!rt.auth||!rt.live||this.data.busy||!this.inviteToken)return;
  this.setData({busy:true,error:''});try{
   const result=await rt.gateway.request('/session-shares/redeem','SessionShare','POST',{token:this.inviteToken},'RedeemShare');
   if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife)return;this.inviteToken=null;getApp().pendingShareToken=null;
   wx.redirectTo({url:'/pages/shared/index?id='+encodeURIComponent(result.id)});
  }catch(e){if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife)this.setData({error:errorText(e)});}
  finally{if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife)this.setData({busy:false});}
 },
 decline(){this.inviteToken=null;getApp().pendingShareToken=null;this.setData({invited:false,error:''});if(runtime().auth)this.loadShares();else wx.reLaunch({url:'/pages/login/index'});},
 async loadShares(more=false){
  more=more===true;const rt=runtime(),epoch=rt.epoch,content=rt.contentEpoch,life=this.pageLife;if(!rt.live||!rt.auth)return;
  const generation=this.listGeneration=(this.listGeneration||0)+1;this.setData({loading:true,error:''});
  try{const result=await rt.gateway.request('/session-shares?'+query({pageToken:more?this.nextShares:undefined}),'ShareList');
   if(epoch!==rt.epoch||content!==rt.contentEpoch||life!==this.pageLife||generation!==this.listGeneration)return;this.nextShares=result.nextPageToken;
   const shares=result.items.map(v=>shareLabel(v,result.serverTime));this.setData({shares:more?this.data.shares.concat(shares):shares,moreShares:!!this.nextShares});
  }catch(e){if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&generation===this.listGeneration)this.setData({error:errorText(e)});}
  finally{if(epoch===rt.epoch&&content===rt.contentEpoch&&life===this.pageLife&&generation===this.listGeneration)this.setData({loading:false});}
 },
 moreShares(){return this.loadShares(true);},
 async startSession(){
  this.stopSession();if(!runtime().live||!runtime().auth||!this.data.id)return;
  const life=this.pageLife,client=new SharedSessionClient(runtime(),this.data.id,state=>{if(this.client===client&&life===this.pageLife)this.renderSession(state);});
  this.client=client;this.setData({loading:true,error:'',unavailable:false});
  try{await client.start();}catch(_){/* The client clears all private bodies before reporting failure. */}
  finally{if(this.client===client&&life===this.pageLife)this.setData({loading:false,busy:false});}
 },
 stopSession(){
  if(this.client)this.client.stop();this.client=null;this.listGeneration=(this.listGeneration||0)+1;this.answerValues=Object.create(null);this.pendingText=null;this.allItems=[];this.stamp='';this.dragTop=undefined;
  this.setData({meta:null,shares:[],session:null,agent:null,detail:'',pendingRequests:[],hasMore:false,isController:false,canQueue:false,queueMode:false,items:[],request:null,diff:null,diffFiles:[],answers:{},draft:'',canSend:false,canCancel:false,keyboardHeight:0,detailError:''});
 },
 renderSession(state){
  if(!state.meta){this.allItems=[];this.answerValues=Object.create(null);this.pendingText=null;this.stamp='';this.setData({meta:null,session:null,agent:null,detail:'',pendingRequests:[],hasMore:false,isController:false,canQueue:false,queueMode:false,items:[],request:null,diff:null,diffFiles:[],answers:{},draft:'',canSend:false,canCancel:false,unavailable:true,error:state.error ? errorText(state.error) : ''});return;}
  const meta=state.meta,s=meta.session,active=ACTIVE.includes(s.state),control=meta.share.permission==='control';
  const enabled=control&&meta.nodeOnline&&s.mode==='managed'&&s.state!=='closed'&&s.state!=='idle'&&s.turnId&&s.historyState==='available';
  const queueMode=active&&this.data.queueMode,canQueue=!!(enabled&&active&&s.state!=='cancelling'&&s.capabilities.queue);
  const request=this.data.request&&(state.requests[this.data.request.id]||this.data.request);
  const stamp=state.items.map(i=>i.key+':'+(i.text||'').length+':'+(i.detail||'').length+':'+(i.state||'')).join('|');
  this.allItems=state.items;
  const requests=meta.requests.filter(r=>r.state==='pending');
  this.setData({meta,session:s,agent:{name:meta.agentName},grant:shareLabel(meta.share,meta.serverTime),stateLabel:STATE_NAMES[s.state],items:state.items.slice(-this.data.limit),hasMore:state.items.length>this.data.limit,pendingRequests:requests,active,canQueue,queueMode,canSend:!!(enabled&&(active?canQueue&&queueMode:s.capabilities.send)),canCancel:!!(enabled&&active&&s.state!=='cancelling'&&s.capabilities.cancel),isController:control,request,unavailable:false,error:''});
  if(stamp!==this.stamp){this.stamp=stamp;if(this.data.following)this.latest();}
  if(this.data.unknown&&this.operationId&&!this.receiptBusy)this.reconcileShared();
 },
 async retry(){if(this.data.id)return this.startSession();return this.loadShares();},
 input(e){this.setData({draft:e.detail.value});},toggleQueue(){if(this.data.canQueue){this.setData({queueMode:!this.data.queueMode});if(this.client&&this.client.meta)this.renderSession({meta:this.client.meta,items:this.client.timeline.items,requests:this.client.requests});}},
 send(){if(!this.data.canSend||!this.data.draft.trim())return;const s=this.data.session,text=this.data.draft;this.pendingText=text;return this.runCommand({action:'send',payload:{expectedTurnId:s.turnId,text,mode:this.data.queueMode?'queue':'send',capabilityRevision:s.capabilityRevision}});},
 cancel(){if(!this.data.canCancel||this.data.busy||this.data.unknown)return;const s=this.data.session,client=this.client,life=this.pageLife;wx.showModal({title:'停止本轮？',content:'已完成的文件修改不会撤回。',confirmText:'停止',success:r=>{if(r.confirm&&client===this.client&&life===this.pageLife)this.runCommand({action:'cancel',payload:{expectedTurnId:s.turnId,capabilityRevision:s.capabilityRevision}});}});},
 async runCommand(body){
  if(this.data.busy||this.data.unknown||!this.client||!this.client.valid()||!this.data.isController)return;
  const client=this.client,life=this.pageLife;this.setData({busy:true,commandError:'',receipt:'提交中'});
  try{const id=await runtime().gateway.id('shared');if(client!==this.client||life!==this.pageLife)return;this.operationId=id;this.operationEpoch=runtime().epoch;
   const op=await client.command(body,id);if(client!==this.client||life!==this.pageLife)return;this.applyReceipt(op);
  }catch(e){if(client===this.client&&life===this.pageLife)this.setData({unknown:!!e.uncertain,commandError:errorText(e),receipt:e.uncertain?'结果待确认':'未提交'});}
  finally{if(client===this.client&&life===this.pageLife)this.setData({busy:false});}
 },
 applyReceipt(op){
  if(op.id!==this.operationId)throw Error('回执不匹配');const done=op.state==='confirmed',failed=op.state==='failed';
  this.setData({unknown:!done&&!failed,receipt:TERMINAL[op.state],commandError:failed?errorText(op.error):''});
  if(done){if(this.pendingText===this.data.draft)this.setData({draft:''});this.pendingText=null;this.setData({request:null,answers:{}});}
 },
 async reconcileShared(){
  if(!this.operationId||!this.client||!this.client.valid()||this.receiptBusy)return;const client=this.client,life=this.pageLife;this.receiptBusy=true;
  try{const op=await client.receipt(this.operationId);if(client===this.client&&life===this.pageLife)this.applyReceipt(op);}
  catch(e){if(client===this.client&&life===this.pageLife)this.setData({unknown:true,commandError:errorText(e, 'OPERATION_UNKNOWN')});}
  finally{this.receiptBusy=false;}
 },
 loadMore(){this.setData({limit:this.data.limit+60,following:false,items:(this.allItems||[]).slice(-(this.data.limit+60)),hasMore:(this.allItems||[]).length>this.data.limit+60});},
 dragStart(e){this.dragTop=e.detail.scrollTop;},
 dragging(e){if(Number.isFinite(this.dragTop)&&e.detail.scrollTop<this.dragTop-3)this.pauseFollow();},
 dragEnd(){this.dragTop=undefined;},
 pauseFollow(){this.setData({following:false,scrollTarget:'',scrollAnimated:false});},latest(event){this.setData({following:true,scrollTarget:'',scrollAnimated:!!event&&this.data.motionMode==='full'},()=>this.setData({scrollTarget:'shared-latest'}));},
 keyboard(e){this.setData({keyboardHeight:Math.max(0,e.detail.height||0)});},
 async openEvent(e){const item=e.detail.item;if(item.requestId)return this.showRequest(item.requestId);if(item.type==='diff'&&item.files&&item.files.length){this.setData({diffFiles:item.files,detail:'diff'});return this.loadDiff(item.files[0].id);}},
 openPending(e){return this.showRequest(e.currentTarget.dataset.id);},
 chooseDiff(e){return this.loadDiff(e.currentTarget.dataset.id);},
 async loadDiff(id){const client=this.client,life=this.pageLife;if(!client||!client.valid())return;const generation=this.diffGeneration=(this.diffGeneration||0)+1;this.setData({diff:null,detailLoading:true,detailError:''});try{const diff=await client.file(id);if(client===this.client&&life===this.pageLife&&generation===this.diffGeneration)this.setData({diff});}catch(e){if(client===this.client&&life===this.pageLife&&generation===this.diffGeneration)this.detailFailure(e);}finally{if(client===this.client&&life===this.pageLife&&generation===this.diffGeneration)this.setData({detailLoading:false});}},
 async showRequest(id){const client=this.client,life=this.pageLife;if(!client||!client.valid())return;this.setData({detail:'request',request:null,answers:{},detailLoading:true,detailError:''});this.answerValues=Object.create(null);const generation=this.requestGeneration=(this.requestGeneration||0)+1;try{const request=await client.interaction(id);if(client===this.client&&life===this.pageLife&&generation===this.requestGeneration)this.setData({request});}catch(e){if(client===this.client&&life===this.pageLife&&generation===this.requestGeneration)this.detailFailure(e);}finally{if(client===this.client&&life===this.pageLife&&generation===this.requestGeneration)this.setData({detailLoading:false});}},
 detailFailure(e){if(['SHARE_UNAVAILABLE','UNAUTHENTICATED','AUTH_CHANGED','CONTENT_CLEARED','NETWORK_ERROR'].includes(e.code)){if(this.client)this.client.lock(errorText(e));}else this.setData({detailError:errorText(e)});},
 closeDetail(){this.diffGeneration=(this.diffGeneration||0)+1;this.requestGeneration=(this.requestGeneration||0)+1;this.answerValues=Object.create(null);this.setData({detail:'',diff:null,request:null,diffFiles:[],answers:{},detailError:''});},
 answer(e){if(!this.answerValues)this.answerValues=Object.create(null);this.answerValues[e.currentTarget.dataset.id]=e.detail.value;this.setData({answers:Object.assign({},this.answerValues)});},
 approve(e){return this.reply({kind:'approval',choiceId:e.currentTarget.dataset.id});},submitAnswer(){return this.reply({kind:'question',answers:this.data.answers});},
 reply(decision){const r=this.data.request,s=this.data.session;if(!r||!s||r.state!=='pending'||r.turnId!==s.turnId||!this.data.isController)return;return this.runCommand({action:'respond',requestId:r.id,payload:{expectedTurnId:s.turnId,requestRevision:r.revision,capabilityRevision:s.capabilityRevision,decision}});},
 noop(){},onShareAppMessage(){return {title:'喵连',path:'/pages/login/index',imageUrl:'/assets/share-card.png'};}
});
