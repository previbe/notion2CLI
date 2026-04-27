# notion2CLI

`notion2CLI` 的 MVP 只解决一件事：

**把 Notion 页面当作本地 AI CLI 会话的富文本输入框。**

在 Notion 页面里点击插件按钮后，插件会把当前选区或当前整页作为下一条用户输入交给本地会话，并直接开始处理。回复先回到插件面板，再由用户决定是否写回 Notion。

## 当前 MVP

已实现：

- 选中文本作为下一条输入运行
- 当前整页作为下一条输入运行
- 整页读取仍通过当前 runtime 的 Notion MCP 完成
- Notion 页面里的图片会作为本地图片工件交给 runtime
- 最新回复会回到插件面板
- Agent 可按任务提示词通过 Notion MCP 修改当前 Notion 页面
- 用户也可在设置里选择显示手动“写回 Notion”按钮作为 fallback
- Codex 会稳定复用同一个 Codex App 可见 session
- Claude Code 会通过 Channels 投递到 `notion2cli claude launch` 启动的当前终端会话

暂不做：

- bridge 自己直连 Notion API / MCP 读取页面
- bridge 自己确定性写回 Notion
- 完整文件附件支持
- Claude Desktop 输入注入
- Chrome Native Messaging
- Codex App、Claude 终端、插件之间的全双向历史同步

## 前置要求

本机需要：

- `Node.js`
- `npm`
- `Google Chrome`
- `Codex CLI` 或 `Claude Code`
- 一个已登录的 Notion 浏览器会话

确认命令存在：

```bash
node --version
npm --version
codex --version
claude --version
```

只使用其中一个 runtime 时，只需要对应 CLI 存在。

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

## 快速开始：Codex

```bash
notion2cli mcp install notion --runtime codex
notion2cli daemon start --runtime codex
notion2cli pair
```

然后：

1. 点击浏览器工具栏里的 `notion2CLI`
2. 粘贴 6 位配对码
3. 打开一个 Notion 页面
4. 点击 Activity 面板里的任务按钮，例如 `原文` 或 `Build`
5. 有选区时会处理选区，没有选区时会处理当前页全文

需要检查或打开同一个 Codex App session：

```bash
notion2cli codex inspect
notion2cli codex open
```

## 快速开始：Claude Code

Claude 不走后台 daemon。启动当前 Claude Code channel 会话：

```bash
notion2cli claude launch
```

这个命令会打开一个 Claude Code 终端会话，并加载 notion2CLI channel bridge。保持这个窗口开着，然后在另一个终端运行：

```bash
notion2cli pair
```

如果第一次整页读取需要 Notion 授权，Activity 面板会显示授权链接。写回仍由当前 Claude Code 会话通过 Notion MCP 执行。

检查当前 Claude channel 状态：

```bash
notion2cli claude inspect
```

## 使用说明

### 运行选中内容

有文本选区时，插件会发送：

- `selectionText`
- `pageUrl`
- `pageTitle`

bridge 会创建 job，把选区当作下一条用户输入交给当前 runtime。

### 运行当前页

没有文本选区时，bridge 会：

1. 借当前 runtime 的 Notion MCP 读取整页内容
2. 规范化为 `McpPageBundle`
3. 从 bundle 中解析图片附件链接
4. 下载并缓存本地图片工件
5. 把 `page bundle + 本地图片工件` 作为下一条用户输入交给当前 runtime

如果 page bundle 准备失败，本次运行会失败，不回退到浏览器 DOM 抓取。

### Build

`Build` 是内置的官方预制 prompt。它会把选中内容或当前页全文当作需求文档，让当前 Codex / Claude runtime 直接按文档要求执行开发。

执行完成后，最终结果会作为 Brief 显示在插件面板。Agent 只有在任务确实要求修改当前 Notion 页面时，才应该通过 Notion MCP 修改页面；普通 Build 任务通常只改本地代码，不改 Notion 正文。

### 自定义提示词

Activity 面板中的任务现在是按钮。点击 `原文`、`Build` 或自定义任务名会直接运行该任务；有选区时处理选区，没有选区时处理当前页全文。

点击 `管理` 可以新增、编辑、删除提示词。`Build` 可以修改或删除，也可以恢复官方默认版本。`原文` 是系统基础入口，不允许编辑或删除。

提示词由本地 bridge 统一管理，保存在：

```text
~/.notion2cli/prompts.json
```

### 写回 Notion

Agent 可以按当前任务提示词自行决定是否修改当前 Notion 页面。插件设置页的“写回设置”里可以控制是否显示手动“写回 Notion”按钮。

手动写回仍由 runtime 通过 Notion MCP 执行，支持：

- 追加到页面末尾
- 替换当前选中文本
- 覆盖页面正文

MVP 默认隐藏手动写回按钮。需要手动 fallback 时，可以在插件设置页打开它；写回模式默认建议使用“追加到页面末尾”。

## 常用命令

```bash
notion2cli daemon start --runtime codex
notion2cli daemon stop
notion2cli daemon status
notion2cli codex inspect
notion2cli codex open
notion2cli claude launch
notion2cli claude inspect
notion2cli pair
notion2cli status
notion2cli doctor
notion2cli mcp install notion --runtime codex
notion2cli mcp install notion --runtime claude
```

## 状态和日志

`notion2cli` 会把状态和日志写到：

```text
~/.notion2cli/
```

常见位置：

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/state/artifacts/`
- `~/.notion2cli/prompts.json`
- `~/.notion2cli/claude-channel.mcp.json`
- `~/.notion2cli/claude-worker.mcp.json`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`

## 测试

```bash
npm test
npm run check
```

真机验证建议：

1. 准备一个 Notion 页面，包含一段指令和一张图片
2. 启动 Codex daemon 或 `notion2cli claude launch`
3. 完成浏览器配对
4. 点击“运行当前页”
5. 确认 runtime 直接开始处理
6. 确认回复回到插件面板
7. 如已开启手动写回按钮，点击“写回 Notion”，确认结果按设置模式写入页面

## 当前边界

- Codex 使用 Codex App session；Claude 使用 Claude Code Channels
- Claude Desktop 目前只作为用户自己查看/操作的独立产品，不作为输入注入目标
- 整页读取仍依赖 runtime 的 Notion MCP
- 写回仍由 runtime 通过 Notion MCP 执行
- 文件附件暂未完整支持
- 插件和 bridge 之间仍使用 localhost HTTP
- Codex App 实时 UI 镜像不作为 MVP 承诺；MVP 承诺的是同一个 session 稳定进入 Codex App 历史
