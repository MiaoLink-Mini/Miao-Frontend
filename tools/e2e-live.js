/**
 * 小程序 ↔ Gateway ↔ FakeNode 真实端到端验证
 * 前置：Gateway 已启动（dev.ps1 -Port 18080 -WithFakeNode），开发者工具已开 9420 自动化端口
 * 流程：UI 登录（开发身份）→ 首页数据 → 会话详情时间线 → 发消息 → [approval] 审批闭环
 */
const automator = require("miniprogram-automator");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function state(mp) {
  return mp.evaluate(() => {
    const rt = getApp().runtime;
    const v = rt.view();
    return {
      auth: rt.auth, live: rt.live, connection: rt.connection,
      hydrated: rt.gateway.hydrated, user: rt.gateway.user && rt.gateway.user.displayName,
      nodes: v.nodes.map(n => ({ name: n.name, online: n.online, revoked: n.revoked })),
      sessions: v.sessions.map(s => ({ id: s.id, short: s.id.slice(0, 18), title: s.title, state: s.state, stateLabel: s.stateLabel })),
      pendingCount: v.pendingCount, approvals: v.approvals,
      timelines: Object.keys(rt.timelines).map(id => ({ id: id.slice(0, 18), cursor: rt.timelines[id].cursor, items: rt.timelines[id].items.length, gap: rt.timelines[id].gap }))
    };
  });
}

async function main() {
  const mp = await automator.connect({ wsEndpoint: "ws://127.0.0.1:9420" });
  const shot = async name => { try { await mp.screenshot({ path: __dirname + "/../assets/shots/e2e-" + name + ".png" }); console.log("  [shot]", name); } catch (_) {} };
  try {
    // 1. 登录页（live 模式：开发身份）
    await mp.reLaunch("/pages/login/index");
    await sleep(1500);
    let page = await mp.currentPage();
    console.log("1. 登录页:", page.path);
    const primary = await page.$(".primary");
    if (!primary) throw new Error("登录页主按钮不存在");
    await primary.tap();
    await sleep(3500);
    page = await mp.currentPage();
    console.log("2. 登录后页面:", page.path);

    const s1 = await state(mp);
    console.log("3. runtime 状态:", JSON.stringify(s1, null, 1));
    if (!s1.auth) throw new Error("登录失败：auth=false");
    if (!s1.live) throw new Error("未处于 live 模式");
    if (!s1.nodes.some(n => n.online)) throw new Error("无在线节点");
    await shot("home");

    // 2. 会话列表
    await mp.switchTab("/pages/sessions/index");
    await sleep(1500);
    await shot("sessions");

    // 3. 打开会话详情，等待时间线加载
    const s = (await state(mp)).sessions[0];
    if (!s) throw new Error("无会话");
    await mp.navigateTo("/pages/session/index?id=" + s.id);
    await sleep(2500);
    page = await mp.currentPage();
    console.log("4. 会话页:", page.path);
    let detail = await mp.evaluate(id => {
      const rt = getApp().runtime;
      const t = rt.timelines[id];
      return t ? { cursor: t.cursor, items: t.items.map(i => i.type + ':' + (i.text || '').slice(0, 24)) } : null;
    }, s.id);
    console.log("5. 时间线:", JSON.stringify(detail, null, 1));
    await shot("session");

    // 4. 发送普通消息
    const before = detail ? detail.items.length : 0;
    await page.setData({ draft: "你好，请汇报当前进度" });
    await page.callMethod("updateComposer", { draft: "你好，请汇报当前进度" });
    await page.callMethod("send");
    await sleep(5000);
    detail = await mp.evaluate(id => {
      const rt = getApp().runtime;
      const t = rt.timelines[id];
      const sess = rt.gateway.data.sessions.find(x => x.id === id);
      return { cursor: t ? t.cursor : 0, items: t ? t.items.length : 0, state: sess && sess.state, ops: rt.operations };
    }, s.id);
    console.log("6. 发送消息后:", JSON.stringify(detail));
    if (detail.items <= before) throw new Error("发送消息后时间线未增长");
    await shot("sent");

    // 5. 发送审批触发消息
    await page.setData({ draft: "[approval] 部署到生产环境" });
    await page.callMethod("updateComposer", { draft: "[approval] 部署到生产环境" });
    await page.callMethod("send");
    // 等待审批请求产生（FakeNode 立即上报）
    let reqId = null;
    for (let i = 0; i < 20 && !reqId; i++) {
      await sleep(800);
      reqId = await mp.evaluate(() => {
        const rt = getApp().runtime;
        const r = rt.gateway.data.requests.find(x => x.state === "pending");
        return r ? r.id : null;
      });
    }
    if (!reqId) throw new Error("审批请求未产生");
    console.log("7. 审批请求:", reqId);
    const s2 = await state(mp);
    console.log("   会话状态:", JSON.stringify(s2.sessions), "| pending:", s2.pendingCount);

    // 6. 打开审批页并批准
    await mp.navigateTo("/pages/request/index?id=" + reqId);
    await sleep(2000);
    page = await mp.currentPage();
    console.log("8. 审批页:", page.path);
    const reqData = await page.data();
    console.log("   审批标题:", (reqData.request || {}).title, "| 选项:", JSON.stringify((reqData.request || {}).choices || []).slice(0, 120));
    await shot("request");
    const allowBtn = await page.$(".choice.primary");
    if (!allowBtn) throw new Error("未找到批准按钮");
    await allowBtn.tap();
    await sleep(5000);
    const after = await mp.evaluate(() => {
      const rt = getApp().runtime;
      return { ops: rt.operations, connection: rt.connection, sessions: rt.gateway.data.sessions.map(x => ({ title: x.title.slice(0, 12), state: x.state })) };
    });
    console.log("9. 批准后:", JSON.stringify(after, null, 1));
    await shot("approved");
    console.log("E2E OK");
  } finally {
    await mp.disconnect();
  }
}

main().catch(e => { console.error("E2E FAILED:", e && e.message); process.exit(1); });
