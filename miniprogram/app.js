const { Runtime } = require('./services/runtime');
App({
  onLaunch() {
    this.appearance = require('./utils/appearance').read(wx);
    this.runtime = new Runtime();
    const preferences = wx.getStorageSync('weagent:preferences');
    if (preferences && typeof preferences === 'object') this.runtime.preferences = { largeText: preferences.largeText === true, completedNotices: true };
  },
  onShow() { if (this.runtime) this.runtime.foreground().catch(() => { this.runtime.connection = 'error'; this.runtime.changed(); }); },
  onHide() { if (this.runtime) this.runtime.background(); }
});
