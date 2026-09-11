const navigation = require('./navigation');
// A project or Agent is not itself a session. Resolve the precise authorized
// session before opening session-scoped tools; never use an arbitrary latest ID.
function methods(scopeFor, allowed) {
  return {
    tools(e) {
      const kind=e.currentTarget.dataset.kind, rt=getApp().runtime;
      if (!allowed.includes(kind)) return;
      if (!rt.live) {this.setData({toolMessage:'请连接设备后使用此工具'}); return;}
      const scope=scopeFor.call(this);
      if (!scope) return;
      const sessions=navigation.contextSessions(rt.view(),scope).filter(s=>s.mode!=='readonly');
      if (!sessions.length) {this.setData({toolMessage:'先在此环境创建会话，再打开工具'}); return;}
      this.toolScope=scope;this.toolEpoch=rt.epoch;
      this.setData({toolKind:kind,toolSessions:sessions,toolMessage:''});
      if (sessions.length===1) return this.chooseToolSession({detail:{id:sessions[0].id}});
      this.setData({toolPicker:true});
    },
    closeToolPicker(){this.setData({toolPicker:false});},
    chooseToolSession(e){
      const rt=getApp().runtime, id=e.detail.id;
      if (!rt.auth || rt.epoch!==this.toolEpoch || !this.toolScope) {this.closeToolPicker();return;}
      const s=navigation.contextSessions(rt.view(),this.toolScope).find(s=>s.id===id&&s.mode!=='readonly');
      if (!s) {this.closeToolPicker();this.setData({toolMessage:'会话已不可访问，请重新选择'});return;}
      const url=navigation.sessionUrl(this.data.toolKind,s.id,rt.live);
      this.closeToolPicker();if(url)this.open(url);
    }
  };
}
module.exports={methods};
