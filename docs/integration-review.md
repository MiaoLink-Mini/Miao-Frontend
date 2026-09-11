# 三层对接 Review 与回归（2026-09-06）

## 清点结论

接续其他 Agent 的实现，而非覆盖重写：保留 LiveGateway、schema 生成器、双数据源登录、原生图标、黑色 CLI 会话和请求页的固定底部按钮。营销站 `WeAgent-Web` 未改动。194 项需求冻结清单未改成“全部完成”。

接手时 `npm run build` 的 71 项测试通过，但并不覆盖下面这些恢复、并发和分页边界。本轮在同一实现上修正并增加定向回归。

## 已修复的问题

| 优先级 | 原问题 | 修复与证据 |
| --- | --- | --- |
| P1 | 历史循环注释称固定屏障，实际每页没有传 `until` | 固定第一页面或 ready 的 highWater，连续读取；回归覆盖七页及越过屏障的新 live 缺口 |
| P1 | `onBarrier` 没返回异步任务，忽略 ready.sessions 并吞掉历史异常 | 只加载被关注会话、await 屏障，补历史失败不能进入 online |
| P1 | 收到乱序事件就更新 watched.after | 只用 reducer 已连续安装正文的 cursor，避免重连跳过缺口 |
| P1 | checkpoint 覆盖实时流；同账号撤销后晚到正文可能重新灌入 | 检查点正文/游标原子安装，缓冲并重放其后的实时帧；auth/body generation 和资源失效标记阻止恢复失权内容 |
| P1 | 生成异步操作 ID 时尚未加 busy 锁；生成失败未捕获 | 先锁再 await；快速双击只生成一个 ID，退出期间不向新账号发送旧命令 |
| P1 | 提交超时显示 failed，可换 key 重试；查询成功直接把 raw OperationResult 当资源 | unknown 保持锁定，只查询原 operationId；confirmed 经统一结果映射再导航/清草稿 |
| P1 | 请求/发送入口用 Agent 而非 Session 能力 | 会话级 capabilities 优先，idle、purged、readonly、离线和 stale turn 仍由 Gateway 最终校验 |
| P2 | 用户消息被当 assistant；null metadata 被伪造 turnId | 保留 role/truncated、真实 item turnId；null metadata 只消费序号，不生成消息 |
| P2 | 分页后的请求/系统通知被首屏 session 列表误过滤 | 资源按 Gateway 授权和引用补加载，不把未加载父资源当失权 |
| P2 | 真实搜索/历史待办仍只有内存过滤 | 会话标题搜索和精确状态组合走 GET；待办/history 分桶及游标分页；筛选切换不复用游标 |
| P2 | deciding 被当已处理或普通 pending | 明示“正在回传”、保留待办并禁用重复提交；过期显示采用服务端时钟偏移 |
| P2 | PairPreview 的指纹未显示 | 配对确认页显示可选择指纹，倒计时采用实际 expiresAt |
| P2 | Diff 页把缺少数据的旧 lines 当文件正文 | 使用授权 fileId 获取原生 patch，只读片段保留增删行与截断提示；用量未知仍显示未提供 |
| P2 | 本机统计把已加载数量冒充总量 | 总览改用 bootstrap 的 pendingRequests / onlineNodes / sessions；种类细分仍是已加载待办统计 |

## 实际验证

1. `npm run build`：schema 漂移检查、2492 项原生工程结构检查、90 项 JS 回归通过（较接手增加 19 项）。新增定向测试见 `tests/integration-review.test.js`。
2. `npm run test:integration`：默认使用 **18081**，不占用已有 18080 Gateway；真实 PostgreSQL 的独立随机数据库，Go 全包测试、迁移、真实 Gateway、独立 WeAgent-Node 进程；结束只停止测试 PID、删除随机测试库。
3. 三个插件均通过 **真实前端 Runtime/LiveGateway → HTTP/WebSocket → Go/PostgreSQL → Node → 原生协议 fixture**：配对、create、页面审批、send、question、cancel、流式历史、断线不重放、服务端搜索、历史待办、撤销及 logout。一次成功运行 70 个 HTTP 请求、4 次顺序 SocketTask 连接；三插件共 9 次 fixture prompt，无真实模型调用。
4. `WeAgent-Node/npm test`：28 项全部通过。
5. 微信安装目录的原生 `wcc.exe`：24 个 WXML 模板编译通过。
6. `scripts/verify-live-simulator.js`：在开发者工具实际执行 wx HTTP 开发身份登录、SocketTask ready、安全随机数、总览/服务端列表检查；当时账号没有会话或请求，因此该次模拟器检查**没有覆盖真实请求详情或会话正文**。截图/报告在已忽略的 `test-results/live-review/`。不提交 Agent 命令，检查后恢复退出状态。

应用层 fixture 并非真实模型响应；Go 集成与微信模拟器两类证据也不合并冒充真机全流程验收。

## 后续部署 / 验收边界

- 默认是 `live + development + http://127.0.0.1:18080`，不是生产设置。真机需 HTTPS/WSS 合法域名、证书、正式 AppID，以及 **仅存服务端** 的微信 AppSecret；当前未做真实微信兑换或付费模型调用。
- 未做长历史内存峰值/吞吐压测；timeline 正文仍仅内存保存，冷启动重建，不仅存一个游标。
- 节点/项目详情中的会话小列表和诊断审计是已加载缓存；全量会话检索入口在“会话”，没有将详情列表宣称为全库结果。
- 后续原生能力增量：`/model` 已连接三种主机模型目录与下一轮模型选择；`/compact` 已连接 Codex / Pi。Codex 的模型选择先暂存、下一次发送才应用；Claude 压缩、附件、全局配置改写、任意文件浏览及原生历史接管仍未开放。`/` 仍不是任意原生命令透传。实现 / 验证 / 部署顺序见 [原生能力计划](../../WeAgent-Node/docs/native-controls-plan.md)。
- 当前三个 Native Adapter 均不提供 queue / steer；前端按实际 Session 能力禁用，不因品牌开启。
