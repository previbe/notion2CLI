# notion2CLI

[English README](README.md) | [架构说明](docs/ARCHITECTURE.md) | [安全策略](SECURITY.md) | [贡献指南](CONTRIBUTING.md)

> 英文 `README.md` 是项目主 README。本文是中文阅读辅助，产品界面、CLI 输出、贡献流程和默认文档仍以英文为准。

notion2CLI 把 Notion 页面变成本地 Codex 或 Claude Code 会话的富文本输入界面。

它是一个本地优先的桥接工具，连接你机器上的三部分：

- Chrome 里的 Notion 页面
- 一个很小的 localhost bridge
- 本地 AI 编程运行时，目前支持 Codex CLI 和 Claude Code

你可以在 Notion 中选中文本，也可以直接运行整页。notion2CLI 会把这些内容作为下一条用户请求发送给当前本地运行时，结果会回到浏览器里的 Activity 面板。如果任务确实需要更新 Notion 页面，运行时可以通过 Notion MCP 写回。

## 项目状态

这是早期 MVP，核心契约刻意保持很窄：

- 把 Notion 选中文本作为下一条运行时输入。
- 把当前 Notion 页面作为下一条运行时输入。
- 通过运行时的 Notion MCP server 读取整页内容。
- 将 Notion 页面图片缓存为本地 artifact 后交给运行时。
- 把最新 assistant 结果返回到浏览器面板。
- 只有当任务确实需要时，才让运行时通过 Notion MCP 写回 Notion。
- Codex 会复用稳定、可在 Codex App 中看到的 session。
- Claude 任务会投递到 `notion2cli claude launch` 启动的当前终端会话。

当前 MVP 暂不做：

- bridge 直接访问 Notion API。
- bridge 自己确定性写回 Notion。
- 完整通用文件附件支持。
- Claude Desktop 输入注入。
- Chrome Native Messaging。
- extension、bridge、Codex App、Claude terminal 之间的完整双向历史同步。

## 工作方式

```text
Notion page
  -> Chrome extension
  -> http://127.0.0.1:43821 local bridge
  -> Codex CLI or Claude Code runtime
  -> browser Activity panel
  -> optional Notion write-back through Notion MCP
```

浏览器扩展不会抓取完整 Notion DOM。运行整页时，bridge 会要求当前运行时通过 Notion MCP 读取页面，规范化结果，下载支持的图片 artifact，然后把结构化 prompt 和本地图片路径发送给运行时。

## 支持范围

| 范围 | 当前支持 |
| --- | --- |
| Node.js | `>=22.15.0` |
| 包管理器 | `npm` 和 `package-lock.json` |
| 浏览器 | Google Chrome，手动加载 Manifest V3 extension |
| 操作系统 | macOS 是主要测试目标；Linux 和 Windows 暂未正式支持 |
| Codex | 本地安装 Codex CLI；`notion2cli codex open` 仅支持 macOS |
| Claude | 本地安装 Claude Code；Claude Desktop 不是输入目标 |
| Notion | 已登录的 Notion 浏览器会话，并为所选运行时配置 Notion MCP |

## 从源码安装

npm 包元数据已经准备好。在第一次正式发布之前，先从仓库安装：

```bash
git clone https://github.com/previbe/notion2CLI.git
cd notion2CLI
npm install
npm install -g .
```

加载 Chrome 扩展：

1. 打开 `chrome://extensions`。
2. 启用 Developer mode。
3. 点击 "Load unpacked"。
4. 选择本仓库的 `extension` 目录。

扩展默认连接 `http://127.0.0.1:43821`。如果 bridge 使用自定义端口，需要同步调整 extension 构建。

## 快速开始：Codex

为 Codex 安装并授权 Notion MCP：

```bash
notion2cli mcp install notion --runtime codex
```

启动 bridge：

```bash
notion2cli daemon start --runtime codex
```

创建浏览器配对码：

```bash
notion2cli pair
```

然后打开 Chrome 工具栏里的 `notion2CLI` popup，粘贴 6 位配对码并连接。进入任意 Notion 页面后，可以在 Activity 面板里运行 `Raw`、`Build` 或自定义 prompt profile。

常用 Codex 命令：

```bash
notion2cli daemon status
notion2cli codex inspect
notion2cli codex open
notion2cli daemon stop
```

## 快速开始：Claude Code

Claude Code 使用前台 channel session，不走后台 daemon：

```bash
notion2cli claude launch
```

保持这个终端窗口打开。另开一个终端创建浏览器配对码：

```bash
notion2cli pair
```

如果运行整页时需要 Notion MCP 授权，Activity 面板会展示浏览器授权链接。写回授权仍可能出现在 Claude Code 终端里。

常用 Claude 命令：

```bash
notion2cli claude inspect
notion2cli claude config-path
```

## 浏览器操作

### 运行选中文本

当 Notion 页面里有选区时，extension 会发送：

- `selectionText`
- `pageUrl`
- `pageTitle`

