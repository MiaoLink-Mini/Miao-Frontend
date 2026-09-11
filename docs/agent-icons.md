# Agent 品牌图标

本地图标位于 `miniprogram/assets/agents/`，以 SVG 路径绘制，不使用字母头像、位图包装或运行时外链。获取日期：2026-09-06。

| 文件 | 来源 | 本地调整 |
| --- | --- | --- |
| `claude.svg` | [Claude 官方网站 favicon](https://claude.ai/favicon.svg) | 原样保存，保留品牌橙色 |
| `pi.svg` | [Pi 官方 logo](https://pi.dev/logo.svg)，[官方 Press Kit](https://pi.dev/press-kit) | 将 viewBox 收紧为 `140 140 520 520`，减少留白；路径不变 |
| `codex.svg` | [LobeHub Codex SVG](https://github.com/lobehub/lobe-icons/blob/master/packages/static-svg/icons/codex.svg) | 设为 24×24，`currentColor` 固定为深色界面用的浅色；路径不变 |
| `generic.svg` | 本项目原创终端符号 | 用于未知 Agent |

Claude、Pi 来自其官方站点；Codex 使用 LobeHub 社区维护的品牌矢量版本，**并非从 OpenAI 官方站点取得**。LobeHub 的 MIT 许可保存在 [`licenses/lobe-icons.txt`](licenses/lobe-icons.txt)。品牌标志的权利仍归各自所有者，本项目不表示得到品牌背书。

`utils/agent-brand.js` 仅为视图选择固定的本地资源路径。不会根据品牌推断能力、修改网关数据或信任远端提供的图片 URL。会话列表、会话头部／助手消息、创建页、设备页和 Agent 详情共享同一映射。
