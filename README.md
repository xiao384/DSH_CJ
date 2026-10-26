# dsh-qq-browser-bridge（浏览器工具插件）

DSH 进程内插件：给 DeepSeek agent 一组真实浏览器工具（Playwright 驱动本机 Edge/Chrome），
可以打开网页、读正文、截图、点击/输入/按键/滚动、检查视频与网页游戏状态。

从 `xiao384/DSH_CJ` 的 `plugin/` 改写而来，按 DSH 0.2.1 的工具契约适配：

- 参数用 DSH 统一 schema DSL（`{ 字段: { type, required, description } }`），不是 JSON Schema；
- `output.schema` 声明规范返回值，`render()` 产出内容块；
- 截图经 attachments 服务落盘并以 image 内容块返回（无附件服务时降级为文字）；
- 修掉了原仓库 `plugin/src/index.ts` 里指向仓库根 `browser/`、`config.js`、`onebot/` 的相对导入；
- 去掉了 QQ 桥接半（原 `sessionBridge.ts` 是 `[DSH-ADJUST]` 占位；QQ 已有 `C:\DshBridge\qq-bridge`）。

## 安装

```powershell
$env:DSH_HOME='C:\Users\Administrator\.dsh'
dsh plugin --profile desktop add file:C:/DshBridge/dsh-browser-tools
```

装好后 DSH 宿主会自动重启并加载（无需重启 Electron 窗口）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `BROWSER_CHANNEL` | `msedge` | `msedge` / `chrome`，留空则用 Playwright 自带 Chromium |
| `BROWSER_EXECUTABLE` | 空 | 自定义浏览器 exe 路径（优先于 channel） |
| `BROWSER_HEADLESS` | `true` | `false` 显示浏览器窗口 |
| `BROWSER_WIDTH` / `BROWSER_HEIGHT` | `1280` / `800` | 视口尺寸 |

默认走系统 Edge，不需要 `npx playwright install`（不下载 Chromium）。

## 工具

`browser_navigate` · `browser_observe` · `browser_screenshot` · `browser_click` ·
`browser_type` · `browser_key` · `browser_scroll` · `browser_mouse` · `browser_video` · `browser_eval`

（原仓库的 `browser_task` 自主要目标规划依赖外部 LLM thinker，未移植。）

## 服务器控制（通过 QQ 控制本机）

qq-bridge 默认是「聊天权限」会话，不会给 agent 本地终端/文件工具。本插件额外注入一组**服务器控制工具**，让经 QQ 进来的会话也能直接控制运行 DSH 的机器：

| 工具 | 说明 |
|---|---|
| `server_exec` | 在 DSH 所在主机执行命令，返回 stdout/stderr/退出码；可指定 shell：`powershell`（Windows 默认）/ `cmd` / `bash` / `sh`（看状态、查日志、起停服务、装包等） |
| `server_terminal` | **持久终端会话**：保留 cwd/环境变量/ shell 状态，多次调用间连续（像真终端）；默认 powershell（Win）/ bash（Linux），可 `shell:"cmd"` |
| `server_process_list` | 列出主机进程（Windows `tasklist` / Linux `ps`） |
| `server_process_kill` | 按 PID 结束进程（Windows `taskkill /F` / Linux `kill -9`） |
| `server_file_read` | 读主机文本文件（上限 200KB） |
| `server_file_write` | 写/覆盖主机文件（自动建目录） |
| `server_file_list` | 列目录 |
| `server_pwd` | 当前工作目录 |

这些工具以自定义名字注册，不会被 qq-bridge 的本地工具守卫（`qq-tool-restrict`）隐藏，因此在 chat-only 会话里也可用。

**安全（务必读）**：这等于把主机的终端/文件权限交给了能跟 agent 对话的人。请务必：

- 把 QQ 桥接限制在 **owner 私聊**或**可信白名单群**；
- 不要对公群开放；
- 不需要时设 `SERVER_CONTROL_ENABLED=0` 关闭整组工具（每条命令会在 DSH 控制台以 `[dsh-browser-tools] server_exec: ...` 记录，便于审计）。
