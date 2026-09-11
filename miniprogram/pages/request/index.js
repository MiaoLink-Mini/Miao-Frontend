const {
  definePage,runtime
}
=require('../../utils/page');
const {
  requestReason,capability
}
=require('../../utils/policy');
definePage({
  resource: "requests",
  data:{
    id:'',answers:{
    }
    ,busy:false,keyboardHeight:0,scrollTarget:''
  }
  ,onLoad(q){
    this.setData({
      id:q.id||''
    }
    );
  }
  ,onShow(){
    this.timer=setInterval(()=>this.refresh(),1000);
  }
  ,onHide(){
    clearInterval(this.timer);
  }
  ,onUnload(){
    clearInterval(this.timer);
  }
  ,refresh(){
    const v=runtime().view(),request=v.requests.find(r=>r.id===this.data.id);
    const session=request&&request.session;
    const reason=request?(requestReason(request,session,session&&session.node,v.connection,runtime().now())||(!capability(session&&(session.capabilities ? session : session.agent),request.kind)?'当前请求能力尚未开放':'')):'请求不存在或你没有访问权限';
    const answerLabel=request&&request.state==='resolved'?(request.kind==='approval'?(request.choices.find(c=>c.id===request.answer)||{
    }
    ).label:JSON.stringify(request.answer)) : '';
    this.setData({demo:!runtime().live,
      request:request||null,session:session||null,reason,answerLabel,connection:v.connection,connectionLabel:v.connectionLabel,preferences:v.preferences,expires:request?Math.max(0,Math.ceil((request.expiresAt-runtime().now())/60000)):0
    }
    );
  }
  ,answer(e){
    this.setData({
      ['answers.'+e.currentTarget.dataset.id]:e.detail.value
    }
    );
  }
  ,approve(e){
    if(this.data.reason)return;
    const choice=this.data.request.choices.find(c=>c.id===e.currentTarget.dataset.choice);
    if(choice)this.action('respond',[this.data.id,choice.id]);
  }
  ,submit(){
    if(this.data.reason)return;
    this.action('respond',[this.data.id,this.data.answers]);
  }
  ,openSession(){
    const session=this.data.session;
    if(session)require('../../utils/navigation').returnToSession(session.id);
  }
  ,context(){
    this.refresh();
    const r=this.data.request,s=this.data.session;
    if(!r||!s)return;
    wx.showModal({title:'完整请求上下文',showCancel:false,confirmText:'知道了',content:[
      '设备：'+s.node.name,'项目：'+s.project.name,'Agent：'+s.agent.name,'会话：'+s.title,
      r.action?'操作：'+r.action:'',r.scope?'授权范围：'+r.scope:'',
      '请求：'+r.title,r.summary
    ].filter(Boolean).join('\n')});
  }
  ,focusAnswer(e){
    this.focusedField='question-'+e.currentTarget.dataset.id;
    if(this.data.keyboardHeight)this.setData({scrollTarget:this.focusedField});
  }
  ,keyboard(e){
    const keyboardHeight=Math.max(0,e.detail.height||0);
    this.setData({keyboardHeight,scrollTarget:keyboardHeight?(this.focusedField||''):''});
  }
}
);
