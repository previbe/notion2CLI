# notion2CLI

`notion2CLI` 的 MVP 只解决一件事：

**把 Notion 页面当作 Codex CLI 的富文本输入框。**

在 Notion 页面里点击插件按钮后，插件会把当前选区或当前整页作为下一条用户输入交给本地 Codex 会话，并直接开始处理。用户不需要回到终端手动按 Enter。

## 当前 MVP

已实现：

- 选中文本作为下一条 Codex 输入运行
- 当前整页作为下一条 Codex 输入运行
- 整页读取通过当前 Codex runtime 的 Notion MCP 完成
- Notion 页面里的图片会作为本地图片工件交给 Codex
- Codex 最新回复会回到插件面板
- 用户可手动点击“写回 Notion”
- 插件请求会稳定复用同一个 Codex App 可见 session
- 可选使用 `notion2cli codex inspect` 检查当前 session，或 `notion2cli codex open` 打开 Codex App

暂不做：

- bridge 自己直连 Notion API / MCP 读取页面
- bridge 自己确定性写回 Notion
- 完整文件附件支持
- Claude Code 与 Codex 的同等 live session 体验
- Chrome Native Messaging

## 前置要求

本机需要：

- `Node.js`
- `npm`
- `Google Chrome`
- `Codex CLI`
- 一个已登录的 Notion 浏览器会话

确认命令存在：

```bash
node --version
npm --version
codex --version
```

## 安装

```bash
cd /Users/morrow/coding/notion2CLI
npm install
npm install -g .
```

加载 Chrome 扩展：

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 `/Users/morrow/coding/notion2CLI/extension`

## 快速开始

```bash
notion2cli mcp install notion --runtime codex
notion2cli daemon start --runtime codex
notion2cli pair
```

然后：

1. 点击浏览器工具栏里的 `notion2CLI`
2. 粘贴 6 位配对码
3. 打开一个 Notion 页面
4. 选中文字时点击“运行选中内容”
5. 不选中文字时点击“运行当前页”

Codex 会直接开始处理。终端界面不是必需操作步骤。

需要检查或打开同一个 Codex App session 时运行：

```bash
notion2cli codex inspect
notion2cli codex open
```

## 使用说明

### 运行选中内容

有文本选区时，插件会发送：

- `selectionText`
- `pageUrl`
- `pageTitle`

bridge 会创建 job，Codex 会把这段选中文本当作下一条用户输入处理。

### 运行当前页

没有文本选区时，bridge 会：

1. 借当前 Codex runtime 的 Notion MCP 读取整页内容
2. 规范化为 `McpPageBundle`
3. 从 bundle 中解析图片附件链接
4. 下载并缓存本地图片工件
5. 把 `page bundle + 本地图片工件` 作为下一条用户输入交给 Codex

如果 page bundle 准备失败，本次运行会失败，不回退到浏览器 DOM 抓取。

### 写回 Notion

Codex 回复显示在插件面板后，可以手动点击“写回 Notion”。

当前写回仍由 Codex 通过 Notion MCP 执行。支持：

- 追加到页面末尾
- 替换当前选中文本
- 覆盖页面正文

MVP 默认建议使用“追加到页面末尾”。

## 常用命令

```bash
notion2cli daemon start --runtime codex
notion2cli daemon stop
notion2cli daemon status
notion2cli pair
notion2cli status
notion2cli doctor
notion2cli codex attach
notion2cli codex inspect
notion2cli codex open
notion2cli mcp install notion --runtime codex
```

## 状态和日志

`notion2cli` 会把状态和日志写到：

```text
~/.notion2cli/
```

常见位置：

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/state/artifacts/`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`

## 测试

```bash
npm test
npm run check
```

真机验证建议：

1. 准备一个 Notion 页面，包含一段指令和一张图片
2. 启动 Codex daemon 并完成浏览器配对
3. 点击“运行当前页”
4. 确认 Codex 直接开始处理
5. 确认回复回到插件面板
6. 运行 `notion2cli codex inspect`，确认 `Thread ID` 不变且 `App 可见：是`
7. 打开 Codex App，在最近会话里查看 `notion2CLI - notion2CLI`
8. 点击“写回 Notion”，确认结果追加到页面末尾

## 排错

### 点击“运行当前页”失败

优先检查：

- Codex daemon 是否正在运行
- 浏览器是否已配对
- Codex 的 Notion MCP 是否已安装并授权
- 当前 Notion 页面是否对 MCP 可读

可以运行：

```bash
notion2cli doctor
```

### 图片没有进入 Codex

当前图片只来自 `McpPageBundle` 里解析出的附件链接。不会再从浏览器 DOM 里额外抓图。

排查时看日志里的：

- `page bundle prepared`
- `input bundle prepared`
- `imageCount`
- `warnings`

### 还需要打开 Codex 终端吗？

不需要。

`notion2CLI` 会通过 Codex app-server 直接启动一轮处理。常规查看走 Codex App 和 `notion2cli codex inspect`；`notion2cli codex attach` 只保留为调试入口，不承诺 terminal 里手动说的话和插件上下文互相同步。

### 为什么 Codex App 里能看到同一个 session？

Codex runtime 会维护一个持久的 app-server thread。每次插件提交都会对同一个 `threadId` 调用 `turn/start`，完成后再用 `thread/read` 和 `thread/list` 校验该 thread 已经落进 Codex 的本地会话历史。插件面板里的“打开 Codex App”只负责打开 App；如果 App 没有自动跳转，请在最近会话里找 `notion2CLI - <项目名>`。

## 当前边界

- MVP 只正式支持 Codex
- 整页读取仍依赖 Codex runtime 的 Notion MCP
- 写回仍由 Codex 通过 Notion MCP 执行
- 文件附件暂未完整支持
- 插件和 bridge 之间仍使用 localhost HTTP
- Codex App 实时 UI 镜像不作为 MVP 承诺；MVP 承诺的是同一个 session 稳定进入 Codex App 历史
