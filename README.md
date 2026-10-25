# DSH × QQ 浏览器桥接插件（dsh-qq-browser-bridge）

把 **QQ（NT 版 + OneBot v11 / SnowLuma）** 接入 **DeepSeek（DS）**，让 DS 在 QQ 里不仅能聊天，
还能**看网页、看视频、玩网页游戏**——这是与 `qq-bridge` 最大的区别：
`qq-bridge` 出于安全把网络能力限制为只读搜索/抓取，本插件额外挂载了**真实浏览器控制**（Playwright + browser-use）。

整体效果与 `SnowLuma` + `qq-bridge` 等价：QQ 私聊/群聊 ↔ DSH 会话，DS 回复回流到 QQ；
区别是 DS 多了一组浏览器工具，并且截图/画面能直接发回 QQ。

---

## 架构

```
                 ┌─────────────┐   OneBot v11 (WS)   ┌──────────────────┐
   QQ 用户  ───► │  SnowLuma   │ ◄──────────────────► │  bridge 进程     │
   (NT 客户端)   │ (QQ 协议端) │                      │  (本仓库)        │
                 └─────────────┘                      └────────┬─────────┘
                                                               │
                          ┌────────────────────────────────────┼───────────────────────┐
                          │ 模式 A: DSH 转发                                   │ 模式 B: 独立 DeepSeek 代理
                          │                                                   │
                          ▼                                                   ▼
                 ┌─────────────────┐  launch (MCP)   ┌──────────────────┐   ┌──────────────────────┐
                 │  DSH (Harness)  │ ──────────────► │ browser-mcp 进程 │   │ DeepSeek API         │
                 │  agent 编排     │ ◄────────────── │ (Playwright)     │   │ + 内置浏览器工具循环 │
                 └─────────────────┘  工具调用结果   └────────┬─────────┘   └──────────┬───────────┘
                                                              │  navigate/screenshot/   │
                                                              ▼  click/type/key/scroll  ▼
                                                         ┌──────────────────┐      ┌──────────────────┐
                                                         │  真实 Chromium   │      │  真实 Chromium   │
                                                         │  (看网页/视频/游戏)│      │  (看网页/视频/游戏)│
                                                         └──────────────────┘      └──────────────────┘
```

- **bridge 进程**：连 OneBot v11（SnowLuma/NapCat/Lagrange 均可），把 QQ 消息映射成会话，
  拿到 DS 回复（文本 + 截图）后用 `send_msg` 发回 QQ（支持群/@触发/私聊）。
- **browser-mcp 进程**：一个标准 MCP 服务器（stdio），把浏览器能力暴露成工具；
  在 DSH 模式下由 DSH 启动并交给 agent 调用（这就是 DS“能看能玩”的来源）。
- **模式 B（默认）**：不需要 DSH，bridge 自己用 DeepSeek 的函数调用循环直接驱动浏览器，开箱即跑。

---

## 前置条件

- Node.js >= 18
- 一个 OneBot v11 协议端并登录了 QQ 小号：**SnowLuma**（默认，你指定的 QQ NT 原生端）、NapCatQQ 或 Lagrange.Onebot
- **浏览器**：`npm run install-browser`（下载 Chromium）
- 二选一：
  - **模式 B**：一个 `DEEPSEEK_API_KEY`
  - **模式 A**：一个运行中的 **DSH** 实例（本地 Web API，默认 `127.0.0.1:3080`）

---

## 安装与配置

```bash
cd d:/DSH_CJ
npm install
npm run install-browser        # 下载 Chromium（一次）
cp .env.example .env           # 然后编辑 .env
```

关键配置（` .env`）：

