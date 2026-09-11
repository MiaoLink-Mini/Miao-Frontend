# 喵连 Frontend

<p align="center"><img src="miniprogram/assets/golink.png" width="128" height="128" alt="喵连" /></p>

产品名称已更新为 **喵连**。GitHub 仓库名、协议标识和本地兼容目录保持不变，无需重新配对。

[![CI](https://github.com/MiaoLink-Mini/Miao-Frontend/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/MiaoLink-Mini/Miao-Frontend/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**在微信中连接自己的开发设备，查看 Agent 会话、接收执行进度，并处理审批与提问。**

喵连 Frontend 是 喵连 的原生微信小程序客户端。界面以「总览、会话、待处理、我的」组织设备、项目与会话操作，通过 Gateway 与运行在开发设备上的 Node 通信。

小程序不是 Agent 执行环境：模型调用与项目操作发生在已配对的设备上，客户端只展示资源、提交授权操作并跟踪服务端回执。

## 项目组成

| 组件 | 职责 |
| --- | --- |
| **[Miao-Frontend](https://github.com/MiaoLink-Mini/Miao-Frontend)** | 微信小程序、设备与会话界面、实时事件展示 |
| [Miao-Backend](https://github.com/MiaoLink-Mini/Miao-Backend) | Go Gateway、认证、配对、控制路由与 PostgreSQL 持久化 |
| [Miao-Node](https://github.com/MiaoLink-Mini/Miao-Node) | 开发设备上的守护进程，以及 Codex、Pi、Claude Code 适配 |

```text
微信小程序  ← HTTP / WebSocket →  Go Gateway  ← WebSocket →  喵连 Node
                                      │                         │
                                  PostgreSQL              本机 Agent / 项目
```

公共协议保留名称 **`weagent/1`**，唯一模型来源是后端的
[`contracts/protocol.schema.json`](https://github.com/MiaoLink-Mini/Miao-Backend/blob/main/contracts/protocol.schema.json)。
仓库改名不代表协议、配置字段或本地目录约定已经改名。

## 功能与边界

- **设备和会话**：查看设备与项目、配对设备、创建和浏览会话、跟踪消息与执行结果。
- **交互处理**：审批、结构化提问、流式时间线，以及按会话状态开放的后续操作。
- **连接恢复**：实时订阅、事件补偿、资源状态同步；真实连接失败不会伪装成演示成功。
- **原生工作区**：根据服务端返回的能力开放控制入口。界面存在某个入口，不等于所有 Agent、版本和会话都支持该操作。

设计目录与需求清单用于追踪工作，不能当成全部功能已验收的证明。具体行为应同时核对源码、服务端能力、测试结果和真机表现。

## 快速开始

### 1. 获取源码

只查看或运行演示界面可以单独克隆前端。执行完整构建检查时还需要后端协议文件：

```bash
git clone https://github.com/MiaoLink-Mini/Miao-Backend.git Miao-Backend
git clone https://github.com/MiaoLink-Mini/Miao-Frontend.git Miao-Frontend
cd Miao-Frontend
```

这里的 `Miao-Frontend`、`Miao-Backend` 是**本地目录名**，不是旧仓库地址。
当前 `scripts/sync-contract.js` 读取固定相邻路径，目录应保持：

```text
workspace/
├── Miao-Backend/
│   └── contracts/protocol.schema.json
└── Miao-Frontend/
    ├── project.config.json
    └── miniprogram/
```

### 2. 选择数据模式

编辑 [`miniprogram/config.js`](miniprogram/config.js)。源码当前预置值为：

```js
module.exports = {
  mode: 'live',
  gatewayURL: 'https://agent.000.moe',
  authMode: 'wechat',
  version: '0.2.0'
};
```

| 配置 | 含义 |
| --- | --- |
| `mode: 'live'` | 连接实际 Gateway；连接错误会直接显示，不回退到模拟数据 |
| `mode: 'demo'` | 使用内置演示数据，不执行远程 Agent 操作 |
| `gatewayURL` | Gateway 地址；远程连接使用 HTTPS，本机 HTTP 仅用于允许的回环地址 |
| `authMode: 'wechat'` | 当前配置使用微信登录；不要把它描述为默认开发身份登录 |

仅体验界面时，将 `mode` 改为 `'demo'`。真实连接时，填写自己使用的 Gateway 地址，并完成后端微信认证配置。预置地址只是源码配置，不代表对该服务可用性的承诺。

**微信 AppSecret 只放在后端，不能写入小程序源码。** 本次文档与 CI 调整不修改默认连接地址、认证方式或业务配置。

### 3. 导入微信开发者工具

在微信开发者工具中导入本仓库根目录，检查 [`project.config.json`](project.config.json) 的 AppID 与开发账号权限，使用 `miniprogram/` 作为小程序源码目录，然后编译。

本项目没有第三方小程序运行依赖，不需要为了运行界面执行「构建 npm」。真实登录、真机网络、合法域名和发布权限需在自己的微信开发配置中完成验证。

### 4. 接入真实设备

先部署 Gateway，再按 [Node 使用说明](https://github.com/MiaoLink-Mini/Miao-Node#readme) 启动开发设备上的守护进程。根据 Node 输出的配对信息在小程序完成配对，然后选择设备、项目与 Agent 创建会话。

本地 Gateway 启动方式见
[后端运行指南](https://github.com/MiaoLink-Mini/Miao-Backend/blob/main/docs/running.md)。
该指南中的开发认证流程不能直接当成当前小程序默认微信登录流程使用。

## 开发与验证

`package.json` 声明 Node.js `>=20`；本文提供的 CI 在 Node.js 22 和 24 上运行。前端没有依赖锁文件，也没有需要通过 `npm ci` 安装的依赖。

```bash
# 协议生成结果必须与相邻后端一致
npm run check:contract

# 结构、语法、WXML、资源与源码体积检查
npm run check

# Node.js 内置测试运行器
npm test

# 顺序执行以上三个检查
npm run build
```

**`npm run build` 是源码与测试检查，不生成微信上传包，也不替代微信开发者工具编译。**

主动升级协议时，先审查后端 schema 的变化，再执行：

```bash
npm run sync:contract
npm run build
git diff -- miniprogram/services/protocol.generated.js
```

不要在 CI 中先生成再校验来掩盖已提交文件的漂移。

仓库还提供模拟器与集成脚本，例如 `npm run test:simulator`、`npm run test:integration`。
它们需要额外的本机工具或完整联调环境，不属于默认 CI 的已验证范围。具体要求见对应脚本和下方联调文档。

## 持续集成

工作流位于 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

在推送、面向 `main` 的 Pull Request 以及手动运行时，CI 会在 Node.js 22 / 24 上分别校验协议、项目结构与全部前端单元测试。后端被检出到 `Miao-Backend/`，本仓库检出到 `Miao-Frontend/`，与现有源码路径一致。

后端依赖默认固定到工作流中记录的完整提交 SHA；手动运行可通过 `backend_ref` 指定明确版本。跨仓库升级时，应一并审查和更新这个版本，而不是只修改生成文件。每次运行会把实际检出的提交写入 Actions 摘要。

所有 Actions 固定完整提交 SHA，仓库权限为只读，检出不保留凭据；过时运行会取消。工作流不自动上传小程序、不调用付费模型，也不使用真实微信凭据。

## 目录导航

| 路径 | 内容 |
| --- | --- |
| `miniprogram/app.*` | 应用入口、页面注册与全局样式 |
| `miniprogram/pages/` | 原生页面 |
| `miniprogram/components/` | 共享界面组件 |
| `miniprogram/services/` | Gateway 数据源、传输、协议与运行时 |
| `miniprogram/stores/` | 时间线等客户端状态 |
| `miniprogram/catalog/` | 需求追踪清单 |
| `scripts/` | 协议同步、项目检查与本机验证脚本 |
| `tests/` | 页面、运行时、协议与交互回归测试 |
| `docs/` | 设计、视觉、联调与验收记录 |

## 文档与贡献

[前端设计](docs/frontend-design.md) ·
[功能清单](docs/frontend-function-inventory.md) ·
[联调 Review](docs/integration-review.md) ·
[验证记录](docs/validation.md) ·
[视觉说明](docs/appearance.md) ·
[图标来源](docs/agent-icons.md)

历史文档中的环境、测试数量和验收结论具有时间范围；当前配置以源码为准。提交修改前运行 `npm run build`，说明使用的后端提交与本机验证环境；涉及协议或原生能力的变化还需同步审查相关仓库。

## 许可证

本项目采用 [MIT License](LICENSE)。第三方图标的来源与许可见 [图标说明](docs/agent-icons.md)。
