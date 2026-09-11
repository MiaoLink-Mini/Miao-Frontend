const { errorText } = require('../../utils/error-display');
const { definePage, runtime } = require('../../utils/page');
const images = require('../../utils/profile-image');
definePage({
  data: { loading: true, saving: false, avatarBusy: false, displayName: '', avatarPath: images.DEFAULT_AVATAR, revision: 0, error: '' },
  async onShow() { this.disposed = false; if (!this.loaded) await this.loadProfile(); },
  onHide() { if(this.data.saving){this.loaded=false;this.setData({saving:false});} },
  onUnload() { this.disposed = true; },
  async loadProfile() {
    const rt = runtime(), epoch = rt.epoch, life = this.pageLife;
    const current = () => runtime() === rt && rt.auth && epoch === rt.epoch && life === this.pageLife;
    this.setData({ loading: true, error: '' });
    try {
      if (!rt.live) throw new Error('请使用微信登录后设置个人资料');
      const profile = await rt.gateway.getProfile();
      if (!current()) return;
      const avatarPath = await images.avatarFile(wx, rt.gateway.user.id, profile);
      if (!current()) return;
      this.loaded = true; this.avatarChange = undefined;
      this.setData({ displayName: profile.displayName, avatarPath, revision: profile.revision });
    } catch (error) { if (current()) this.setData({ error: errorText(error) }); }
    finally { if (current()) this.setData({ loading: false }); }
  },
  async chooseAvatar(event) {
    if (this.data.saving || this.data.avatarBusy || !this.loaded) return;
    const path = event.detail.avatarUrl; if (!path) return;
    const rt = runtime(), epoch = rt.epoch;
    const current = () => !this.disposed && runtime() === rt && rt.auth && epoch === rt.epoch;
    this.setData({ avatarBusy: true, error: '' });
    try {
      const image = await images.selectedAvatar(wx, path);
      if (!current()) return;
      this.avatarChange = image.base64;
      this.setData({ avatarPath: image.path });
    } catch (error) { if (current()) this.setData({ error: errorText(error) }); }
    finally { if (current()) this.setData({ avatarBusy: false }); }
  },
  resetAvatar() {
    if (this.data.saving || this.data.avatarBusy || !this.loaded) return;
    this.avatarChange = null; this.setData({ avatarPath: images.DEFAULT_AVATAR });
  },
  async save(event) {
    if (this.data.loading || this.data.saving || this.data.avatarBusy || !this.loaded) return;
    // Collect through form submit after WeChat's nickname safety check; do not use a stale input draft.
    const displayName = String(event.detail.value.nickname || '').trim();
    if (!displayName || Array.from(displayName).length > 32 || /[\u0000-\u001f\u007f]/.test(displayName)) {
      this.setData({ error: errorText('PROFILE_NAME_INVALID') }); return;
    }
    const rt = runtime(), epoch = rt.epoch, life = this.pageLife;
    const current = () => runtime() === rt && rt.auth && epoch === rt.epoch && life === this.pageLife;
    const body = { displayName, revision: this.data.revision };
    if (this.avatarChange !== undefined) body.avatarBase64 = this.avatarChange;
    this.setData({ saving: true, error: '' });
    try {
      const profile = await rt.gateway.saveProfile(body);
      if (!current()) return;
      this.avatarChange = undefined;
      this.setData({ revision: profile.revision, displayName: profile.displayName });
      rt.changed();
      wx.showToast({ title: '资料已保存', icon: 'success' });
      wx.navigateBack();
    } catch (error) { if (current()) this.setData({ error: errorText(error) }); }
    finally { if (current()) this.setData({ saving: false }); }
  }
});