| 变量 | 说明 |
|------|------|
| `BRIDGE_MODE` | `deepseek`（默认，开箱即用）或 `dsh` |
| `ONEBOT_URL` | OneBot 正向 WS 地址，如 `ws://127.0.0.1:3001` |
| `ONEBOT_REVERSE_PORT` | 填了则 bridge 起反向 WS 服务，协议端来连它（优先级高于 `ONEBOT_URL`） |
| `ONEBOT_TOKEN` | 协议端 access_token（没有留空） |
| `ALLOWED_GROUPS` | 只允许响应的群号，逗号分隔（空=全部） |
| `GROUP_TRIGGER` | 群里如何触发：`mention`(被@) / `prefix`(前缀) / `always` |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 模式 B 用 |
| `DSH_BASE_URL` / `DSH_SIGN_KEY` | 模式 A 用 |
| `BROWSER_MCP_CMD` | 模式 A 下交给 DSH 启动的 MCP 命令 |

---

## 运行

```bash
# 桥接进程（连 QQ + 跑 DS 代理）
npm start                 # = npx tsx src/cli.ts bridge

# 或者单独启动浏览器 MCP 服务器（一般只在 DSH 模式由 DSH 拉起）
npm run mcp               # = npx tsx src/cli.ts mcp
```

冒烟测试（验证 MCP 服务器能列出浏览器工具）：
```bash
node scripts/test-mcp.mjs
```

---

## 在 QQ 里怎么用

直接对机器人说（群聊需 @它 或加前缀，取决于 `GROUP_TRIGGER`）：

- “打开 bilibili 看看今天的热门视频” → DS 会 `browser_navigate` + `browser_screenshot` + `browser_video`，把画面发回来
- “去 4399 玩贪吃蛇，帮我玩 30 秒” → DS 用 `browser_click` / `browser_key`（方向键）操控
- “查一下这个网页讲了什么” → `browser_observe` 读正文

群内命令（斜杠）：

- `/reset` 重置当前会话上下文
- `/browser reset` 关闭/重置浏览器（仅管理员或模式 B）
- `/help` 帮助

---

## 浏览器工具（DS 可用）

`browser_navigate`(打开URL) · `browser_observe`(读页面文字/元素) · `browser_screenshot`(截图, 会发回QQ) ·
`browser_click`(点元素或坐标) · `browser_type`(输入文字) · `browser_key`(按键, 游戏方向键/空格) ·
`browser_scroll`(滚动) · `browser_mouse`(移动/按下/抬起/点击, canvas 游戏) ·
`browser_video`(查看 <video> 是否在播、进度) · `browser_eval`(只读执行 JS 看游戏状态) ·
`browser_task`(给定目标自主规划执行, browser-use 风格)。

底层执行用 **Playwright**（真实 Chromium），高层规划用 **browser-use 风格**的“观察→决策→执行”循环，
二者结合：既能精细操控（按键/坐标点击玩小游戏），也能给定目标自主完成（看视频/逛网页）。

---

## 模式 A（接入真实 DSH）额外步骤

1. 在 DSH 的 MCP 配置里注册本仓库的浏览器服务器，命令填 `.env` 里的 `BROWSER_MCP_CMD`
   （例如 `npx tsx /绝对路径/dsh-qq-browser-bridge/src/cli.ts mcp`）。
2. 启动 DSH，确保 `DSH_BASE_URL` / `DSH_SIGN_KEY` 正确。
3. `BRIDGE_MODE=dsh` 启动 bridge。此时 bridge 只做 QQ↔DSH 会话的搬运，
   浏览器能力由 DSH 拉起的 `browser-mcp` 提供，与 `qq-bridge` 的结构一致。

> 注：DSH 各版本的本地 Web API（建会话、提交消息、拉取回复）路径未公开统一标准，
> `src/dsh/dshAdapter.ts` 中已按 `qq-bridge` 的模式（签名会话 + `remote.mux` / `session/follow`）
> 写好骨架，并把三处 `[ADJUST]` 端点标出，按你的 DSH 构建对齐即可，其余逻辑通用。

---

## 目录结构

