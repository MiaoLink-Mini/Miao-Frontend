const DEFAULT_AVATAR = '/assets/default-avatar.png';
const PREFIX = 'golink-profile-';
function clearAvatars(api) {
  if (!api || !api.env || !api.env.USER_DATA_PATH || typeof api.getFileSystemManager !== 'function') return;
  const fs = api.getFileSystemManager(), dir = api.env.USER_DATA_PATH;
  try { fs.readdirSync(dir).filter(n => /^golink-profile-[A-Za-z0-9_-]+\.jpg$/.test(n)).forEach(n => { try { fs.unlinkSync(dir + '/' + n); } catch (_) {} }); } catch (_) {}
}
async function avatarFile(api, userId, profile) {
  if (!profile.avatarBase64) return DEFAULT_AVATAR;
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || !Number.isSafeInteger(profile.revision)) throw Object.assign(new Error('头像资料无效'), { code: 'AVATAR_INVALID' });
  const dir = api.env.USER_DATA_PATH, fs = api.getFileSystemManager();
  const file = dir + '/' + PREFIX + userId + '-' + profile.revision + '.jpg';
  await new Promise((resolve, reject) => fs.writeFile({ filePath: file, data: profile.avatarBase64, encoding: 'base64', success: resolve, fail: () => reject(Object.assign(new Error('头像缓存失败，请检查存储空间'), { code: 'AVATAR_STORAGE_FAILED' })) }));
  try { fs.readdirSync(dir).filter(n => n.startsWith(PREFIX + userId + '-') && /^[A-Za-z0-9_-]+\.jpg$/.test(n) && dir + '/' + n !== file).forEach(n => { try { fs.unlinkSync(dir + '/' + n); } catch (_) {} }); } catch (_) {}
  return file;
}
async function selectedAvatar(api, path) {
  const compressed = await new Promise((resolve, reject) => api.compressImage({ src: path, quality: 60, compressedWidth: 256, compressedHeight: 256, success: resolve, fail: () => reject(Object.assign(new Error('头像处理失败，请重新选择图片'), { code: 'AVATAR_PROCESS_FAILED' })) }));
  const result = await new Promise((resolve, reject) => api.getFileSystemManager().readFile({ filePath: compressed.tempFilePath, encoding: 'base64', success: resolve, fail: () => reject(Object.assign(new Error('无法读取头像，请重新选择'), { code: 'AVATAR_PROCESS_FAILED' })) }));
  if (typeof result.data !== 'string' || !result.data.length || result.data.length > 49152) throw Object.assign(new Error('头像过大，请选择更小的图片'), { code: 'PAYLOAD_TOO_LARGE' });
  return { base64: result.data, path: compressed.tempFilePath };
}
module.exports = { DEFAULT_AVATAR, avatarFile, selectedAvatar, clearAvatars };