bridge 会创建 job，并把选中文本作为下一条用户输入交给当前运行时。

### 运行当前页

当没有选区时，bridge 会：

1. 要求运行时通过 Notion MCP server 读取页面。
2. 把响应规范化为 `McpPageBundle`。
3. 提取支持的图片资产。
4. 下载本地图片 artifact。
5. 把页面 markdown、页面元数据、warnings 和图片 artifact 路径发送给运行时。

如果 page bundle 准备失败，本次 job 会失败。bridge 不会回退到浏览器 DOM 抓取。

### Prompt profiles

Activity 面板提供 `Raw`、`Build` 和自定义 prompt profiles。

- `Raw` 会把 Notion 素材原样作为任务输入。
- `Build` 会把 Notion 素材当作软件开发任务 brief。
- 自定义 profiles 存在本地 `~/.notion2cli/prompts.json`。

Prompt profile 定义任务意图。Notion 页面内容只是任务素材，不能覆盖 bridge 指令、运行时安全规则或当前选中的 profile。

### 写回 Notion

当所选任务确实需要时，agent 可以通过 Notion MCP 更新当前 Notion 页面。也可以在 extension 设置里启用手动 Write to Notion 按钮。

手动写回模式：

- 追加到页面
- 替换当前选中的文本
- 替换页面正文

默认推荐追加模式，因为它是非破坏性的。

## 本地状态

运行时状态、日志、prompt profiles 和缓存 artifact 位于：

```text
~/.notion2cli/
```

常见路径：

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/state/artifacts/`
- `~/.notion2cli/prompts.json`
- `~/.notion2cli/claude-channel.mcp.json`
- `~/.notion2cli/claude-worker.mcp.json`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`

## 安全模型

notion2CLI 是 local-first 工具，但它仍然会在本地组件之间移动私有页面内容。在敏感 workspace 上运行之前，请阅读 [SECURITY.md](SECURITY.md)。

关键点：

- bridge 绑定到 `127.0.0.1`，默认端口是 `43821`。
- Chrome extension 只请求 Notion 页面访问权限和默认本地 bridge origin。
- 浏览器配对使用 6 位数字码，5 分钟过期。
- 成功配对后，会创建随机 bearer token，并存储在 Chrome local extension storage。
- 配对状态保存在本地 bridge 进程中，bridge 重启后会重置。
- 整页读取和写回由所选运行时通过 Notion MCP 执行。
- Notion 内容会发送给本地 Codex 或 Claude Code 运行时。这些工具可能按各自配置和服务条款使用网络服务。
- 远程图片下载有数量和大小限制，默认阻止私有网络图片 URL。

## 开发

```bash
npm install
npm run check
npm test
```

涉及发布或打包的改动，还应运行：

```bash
npm audit --audit-level=moderate
npm pack --dry-run
npm publish --dry-run --access public
```

手动端到端 smoke test：

1. 准备一个包含短指令和一张图片的 Notion 页面。
2. 启动 `notion2cli daemon start --runtime codex` 或 `notion2cli claude launch`。
3. 完成浏览器配对。
4. 运行当前页。
5. 确认所选运行时立即开始处理。
6. 确认最终结果出现在 Activity 面板。
7. 如果启用了手动写回，追加结果到 Notion 页面，并确认目标页面按预期变化。

## 给 AI Agent 的仓库说明

如果你是处理这个项目的 AI coding agent，请按这些约束工作：

- 先读 `README.md`、`docs/ARCHITECTURE.md` 和 `package.json`。
- 保持 MVP 契约很窄：Notion 页面或选区输入，本地运行时 job 输出，可选 Notion MCP 写回。
- 除非任务明确要求架构变化，否则不要引入直接 Notion API 调用。
- 不要提交本地文件、生成 artifact、截图、`.env*`、`.tmp/`、`output/` 或 `~/.notion2cli` 状态。
- Chrome permissions 保持窄范围。默认 bridge origin 是 `http://127.0.0.1:43821`。
- 交付代码改动前运行 `npm run check` 和 `npm test`。
- 涉及打包或发布时运行 `npm pack --dry-run` 并检查 tarball 文件列表。

常用文件地图：

- CLI 入口：`bin/notion2cli.mjs`
- CLI helpers：`cli/`
- bridge server：`server/bridge-server.mjs`
- core job 和 HTTP logic：`server/core/`
- runtime adapters：`server/runtimes/`
- Chrome extension：`extension/`
- 架构说明：`docs/ARCHITECTURE.md`
- 测试：`test/`

## 贡献

欢迎提交 issues 和 pull requests。开 PR 前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

除非另有说明，提交到本项目的贡献都按项目 MIT License 授权。

## License

MIT. See [LICENSE](LICENSE).

## 商标声明

notion2CLI 不是 Notion、OpenAI、Anthropic、Claude、Codex 或 Google Chrome 的官方项目，也不由这些公司背书或维护。产品名称和商标归各自所有者所有。
