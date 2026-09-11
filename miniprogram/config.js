// mode: 'demo' 使用内置演示数据源；'live' 连接真实 Gateway（weagent/1 协议）。
// live 模式连接失败时明确报错，不回退演示数据（见 WeAgent-Backend/docs/frontend-contract.md §1）。
// gatewayURL 允许 HTTPS 任意主机；HTTP 仅允许 127.0.0.1/localhost 本机联调。
// 登录仅使用 wx.login；AppSecret 只允许配置在后端。
module.exports = {
  mode: 'live',
  gatewayURL: 'https://agent.000.moe',
  authMode: 'wechat',
  version: '0.2.0'
};
