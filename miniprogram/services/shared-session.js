const { errorText } = require('../utils/error-display');
const {validate,itemView,projectEvent}=require('./wire');
const {emptyTimeline,mergeEvents}=require('../stores/timeline');
const error=(code,message)=>Object.assign(new Error(message),{code});
const encoded=id=>encodeURIComponent(validate('Id',id));
const query=values=>Object.entries(values).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>encodeURIComponent(k)+'='+encodeURIComponent(v)).join('&');
class SharedSessionClient{
  constructor(runtime,id,changed=()=>{},options={}){
    validate('Id',id);this.rt=runtime;this.id=id;this.changed=changed;this.clock=options.clock||Date.now;
    this.epoch=runtime.epoch;this.contentEpoch=runtime.contentEpoch;this.transportEpoch=runtime.gateway.generation;
    this.alive=true;this.generation=0;this.requests=Object.create(null);this.files=Object.create(null);this.timeline=null;this.meta=null;this.expiresLocal=Infinity;
  }
  valid(){return this.alive&&this.rt.auth&&this.epoch===this.rt.epoch&&this.contentEpoch===this.rt.contentEpoch&&this.transportEpoch===this.rt.gateway.generation&&this.clock()<this.expiresLocal;}
  assert(){if(!this.valid())throw error('SHARE_UNAVAILABLE','分享已失效，请重新打开');}
  async request(path,model,method='GET',body,input,op){
    this.assert();const generation=this.generation;
    try{
      const value=await this.rt.gateway.request('/session-shares/'+encoded(this.id)+path,model,method,body,input,op);
      this.assert();if(generation!==this.generation)throw error('SHARE_UNAVAILABLE','页面已离开');
      if(this.meta)this.renewLease();return value;
    }catch(e){
      if(['SHARE_UNAVAILABLE','UNAUTHENTICATED','AUTH_CHANGED','CONTENT_CLEARED','NETWORK_ERROR','INVALID_PROTOCOL'].includes(e.code)&&this.alive)this.lock(e);
      throw e;
    }
  }
  async metadata(){
    const started=this.clock(),value=await this.request('','SharedSession');
    if(value.share.id!==this.id||value.share.sessionId!==value.session.id||this.meta&&value.session.id!==this.meta.session.id)throw error('INVALID_PROTOCOL','分享会话不匹配');
    // Conservative deadline: subtract the entire observed request time, not half its RTT.
    const remaining=Date.parse(value.share.expiresAt)-Date.parse(value.serverTime);
    this.expiresLocal=started+remaining;this.assert();this.meta=value;
    for(const request of value.requests){if(request.sessionId!==value.session.id)throw error('INVALID_PROTOCOL','请求不属于此会话');this.requests[request.id]=request;}
    this.renewLease();return value;
  }
  renewLease(){
    clearTimeout(this.leaseTimer);
    // Every successful scoped read renews a short lease; expiry is never extended.
    this.leaseTimer=setTimeout(()=>this.lock({code:'OFFLINE'}),Math.max(1,Math.min(12000,this.expiresLocal-this.clock())));
  }
  async baseline(){
    const cp=await this.request('/checkpoint','Checkpoint');
    if(cp.sessionId!==this.meta.session.id)throw error('INVALID_PROTOCOL','历史不属于此会话');
    const state=emptyTimeline(cp.sessionId);let token=null,count=0;const seen=new Set();
    do{
      const page=await this.request('/checkpoints/'+encoded(cp.id)+'/items?'+query({limit:100,pageToken:token}),'CheckpointItemsPage');
      if(page.checkpointId!==cp.id||page.sequence!==cp.sequence)throw error('INVALID_PROTOCOL','历史快照已变化');
      for(const item of page.items){const key=item.turnId+':'+item.itemId;if(seen.has(key))throw error('INVALID_PROTOCOL','历史条目重复');seen.add(key);state.items.push(itemView(item,this.requests[item.requestId]));}
      count+=page.items.length;if(count>10000||count>cp.itemCount)throw error('INVALID_PROTOCOL','历史大小异常');
      if(page.nextPageToken===token&&token!==null)throw error('INVALID_PROTOCOL','历史游标未推进');
      token=page.nextPageToken;
    }while(token);
    if(count!==cp.itemCount)throw error('INVALID_PROTOCOL','历史不完整');state.cursor=cp.sequence;this.timeline=state;
  }
  async events(){
    let more=true,until;
    while(more){
      const page=await this.request('/events?'+query({after:this.timeline.cursor,until,limit:200}),'EventsPage');
      if(page.sessionId!==this.meta.session.id||page.after!==this.timeline.cursor)throw error('INVALID_PROTOCOL','事件游标不匹配');
      if(until!==undefined&&page.highWater!==until)throw error('INVALID_PROTOCOL','事件上界已变化');until=page.highWater;
      const view=[];for(const event of page.events){
        if(event.sessionId!==this.meta.session.id)throw error('INVALID_PROTOCOL','事件越界');
        if(event.type==='request.upsert')this.requests[event.data.id]=event.data;
        if(event.type==='diff.file'){if(event.data.sessionId!==this.meta.session.id)throw error('INVALID_PROTOCOL','文件越界');this.files[event.data.id]=event.data;}
        view.push(projectEvent(event,this.requests[event.data.requestId]));
      }
      this.timeline=mergeEvents(this.timeline,view);
      if(this.timeline.gap||this.timeline.cursor!==page.nextAfter||page.hasMore&&page.nextAfter<=page.after)throw error('INVALID_PROTOCOL','事件不连续');
      more=page.hasMore;
    }
  }
  async poll(){
    if(this.polling||!this.alive)return;this.polling=true;
    try{await this.metadata();if(!this.timeline)await this.baseline();
      try{await this.events();}catch(e){if(e.code!=='CURSOR_EXPIRED')throw e;await this.baseline();await this.events();}
      this.assert();this.changed({meta:this.meta,items:this.timeline.items,requests:this.requests,error:'',unavailable:false});
    }catch(e){if(this.alive)this.lock(e);throw e;}finally{this.polling=false;}
  }
  async start(){
    this.unsubscribe=this.rt.subscribe(()=>{if(!this.valid())this.lock({code:'AUTH_CHANGED'});});
    await this.poll();if(this.alive)this.timer=setInterval(()=>this.poll().catch(()=>{}),3000);
  }
  async file(id){const value=await this.request('/files/'+encoded(id),'DiffFile');if(value.id!==id||value.sessionId!==this.meta.session.id)throw error('INVALID_PROTOCOL','文件不属于此会话');this.files[id]=value;return value;}
  async interaction(id){const value=await this.request('/requests/'+encoded(id),'InteractionRequest');if(value.id!==id||value.sessionId!==this.meta.session.id)throw error('INVALID_PROTOCOL','请求不属于此会话');this.requests[id]=value;return value;}
  async command(body,id){validate('SharedCommand',body);validate('Id',id);await this.metadata();if(this.meta.share.permission!=='control')throw error('READ_ONLY','此分享仅可阅读');return this.request('/commands','Operation','POST',body,'SharedCommand',id);}
  receipt(id){return this.request('/operations/'+encoded(id),'Operation');}
  stop(){this.alive=false;this.generation++;clearInterval(this.timer);clearTimeout(this.leaseTimer);if(this.unsubscribe)this.unsubscribe();this.unsubscribe=null;this.meta=null;this.timeline=null;this.requests=Object.create(null);this.files=Object.create(null);}
  lock(message){this.stop();this.changed({meta:null,items:[],requests:{},unavailable:true,error:errorText(message)});}
}
function shareLabel(share,serverTime){
  const now=Date.parse(serverTime),end=Date.parse(share.expiresAt),state=share.revokedAt?'已撤销':end<=now?'已过期':share.acceptedAt?'已接受':'等待接受';
  const date=new Date(end),pad=n=>String(n).padStart(2,'0');
  return Object.assign({},share,{stateLabel:state,permissionLabel:share.permission==='control'?'可控制':'只读',expiryLabel:(date.getMonth()+1)+'/'+date.getDate()+' '+pad(date.getHours())+':'+pad(date.getMinutes()),active:!share.revokedAt&&end>now});
}
module.exports={SharedSessionClient,shareLabel,query};
