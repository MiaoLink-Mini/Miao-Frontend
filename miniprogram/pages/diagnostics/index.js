const { errorText } = require('../../utils/error-display');
const {
  definePage,runtime,toast
}
=require('../../utils/page');
definePage({
  data:{
    section:''
  }
  ,onLoad(q){
    this.setData({
      section:q.section||''
    }
    );
  }
  ,refresh(){
    const v=runtime().view();
    this.setData(Object.assign(v,{
      demo:!runtime().live,
      connectionError:runtime().live && runtime().gateway.lastError ? errorText(runtime().gateway.lastError) : '',
      audit:v.audit.map(a=>Object.assign(a,{
        time:new Date(a.createdAt).toLocaleTimeString()
      }
      )),cursors:Object.keys(runtime().timelines).map(id=>({
        id,cursor:runtime().timelines[id].cursor,gap:!!runtime().timelines[id].gap
      }
      ))
    }
    ));
  }
  ,disconnect(){
    if(runtime().live)return;
    runtime().disconnect();
    this.refresh();
  }
  ,async recover(){
    try{
      await runtime().recover();
    }
    catch(e){
      toast(errorText(e, 'NETWORK_ERROR'));
    }
    this.refresh();
  }
  ,toggleNode(e){
    if(runtime().live){toast(errorText('FORBIDDEN'));return;}
    runtime().gateway.setOnline(e.currentTarget.dataset.id,e.detail.value);
    this.refresh();
  }
  ,unknown(){
    if(runtime().live){toast(errorText('FORBIDDEN'));return;}
    const rt=runtime(),s=rt.snapshot().sessions[0];
    if(!s)return;
    rt.gateway.emit(rt.gateway.session(s.id),'future.demo.event',{
      requiresInput:true
    }
    );
    toast('已加入未知事件提示');
  }
  ,empty(){
    if(runtime().live){toast(errorText('FORBIDDEN'));return;}
    wx.showModal({
      title:'体验首次使用空状态？',content:'这会移除本次演示中的设备和会话。重新启动小程序运行环境可恢复演示种子数据。',success:r=>{
        if(r.confirm){
          const rt=runtime();
          rt.gateway.dispose();
          rt.gateway.data={
            nodes:[],projects:[],agents:[],sessions:[],requests:[],notifications:[],audit:[]
          }
          ;
          rt.gateway.history={
          }
          ;
          rt.timelines={
          }
          ;
          rt.drafts={
          }
          ;
          rt.unsubscribe=rt.gateway.subscribe(e=>rt.receive(e));
          rt.changed();
          this.refresh();
        }
      }
    }
    );
  }
}
);
