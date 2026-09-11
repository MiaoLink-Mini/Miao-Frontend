const { errorText } = require('./error-display');
const appearance = require('./appearance');
const navigation = require('./navigation');
const runtime = () => getApp().runtime;
function open(event) {
  const url = typeof event === 'string' ? event : event.currentTarget.dataset.url;
  if (url) wx.navigateTo({ url });
}
function tab(event) { wx.switchTab({ url: event.currentTarget.dataset.url }); }
function toast(title) { wx.showToast({ title, icon: 'none' }); }
function receipts() { return {submitting:'提交中',accepted:'已受理',delivered:'等待主机确认',confirmed:'已确认',unknown:'结果未知，请查询',failed:'操作失败'}; }

function definePage(spec) {
  const page = Object.assign({ data: {}, open, tab, noop() {}, returnToSession() { navigation.returnToSession(this.data.sessionId || this.data.id); }, retry() { this.refresh(); } }, spec);
  // Supply the saved palette in the first render, not only after onShow/setData.
  page.data=Object.assign({themeSheet:false,pageActive:true,connection:'offline',connectionLabel:'未连接'},page.data,appearance.view((getApp()||{}).appearance));
  page.appearanceView=function(){
    const app=getApp();const value=appearance.view(app.appearance||appearance.read(wx));
    const signature=value.themeId+':'+value.motionMode;
    if(typeof this.getTabBar==='function'){
      const bar=this.getTabBar(),paths=['pages/home/index','pages/sessions/index','pages/inbox/index','pages/me/index'];
      if(bar)bar.setData(Object.assign({},value,{selected:Math.max(0,paths.indexOf(this.route)),pendingCount:runtime().view().pendingCount,hidden:!!this.data.themeSheet}));
    }
    if(this.appearanceSignature===signature){
      if(!this.data.pageActive)this.setData({pageActive:true});
      return;
    }
    this.appearanceSignature=signature;
    this.setData(Object.assign({pageActive:true},value));
    const t=appearance.palette(value.themeId);
    if(typeof wx.setNavigationBarColor==='function')wx.setNavigationBarColor({frontColor:t.nav==='black'?'#000000':'#ffffff',backgroundColor:t.canvas,animation:{duration:0}});
    if(typeof wx.setBackgroundColor==='function')wx.setBackgroundColor({backgroundColor:t.canvas,backgroundColorTop:t.canvas,backgroundColorBottom:t.canvas});
  };
  function themesTabBar(page,visible){if(typeof page.getTabBar!=='function')return;const bar=page.getTabBar();if(bar)bar.setData({hidden:!visible});}
  page.showThemes=function(){themesTabBar(this,false);this.setData({themeSheet:true});};
  page.closeThemes=function(){this.setData({themeSheet:false});themesTabBar(this,true);};
  page.themeChange=function(e){appearance.set(getApp(),wx,{theme:e.detail.id});this.appearanceView();};
  page.motionChange=function(e){appearance.set(getApp(),wx,{motion:e.detail.id});this.appearanceView();};
  // An accepted operation belongs to Runtime, but a UI continuation belongs to
  // one visible page/account/content generation. Never navigate a hidden page.
  page.operationScopeChanged = function () {
    const context = this.operationContext, rt = runtime();
    if (!context || context.runtime === rt && context.epoch === rt.epoch && context.contentEpoch === rt.contentEpoch && rt.auth) return;
    this.actionRevision = (this.actionRevision || 0) + 1;
    this.operationContext = null; this.operationId = null; this.pendingAfter = null;
    this.setData({ busy: false, unknown: false, receipt: '', error: '' });
  };
  page.suspendAction = function (unloaded) {
    this.actionRevision = (this.actionRevision || 0) + 1;
    if (this.data.busy) this.setData({ busy: false, unknown: !!this.operationId,
      receipt: this.operationId ? receipts().unknown : '' });
    if (unloaded) this.pendingAfter = null;
  };
  const show = spec.onShow, hide = spec.onHide, unload = spec.onUnload;
  page.onShow = function () {
    this.operationScopeChanged();
    this.appearanceView();
    const life = this.pageLife = (this.pageLife || 0) + 1, rt = runtime(), epoch = rt.epoch, contentEpoch = rt.contentEpoch;
    const current = () => runtime() === rt && life === this.pageLife && epoch === rt.epoch && contentEpoch === rt.contentEpoch && this.data.pageActive !== false && (spec.public || rt.auth);
    if (!runtime().auth && !spec.public) { wx.reLaunch({ url: '/pages/login/index' }); return; }
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = runtime().subscribe(() => {
      if (runtime() !== rt || epoch !== rt.epoch || contentEpoch !== rt.contentEpoch) this.setData({ loading: false });
      this.operationScopeChanged();
      this.appearanceView();
      if (!runtime().auth && !spec.public) { wx.reLaunch({ url: '/pages/login/index' }); return; }
      const labels = receipts(runtime().live);
      if (this.operationId && this.data.busy) this.setData({ receipt: labels[runtime().operations[this.operationId]] || '正在提交' });
      if (this.refresh) this.refresh();
    });
    if (this.refresh) this.refresh();
    const ready = async () => {
      if (spec.resource && this.data.id && rt.live) {
        this.setData({ loading: true }); await rt.ensure(spec.resource, this.data.id, true);
      }
      if (!current()) return;
      if (show) await show.call(this);
      if (!current()) return;
      if (this.refresh) this.refresh();
    };
    return ready().catch(error => { if(current())this.setData({ error: errorText(error) }); }).finally(() => { if(current())this.setData({ loading: false }); });
  };
  page.onHide = function () { this.suspendAction(false); this.setData({pageActive:false,themeSheet:false}); themesTabBar(this,true); this.pageLife = (this.pageLife || 0) + 1; if (this.unsubscribe) this.unsubscribe(); this.unsubscribe = null; if (hide) hide.call(this); };
  page.onUnload = function () { this.suspendAction(true); this.setData({pageActive:false,themeSheet:false}); themesTabBar(this,true); this.pageLife = (this.pageLife || 0) + 1; if (this.unsubscribe) this.unsubscribe(); this.unsubscribe = null; if (unload) unload.call(this); };
  function beginAction(page) {
    const rt = runtime(), epoch = rt.epoch, contentEpoch = rt.contentEpoch, life = page.pageLife;
    const revision = page.actionRevision = (page.actionRevision || 0) + 1;
    page.operationContext = { runtime: rt, epoch, contentEpoch };
    return () => runtime() === rt && rt.auth && epoch === rt.epoch && contentEpoch === rt.contentEpoch &&
      life === page.pageLife && revision === page.actionRevision && page.data.pageActive !== false;
  }
  page.action = async function (method, args, after) {
    this.operationScopeChanged();
    if (this.data.busy || this.data.unknown || this.data.pageActive === false) return;
    const rt = runtime(), labels = receipts(rt.live), current = beginAction(this);
    this.operationId = null; this.pendingAfter = null;
    this.setData({ busy: true, error: '', receipt: labels.submitting, unknown: false });
    try {
      const id = await rt.gateway.id('operation');
      if (!current()) return; // Leaving before ID allocation must not issue a command.
      this.operationId = id; this.pendingAfter = after;
      const result = await rt.command(method, args, id);
      if (!current()) return;
      if (result && result.unknown) { this.setData({ unknown: true, receipt: labels.unknown }); return; }
      this.setData({ receipt: labels.confirmed }); this.pendingAfter = null;
      if (after) after(result);
    } catch (error) {
      if (current()) this.setData({ error: errorText(error), unknown: !!error.uncertain, receipt: error.uncertain ? labels.unknown : labels.failed });
    } finally {
      if (current()) { this.setData({ busy: false }); if (this.refresh) this.refresh(); }
    }
  };
  page.reconcile = async function () {
    this.operationScopeChanged();
    if (runtime().connection !== 'online') { toast(errorText('OFFLINE')); return; }
    if (!this.operationId) { this.setData({ error: errorText('NOT_FOUND') }); return; }
    if (this.data.busy || this.data.pageActive === false) return;
    const rt = runtime(), labels = receipts(rt.live), current = beginAction(this), id = this.operationId;
    this.setData({ busy: true });
    try {
      const op = await rt.gateway.operation(id);
      if (!current()) return;
      if (!op) { this.setData({ unknown: true, error: errorText('OPERATION_UNKNOWN') }); return; }
      rt.operations[id] = op.state;
      if (op.state === 'confirmed') {
        const result = rt.live ? await rt.gateway.operationResult(op) : op.result;
        if (!current()) return;
        this.setData({ unknown: false, error: '', receipt: labels.confirmed });
        if (this.pendingAfter) { const fn = this.pendingAfter; this.pendingAfter = null; fn(result); }
      } else if (op.state === 'failed') {
        this.pendingAfter = null;
        this.setData({ unknown: false, error: errorText(op.error), receipt: labels.failed });
      } else this.setData({ unknown: true, receipt: '\u8bf7\u6c42\u4ecd\u5728\u5904\u7406\uff0c\u8bf7\u7a0d\u540e\u67e5\u8be2' });
    } catch (error) {
      if (current()) this.setData({ unknown: true, error: errorText(error), receipt: labels.unknown });
    } finally {
      if (current()) { this.setData({ busy: false }); if (this.refresh) this.refresh(); }
    }
  };
  Page(page);
}
module.exports = { definePage, runtime, open, tab, toast };
