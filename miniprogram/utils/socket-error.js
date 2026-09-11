// Keep a bounded, redacted native explanation so real-device failures remain diagnosable.
function nativeDetail(event = {}) {
  return String(event.errMsg || event.message || event.reason || '').slice(0, 4096)
    .replace(/(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[URL]')
    .replace(/(?:Bearer\s+|(?:authorization|cookie|token|secret|js_code|session_key|openid)\s*[=:]\s*)[^\r\n,;}]+/gi, '[REDACTED]')
    .replace(/[A-Za-z0-9_+/=-]{28,}/g, '[REDACTED]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 600);
}
function socketError(event = {}, opened = false) {
  const detail = String(event.errMsg || event.message || event.reason || '').slice(0, 2048);
  let code = 'NETWORK_ERROR', message;
  if (/not in domain list|url not in domain|不在(?:合法)?域名|domain.*not.*(?:allowed|configured)/i.test(detail)) {
    code = 'SOCKET_DOMAIN_ERROR';
    message = '实时连接域名未获微信允许，请在当前小程序后台配置 socket 合法域名';
  } else if (/timed?\s*out|timeout|超时/i.test(detail)) {
    code = 'SOCKET_TIMEOUT';
    message = '实时连接超时，请检查手机网络或服务器接入线路';
  } else if (/certificate|\bssl\b|\btls\b|证书/i.test(detail)) {
    code = 'SOCKET_TLS_ERROR'; message = '实时连接证书校验失败，请检查手机时间和服务器证书';
  } else if (/resolve host|name.*resolved|\bdns\b/i.test(detail)) {
    code = 'SOCKET_DNS_ERROR'; message = '无法解析实时连接域名，请检查手机网络或切换网络重试';
  } else if (/\b401\b/.test(detail)) {
    message = '实时连接认证被拒绝，请重新登录';
  } else if (/\b403\b/.test(detail)) {
    message = '实时连接被服务器或加速服务拒绝，请检查连接访问配置';
  } else {
    message = opened ? '实时连接已断开，正在尝试重连' : '实时连接握手失败，请检查 socket 合法域名和手机网络';
  }
  const closeCode = Number.isInteger(event.code) && event.code >= 1000 && event.code <= 4999 ? event.code : null;
  if (closeCode) message += '（关闭码 ' + closeCode + '）';
  return Object.assign(new Error(message), { code, nativeDetail: nativeDetail(event) || '微信未提供具体原因', phase: opened ? 'connected' : 'handshake', closeCode });
}
module.exports = { socketError, nativeDetail };
