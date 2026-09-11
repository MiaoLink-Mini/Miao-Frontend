const ACTIVE = ['running', 'waiting_approval', 'waiting_input', 'cancelling'];
const STATE_NAMES = { idle: '等待启动', running: '执行中', waiting_approval: '等待审批', waiting_input: '等待回答', completed: '本轮完成', cancelled: '已取消', failed: '执行失败', cancelling: '正在取消', closed: '进程已关闭' };
function capability(agent, key) { return !!(agent && agent.capabilities && agent.capabilities[key] === true); }
function controlReason(session, node, connection, cap) {
  if (!session || !node || node.revoked) return '资源已失效，请返回列表';
  if (connection !== 'online') return '连接尚未恢复，暂不可操作';
  if (!node.online) return '设备离线，暂不可操作';
  if (session.mode === 'readonly') return '当前会话仅供查看';
  if (session.state === 'closed') return '进程已关闭，请查看历史恢复能力';
  if (session.historyState === 'purged') return '会话历史已清理，请创建新会话';
  if (session.state === 'idle' || session.turnId === null) return '会话尚未启动，请稍候';
  if (cap === false) return '当前能力尚未开放';
  return '';
}
function requestReason(request, session, node, connection, now = Date.now()) {
  const reason = controlReason(session, node, connection);
  if (reason) return reason;
  if (!request) return '请求不存在';
  if (request.state !== 'pending') return request.state === 'resolved' ? '该请求已处理' : '请求正在回传或已经结束';
  if (request.expiresAt <= now) return '请求已过期';
  if (request.turnId !== session.turnId) return '原轮次已结束，请刷新';
  return '';
}
module.exports = { ACTIVE, STATE_NAMES, capability, controlReason, requestReason };
