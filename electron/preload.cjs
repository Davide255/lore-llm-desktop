// Exposes a narrow, promise-based KB API to the renderer as `window.lore`.
const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('lore', {
  tree: call('kb:tree'),
  read: call('kb:read'),
  write: call('kb:write'),
  create: call('kb:create'),
  mkdir: call('kb:mkdir'),
  rename: call('kb:rename'),
  duplicate: call('kb:duplicate'),
  remove: call('kb:delete'),
  undoDelete: call('kb:undoDelete'),
  search: call('kb:search'),
  activity: call('kb:activity'),
  markActivitySeen: call('kb:markActivitySeen'),
  lastSeenActivity: call('kb:lastSeenActivity'),
  agents: call('agents:list'),
  createAgent: call('agents:create'),
  updateAgent: call('agents:update'),
  deleteAgent: call('agents:delete'),
  audit: call('audit:list'),
  server: call('app:server'),
  prefs: call('app:prefs'),
  setPrefs: call('app:setPrefs'),
  copy: call('app:copy'),
  platform: call('app:platform'),
  confirmClose: call('app:confirmClose'),
  authUser: call('auth:user'),
  signIn: call('auth:signIn'),
  cancelSignIn: call('auth:cancelSignIn'),
  signOut: call('auth:signOut'),
  onAuthChanged: on('auth:changed'),
  onChanged: on('kb:changed'),
  onActivity: on('kb:activity'),
  onCloseRequested: on('app:close-requested'),
});
