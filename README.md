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
