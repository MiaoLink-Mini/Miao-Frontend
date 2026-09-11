const test = require('node:test');
const assert = require('node:assert/strict');
const { socketError } = require('../miniprogram/utils/socket-error');
const { LiveGateway } = require('../miniprogram/services/live-gateway');
const { mount } = require('./helpers');

test('TLS handshake timeouts do not claim that the certificate is invalid', () => {
  const error = socketError({errMsg:'open fail: _code:5,_msg:TLS handshake timed out'});
  assert.equal(error.code, 'SOCKET_TIMEOUT');
  assert.match(error.message, /超时/);
  assert.doesNotMatch(error.message, /证书校验失败/);
});

test('HTTP transport errors retain redacted native detail and the actual request endpoint', async () => {
  const gateway = new LiveGateway({wx:{request(options){options.fail({errMsg:'request:fail timeout Bearer private-token'});}}});
  await assert.rejects(gateway.request('/bootstrap', 'Bootstrap'), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.phase, 'request');
    assert.equal(error.endpoint, 'https://agent.000.moe/v1/bootstrap');
    assert.match(error.nativeDetail, /timeout/);
    assert.doesNotMatch(error.nativeDetail, /private-token/);
    return true;
  });
});

test('login diagnostics never mix a current HTTP failure with a stale socket failure', async () => {
  const error = Object.assign(new Error('HTTP failed'), {code:'NETWORK_ERROR',phase:'request',nativeDetail:'request:fail timeout',endpoint:'https://agent.000.moe/v1/auth/wechat'});
  const page = mount('pages/login/index.js', {gateway:{lastError:{code:'SOCKET_DOMAIN_ERROR',nativeDetail:'old socket error'}},login:async()=>{throw error;}});
  await page.enter();
  assert.equal(page.connectionError, error);
  assert.equal(page.data.connectionDetail, '');
  assert.equal(page.data.error, '错误码：NETWORK_ERROR');
});

test('socket diagnostics classify platform errors without exposing native payloads', () => {
  for (const [raw, code] of [
    ['connectSocket:fail url not in domain list', 'SOCKET_DOMAIN_ERROR'],
    ['SSL certificate failed', 'SOCKET_TLS_ERROR'],
    ['ERR_NAME_NOT_RESOLVED', 'SOCKET_DNS_ERROR']
  ]) {
    const error = socketError({ errMsg: raw + ' https://secret.invalid/?token=private' });
    assert.equal(error.code, code); assert.doesNotMatch(error.message, /private|secret.invalid/);
  }
  assert.match(socketError({code:1006}, false).message, /握手失败.*1006/);
  assert.match(socketError({code:1006}, true).message, /已断开.*1006/);
});

test('generic domain advice does not override a TLS error and native details redact credentials', () => {
  const error=socketError({errMsg:'SSL certificate failed; 请检查合法域名'});
  assert.equal(error.code,'SOCKET_TLS_ERROR');
  assert.match(error.nativeDetail,/SSL certificate failed/);
  const secret=socketError({errMsg:'connectSocket:fail https://example.org/?token=private Bearer super-secret-token-value'});
  assert.doesNotMatch(secret.nativeDetail,/example.org|private|super-secret/);
});

test('synchronous platform rejection leaves no stuck connecting promise', async t => {
  const gateway = new LiveGateway({wx:{connectSocket(options){options.fail({errMsg:'url not in domain list'});}}});
  gateway.token = 'private'; gateway.paused = true;
  t.after(()=>gateway.disconnect());
  await assert.rejects(gateway.connect(), {code:'SOCKET_DOMAIN_ERROR'});
  assert.equal(gateway.connecting, null); assert.equal(gateway.connection,'error');
  assert.equal(gateway.lastError.code,'SOCKET_DOMAIN_ERROR');
  await assert.rejects(gateway.connect(), {code:'SOCKET_DOMAIN_ERROR'});
});

test('onError retains its classified cause when followed by onClose', async t => {
  const handlers={}; const task={onOpen:f=>handlers.open=f,onMessage:f=>handlers.message=f,onError:f=>handlers.error=f,onClose:f=>handlers.close=f,close(){}};
  const gateway=new LiveGateway({wx:{connectSocket:()=>task}});gateway.token='private';gateway.paused=true;t.after(()=>gateway.disconnect());
  const work=gateway.connect(); const rejected=assert.rejects(work,{code:'SOCKET_TLS_ERROR'});
  handlers.error({errMsg:'SSL error'});handlers.close({code:1006});await rejected;
  assert.equal(gateway.lastError.code,'SOCKET_TLS_ERROR');assert.equal(gateway.socket,null);
});
