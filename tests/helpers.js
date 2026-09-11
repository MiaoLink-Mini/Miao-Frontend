const path = require('node:path');
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function mount(file, runtime, component = false) {
  let definition; const calls = [];
  global.getApp = () => ({ runtime });
  global.wx = new Proxy({}, { get: (_, key) => arg => {
    calls.push({ method: key, arg });
    if (key === 'showModal' && arg.success) arg.success({ confirm: true, cancel: false });
  } });
  global[component ? 'Component' : 'Page'] = value => { definition = value; };
  const full = path.resolve(__dirname, '..', 'miniprogram', file);
  delete require.cache[require.resolve(full)]; require(full);
  const instance = Object.assign({}, component ? definition.methods : definition, {
    data: clone(definition.data || {}), calls, definition,
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => {
        const parts = key.split('.'); let target = this.data;
        parts.slice(0, -1).forEach(part => { target[part] = target[part] || {}; target = target[part]; });
        target[parts[parts.length - 1]] = value;
      });
      if (callback) callback();
    }, triggerEvent(name, detail) { calls.push({ method: 'event', name, detail }); }
  });
  return instance;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = { mount, wait };
