const { errorText } = require('../../utils/error-display');
const { definePage, runtime, toast } = require('../../utils/page');

// Consent belongs to an account/content generation; UI callbacks additionally
// belong to the visible page that requested them. No callback changes accounts.
function scope(page, rt) {
  const epoch = rt.epoch, content = rt.contentEpoch, life = page.pageLife;
  return () => runtime() === rt && rt.auth && epoch === rt.epoch && content === rt.contentEpoch &&
    life === page.pageLife && page.data.pageActive !== false;
}
function pendingIsCurrent(pending, rt) {
  return pending && pending.runtime === rt && pending.epoch === rt.epoch && pending.contentEpoch === rt.contentEpoch && rt.auth;
}
definePage({
  data: { section: '', subscription: { enabled: false, templates: [], notice: '' }, subscriptionAccepted: {}, subscriptionBusy: false, subscriptionPending: false },
  onLoad(q) { this.setData({ section: q.section || '' }); },
  async onShow() {
    const rt = runtime();
    if (!rt.live) return;
    const current = scope(this, rt), generation = this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
    try {
      const subscription = await rt.gateway.subscriptionConfig();
      if (current() && generation === this.subscriptionGeneration) this.setData({ subscription });
    } catch (error) {
      if (current() && generation === this.subscriptionGeneration) this.setData({ subscription: { enabled: false, templates: [], notice: errorText(error) } });
    }
  },
  onHide() {
    this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
    this.consentGeneration = (this.consentGeneration || 0) + 1;
    this.setData({ subscriptionBusy: false, subscriptionPending: !!this.pendingConsent });
  },
  onUnload() { this.pendingConsent = null; },
  async changeSubscription(e) {
    if(this.data.subscriptionBusy||this.data.subscriptionPending||!this.data.subscription.enabled||this.data.pageActive===false)return;
    const id=e.currentTarget.dataset.id;
    if(!this.data.subscription.templates.some(t=>t.id===id))return;
    if(e.detail.value){this.subscribeMessages(e);return;}
    const rt=runtime(),current=scope(this,rt);if(!rt.auth||!rt.live)return;
    this.setData({subscriptionBusy:true,subscriptionError:''});
    try{
      const operation=await rt.gateway.id('consent');if(!current())return;
      this.pendingConsent={id:operation,choices:[{templateId:id,decision:'reject'}],runtime:rt,epoch:rt.epoch,contentEpoch:rt.contentEpoch};
      this.setData({subscriptionBusy:false,subscriptionPending:true});await this.submitConsent();
    }catch(error){if(current())this.setData({subscriptionError:errorText(error,'SUBSCRIPTION_FAILED')});}
    finally{if(current())this.setData({subscriptionBusy:false,subscriptionAccepted:{...this.data.subscriptionAccepted}});}
  },
  subscribeMessages(e) {
    if (this.data.subscriptionBusy || this.data.subscriptionPending || !this.data.subscription.enabled || this.data.pageActive === false) return;
    const rt = runtime(), current = scope(this, rt), selected = e?.currentTarget?.dataset?.id;
    const available = this.data.subscription.templates;
    const templates = selected ? available.filter(t => t.id === selected) : available.slice(0, 3);
    if (!templates.length) return;
    if (!rt.auth || !rt.live) return;
    if (typeof wx.requestSubscribeMessage !== 'function') { toast(errorText('CLIENT_UNSUPPORTED')); return; }
    const generation = this.consentGeneration = (this.consentGeneration || 0) + 1;
    const valid = () => current() && generation === this.consentGeneration;
    this.setData({ subscriptionBusy: true, subscriptionError: '' });
    // Keep this call directly in the tap gesture, before any asynchronous work.
    wx.requestSubscribeMessage({ tmplIds: templates.map(t => t.id), success: async result => {
      try {
        if (!valid()) return;
        const choices = templates.filter(t => ['accept', 'reject', 'ban', 'filter'].includes(result[t.id])).map(t => ({ templateId: t.id, decision: result[t.id] }));
        if (!choices.length) throw Error('\u672a\u6536\u5230\u6388\u6743\u7ed3\u679c');
        const id = await rt.gateway.id('consent');
        if (!valid()) return;
        this.pendingConsent = { id, choices, runtime: rt, epoch: rt.epoch, contentEpoch: rt.contentEpoch };
        this.setData({ subscriptionBusy: false, subscriptionPending: true });
        await this.submitConsent();
      } catch (error) { if (valid()) this.setData({ subscriptionError: errorText(error, 'SUBSCRIPTION_FAILED') }); }
      finally { if (valid()) this.setData({ subscriptionBusy: false, subscriptionAccepted: {...this.data.subscriptionAccepted} }); }
    }, fail: error => { if (valid()) this.setData({ subscriptionError: errorText(error, 'SUBSCRIPTION_FAILED'), subscriptionBusy: false, subscriptionAccepted: {...this.data.subscriptionAccepted} }); } });
  },
  async submitConsent() {
    const pending = this.pendingConsent, rt = runtime();
    if (!pending) return;
    if (!pendingIsCurrent(pending, rt)) {
      this.pendingConsent = null; this.setData({ subscriptionPending: false, subscriptionBusy: false }); return;
    }
    if (this.data.subscriptionBusy || this.data.pageActive === false) return;
    const current = scope(this, rt), generation = this.consentGeneration = (this.consentGeneration || 0) + 1;
    const valid = () => current() && generation === this.consentGeneration && pending === this.pendingConsent;
    this.setData({ subscriptionBusy: true, subscriptionError: '' });
    try {
      // Retrying uses the same operation ID; it never creates another consent.
      const result = await rt.command('subscribeConsent', [pending.choices], pending.id);
      if (!valid()) return;
      if (result && result.unknown) {
        this.setData({ subscriptionError: errorText('OPERATION_UNKNOWN'), subscriptionPending: true });
      } else {
        this.pendingConsent = null;
        const accepted={...this.data.subscriptionAccepted};
        pending.choices.forEach(choice=>{accepted[choice.templateId]=choice.decision==='accept';});
        this.setData({ subscriptionPending: false, subscriptionAccepted:accepted });
        toast('\u6388\u6743\u7ed3\u679c\u5df2\u8bb0\u5f55');
      }
    } catch (error) { if (valid()) this.setData({ subscriptionError: errorText(error, 'SUBSCRIPTION_FAILED'), subscriptionPending: true }); }
    finally { if (current() && generation === this.consentGeneration) this.setData({ subscriptionBusy: false }); }
  },
  refresh() {
    const rt = runtime();
    if (this.subscriptionEpoch !== rt.epoch || this.subscriptionContent !== rt.contentEpoch) {
      this.subscriptionEpoch = rt.epoch; this.subscriptionContent = rt.contentEpoch;
      this.subscriptionGeneration = (this.subscriptionGeneration || 0) + 1;
      this.consentGeneration = (this.consentGeneration || 0) + 1;
      this.setData({ subscription: { enabled: false, templates: [], notice: '' }, subscriptionAccepted:{}, subscriptionError: '', subscriptionBusy: false });
    }
    if (this.pendingConsent && !pendingIsCurrent(this.pendingConsent, rt)) {
      this.pendingConsent = null; this.setData({ subscriptionPending: false, subscriptionBusy: false });
    }
    this.setData({ preferences: rt.preferences, demo: !rt.live, version: require('../../config').version });
  },
  preference(e) {
    runtime().preferences[e.currentTarget.dataset.key] = e.detail.value;
    wx.setStorageSync('weagent:preferences', runtime().preferences);
    runtime().changed(); this.refresh();
  },
  clear() {
    const rt = runtime(), current = scope(this, rt), epoch = rt.epoch, life = this.pageLife;
    wx.showModal({ title: '\u6e05\u9664\u672c\u5730\u8349\u7a3f\u4e0e\u6b63\u6587\uff1f',
      content: '\u6e05\u9664\u8349\u7a3f\u3001\u8bb0\u5f55\u7f13\u5b58\u4e0e\u540c\u6b65\u6e38\u6807\u3002\u4e0d\u5220\u9664\u8fdc\u7aef\u6587\u4ef6\uff0c\u4e0d\u505c\u6b62\u4efb\u52a1\u3002',
      success: async r => {
        if (!r.confirm || !current()) return;
        try {
          const result = await rt.clearLocalContent();
          if (runtime() === rt && rt.auth && epoch === rt.epoch && life === this.pageLife) toast(result.reconnected ? '\u672c\u5730\u5185\u5bb9\u5df2\u6e05\u9664' : '\u5df2\u6e05\u9664\uff0c\u8bf7\u91cd\u8fde\u7f51\u5173');
        } catch (error) { if (runtime() === rt && epoch === rt.epoch && life === this.pageLife) this.setData({ error: errorText(error) }); }
      }
    });
  }
});