```
src/
  config.ts            配置加载（.env）
  types.ts             共享类型
  onebot/client.ts     OneBot v11 WS 客户端（正向/反向，兼容 SnowLuma/NapCat/Lagrange）
  dsh/
    backend.ts         AgentBackend 接口 + Thinker
    deepseekAdapter.ts 模式 B：DeepSeek 函数调用循环 + 浏览器工具
    dshAdapter.ts      模式 A：转发到 DSH Web API（[ADJUST] 端点）
  browser/
    controller.ts      Playwright 底层控制（导航/截图/点击/输入/按键/滚动/视频）
    planner.ts         browser-use 高层规划循环
    tools.ts           浏览器工具注册表（供代理循环与 MCP 共用）
    mcpServer.ts       MCP 服务器（stdio），把工具暴露给 DSH agent
  bridge/
    renderer.ts        DS 回复 → QQ 消息段（文本分片 + 图片 base64）
    index.ts           桥接主循环（消息路由、触发、命令）
  cli.ts               入口：bridge / mcp 两种模式
scripts/test-mcp.mjs   MCP 冒烟测试
```

---

## 作为 DSH 进程内插件安装（最新版 DSH）

除了“独立桥接进程”，本仓库根目录本身就是一个 **DSH Cordis bundle**（入口 `src/plugin/index.ts`），
直接装进 DSH 后，DS agent 就获得浏览器能力（看网页/视频/游戏），符合“发给 DSH 即用”的形态。

插件做两件事：
1. **注册浏览器工具**（核心）：用 `defineTool` + `ctx.tools.register` 把 11 个浏览器工具挂进 DSH，
   agent 在任意会话里都能调用——这正是比 qq-bridge（只读网页）强的地方。
2. **可选桥接 QQ**（默认关闭）：把 OneBot/SnowLuma 的消息灌进 DSH 会话并回传回复。需先把
   `src/plugin/sessionBridge.ts` 里的三处 `[DSH-ADJUST]` 对齐你的 DSH 版本，再设 `DSH_INPROC_BRIDGE=1`。

### 安装（二选一）

**A. 作为 bundle 装进某个 profile（推荐，已发布/可 git 安装）**
```bash
dsh plugin --profile <你的profile名> add <本仓库路径或 github:you/dsh-qq-browser-bridge>
dsh --profile <你的profile名> --dump-config   # 确认插件层位置正确
# 重启该 profile 生效
```

**B. 本地 scratch 开发（绝对路径挂载）**
编辑根目录 `cordis.patch.yml`，把 `name` 改成入口 `.ts` 的**绝对路径**，然后：
```bash
pnpm dsh web --patch ./cordis.patch.yml
```

### 验证
装好后，在 DSH 里直接对 agent 说“打开 bilibili 看热门视频”或“去 4399 玩贪吃蛇”，
agent 会调用 `browser_navigate` / `browser_screenshot` / `browser_key` 等工具。

> 插件依赖 `@deepseek-ai/dsh-tools`、`@deepseek-ai/cordis`（由 DSH 运行时提供，已在 `package.json` 的 `peerDependencies` 声明），
> 因此 `src/plugin/` 不参与本仓库根目录的 `tsc` 类型检查；它应在 DSH 的 profile 环境内构建/加载。

> 若你更偏好 MCP 形态，`src/browser/mcpServer.ts`（即 `npm run mcp`）仍是标准 MCP 服务器，
> 可在 DSH 的 MCP 配置里用启动命令挂载，效果等价。

## 安全提示

- 浏览器自动化能力很强：它可以访问内网、下载、与网页交互。**务必在隔离环境/沙箱里运行**，
  不要把机器人暴露在不受信任的群。
- `ALLOWED_GROUPS`、`OWNER_QQ`、`/browser reset` 仅管理员可用，可限制风险。
- 模式 A 下建议保持 DSH 自带的 MCP 启动鉴权（启动命令是可执行代码，受信任边界）。
