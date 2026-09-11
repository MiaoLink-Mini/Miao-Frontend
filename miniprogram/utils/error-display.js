// WeChat's mini-program module loader resolves a JSON require as
// `error-codes.json.js` on some developer-tool/runtime versions. Keep the
// full descriptions in error-codes.json for tooling and docs, but use a JS
// key table at runtime so the app service bundle is portable.
const ERROR_CODES = 'ALREADY_PAIRED AUTH_CHANGED AVATAR_INVALID AVATAR_PROCESS_FAILED AVATAR_STORAGE_FAILED BUSY CAPABILITY_CHANGED CAPABILITY_UNSUPPORTED CLIENT_UNSUPPORTED CONFIG_ERROR CONTENT_CLEARED CONTROL_UNAVAILABLE CRYPTO_UNAVAILABLE CURSOR_AHEAD CURSOR_EXPIRED DEV_AUTH_DISABLED EACCES ECONNREFUSED ECONNRESET EMPTY_INPUT ENOENT EPERM ETIMEDOUT FILE_OPERATION_FAILED FORBIDDEN HISTORY_PURGED IDEMPOTENCY_CONFLICT INTERNAL INVALID_ANSWER INVALID_CHOICE INVALID_PAIR_CODE INVALID_PROTOCOL IN_PROGRESS LIVE_NOT_CONFIGURED LIVE_REQUIRED LOGIN_FAILED MISSING_IDENTITY NETWORK_ERROR NETWORK_TIMEOUT NODE_OFFLINE NOT_FOUND OFFLINE OPERATION_UNKNOWN PAIRING_CONFLICT PAIRING_INVALID PAIR_EXPIRED PAYLOAD_TOO_LARGE PERMISSION_DENIED PROFILE_NAME_INVALID PROTOCOL_UNSUPPORTED RATE_LIMITED READ_ONLY REQUEST_ALREADY_DECIDED REQUEST_DOMAIN_ERROR REQUEST_EXPIRED REQUEST_UNAVAILABLE REQUIRED RESOURCE_CHANGED RESOURCE_UNAVAILABLE RESULT_UNKNOWN SCAN_FAILED SERVICE_UNAVAILABLE SESSION_NOT_CLOSED SHARE_TTL_INVALID SHARE_UNAVAILABLE SOCKET_DNS_ERROR SOCKET_DOMAIN_ERROR SOCKET_TIMEOUT SOCKET_TLS_ERROR SOURCE_CONFLICT STALE_TURN SUBSCRIPTION_FAILED UNAUTHENTICATED UNKNOWN_ERROR USER_CANCELLED VALIDATION_FAILED';
const catalog = {};
ERROR_CODES.split(' ').forEach(code => { catalog[code] = ['', '']; });
Object.freeze(catalog);
const known = code => typeof code === 'string' && Object.prototype.hasOwnProperty.call(catalog, code);
// Only registered codes reach the UI. Never interpolate remote messages or unknown codes.
function errorCode(error, fallback = 'UNKNOWN_ERROR') {
  const code = typeof error === 'string' ? error.replace(/^错误码：/, '') : error && error.code;
  if (known(code)) return code;
  const native = typeof error === 'string' ? error : error && (typeof error.errMsg === 'string' ? error.errMsg : error.message || '');
  if (/cancel/i.test(native)) return 'USER_CANCELLED';
  if (/not in domain list|url not in domain/i.test(native)) return 'REQUEST_DOMAIN_ERROR';
  if (/open fail.*(?:tls\s+)?handshake.*timed?\s*out/i.test(native)) return 'SOCKET_TIMEOUT';
  if (/timed?\s*out|timeout/i.test(native)) return 'NETWORK_TIMEOUT';
  if (/auth deny|auth denied|permission denied|authorize.*fail/i.test(native)) return 'PERMISSION_DENIED';
  return known(fallback) ? fallback : 'UNKNOWN_ERROR';
}
function errorText(error, fallback) { return '错误码：' + errorCode(error, fallback); }
function codedError(code) { return Object.assign(new Error(errorText(code)), { code: errorCode(code) }); }
module.exports = { catalog, errorCode, errorText, codedError };
