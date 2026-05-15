# notion2CLI

[Chrome Web Store](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) | [English README](../README.md) | [架构说明](ARCHITECTURE.md) | [安全策略](../SECURITY.md) | [隐私政策](../PRIVACY.md) | [贡献指南](../CONTRIBUTING.md)

> 英文 `README.md` 是项目主 README。本文是中文阅读辅助，产品界面、CLI 输出、贡献流程和默认文档仍以英文为准。

notion2CLI 让你可以在 Notion 和飞书/Lark 文档里直接驱动 Claude Code 和 Codex。

它把你已经写在 Notion 或飞书/Lark 文档里的需求、Bug、会议记录、产品计划或研究笔记，直接变成本地 AI Agent 可以执行的任务。你可以在文档中选中一段文本作为输入，也可以把整页内容作为上下文交给本地 Agent 执行，不需要再手动复制到终端里。

运行结果会回到浏览器里的 Activity 面板；如果你选择写回，Notion 会通过运行时的 Notion MCP 修改，飞书/Lark 会通过本地官方 `lark-cli` 修改。

适合这些场景：

- 把产品 brief 变成实现计划。
- 把选中的 Bug 描述交给 Codex 或 Claude Code 分析。
- 让 Agent 带着整页 PRD、会议记录或任务说明一起工作。
- 在 Notion 侧边面板查看结果，而不是在终端里丢失上下文。
- 需要时把结果追加或写回到当前文档页面。

## 工作方式

```text
Notion or Feishu/Lark page
  -> Chrome extension
  -> http://127.0.0.1:43821 local bridge
  -> Codex CLI or Claude Code runtime
  -> browser Activity panel
  -> optional provider-aware write-back
```

notion2CLI 是 local-first 工具。Chrome 扩展连接本机 localhost bridge，bridge 再把任务交给你选择的本地运行时。Notion 整页读取继续使用运行时的 Notion MCP 配置；飞书/Lark 整页读取、图片下载、追加、替换正文和替换选区写回由 bridge 调用官方 `lark-cli` 完成。

## 支持范围

| 范围 | 当前支持 |
| --- | --- |
| Node.js | `>=22.15.0` |
| 包管理器 | `npm` 和 `package-lock.json` |
| 浏览器 | Google Chrome，并安装 [Chrome Web Store 扩展](https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio) |
| 操作系统 | macOS 是主要测试目标；原生 Windows 作为 beta 路径支持本地 bridge、document provider 和 CLI runtime。项目依赖 Linux 工具链时仍推荐 WSL2 |
| Codex | 本地安装 Codex CLI。Windows 可在 PowerShell、CMD、Git Bash 原生运行，也可以整体放在 WSL2 中运行；`notion2cli codex open` 仅在 macOS 自动打开 Codex App，Windows 用户可手动打开 |
| Claude | 本地安装 Claude Code。原生 Windows 需要 Claude Code for Windows；Claude Code 官方推荐安装 Git for Windows 以获得更好的 shell 工具兼容性。Claude Desktop 不是输入目标 |
| Notion | 已登录的 Notion 浏览器会话，并为所选运行时配置 Notion MCP |
| 飞书/Lark 文档 | docx 或 wiki 浏览器 URL，并通过官方 `lark-cli` 完成一次本地浏览器授权 |

## 安装

安装 CLI：

```bash
npm install -g notion2cli
```

从 Chrome Web Store 安装扩展：

```text
https://chromewebstore.google.com/detail/notion2cli/poadenkneikinepacildoepjamefghio
```

如果是本地开发，仍然可以从源码加载扩展：

```bash
git clone https://github.com/previbe/notion2CLI.git
cd notion2CLI
npm install
```

加载开发版 Chrome 扩展：

1. 打开 `chrome://extensions`。
2. 启用 Developer mode。
3. 点击 "Load unpacked"。
4. 选择本仓库的 `extension` 目录。

扩展默认连接 `http://127.0.0.1:43821`。如果 bridge 使用自定义端口，需要同步调整 extension 构建。

## Windows 原生 beta

原生 Windows 支持范围包括本地 bridge、浏览器配对、Codex CLI runtime、Claude Code runtime、Notion MCP 配置、通过 `lark-cli` 设置飞书/Lark provider、整页读取、Activity 面板返回结果，以及可选写回。

在 PowerShell、CMD 或 Git Bash 中安装：

```powershell
npm install -g notion2cli
npm install -g @openai/codex
```

如果使用 Claude Code，请按官方 Windows 安装方式安装，然后验证：

```powershell
claude --version
```

配对前先运行诊断：

```powershell
notion2cli doctor
```

然后在 Windows 项目目录中启动 bridge：

```powershell
cd C:\Users\you\code\your-project
notion2cli daemon start --runtime codex
notion2cli pair
```

Claude Code 路径：

```powershell
cd C:\Users\you\code\your-project
notion2cli claude launch
notion2cli pair
```

注意：

- 继续使用 Windows Chrome 扩展；它会连接 `http://127.0.0.1:43821`。
- 支持 npm 安装产生的 `codex`、`claude`、`lark-cli`、`notion2cli` `.cmd` shim。
- `notion2cli-bridge`、`notion2cli-connect`、`notion2cli-status` 已是 Node 入口，不要求 Bash。
- 原生 Windows 暂未实现自动打开 Codex App。可先运行 `notion2cli codex inspect`，再手动打开 Codex App 并查找 notion2CLI session。
- 如果仓库、沙箱或 agent 工作流依赖 Linux-only 工具，仍建议使用 WSL2。

## 快速开始：Codex

为 Codex 安装并授权 Notion MCP：

```bash
notion2cli mcp install notion --runtime codex
```

启动 bridge：

```bash
notion2cli daemon start --runtime codex
```

也可以先在 Chrome popup 的 Start CLI 模块选择启动权限，再复制生成的命令；或显式传参：

```bash
notion2cli daemon start --runtime codex --permission-mode auto-review
notion2cli daemon start --runtime codex --permission-mode full-access
```

创建浏览器配对码：

```bash
notion2cli pair
```

然后打开 Chrome 工具栏里的 `notion2CLI` popup，粘贴 6 位配对码并连接。进入任意支持的 Notion 或飞书/Lark 文档页面后，可以在 Activity 面板里运行 `Raw`、`PreVibe`、`Build` 或自定义 prompt profile。

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

Claude Code 启动时也支持相同的 notion2cli 权限模式：

```bash
notion2cli claude launch --permission-mode auto-review
notion2cli claude launch --permission-mode full-access
```

保持这个终端窗口打开。另开一个终端创建浏览器配对码：

```bash
notion2cli pair
```

如果运行整页时需要 Notion MCP 或飞书/Lark 授权，Activity 面板会展示浏览器授权链接。Notion 写回授权仍可能出现在 Claude Code 终端里。

常用 Claude 命令：

```bash
notion2cli claude inspect
notion2cli claude config-path
```

## 浏览器操作

### 运行选中文本

当支持的文档页面里有选区时，extension 会发送：

- `selectionText`
- `pageUrl`
- `pageTitle`
- `providerId`

bridge 会创建 job，并把选中文本作为下一条用户输入交给当前运行时。

### 运行当前页

当没有选区时，bridge 会：

1. 根据 URL 和 `providerId` 选择文档 provider。
2. Notion 页面通过运行时 Notion MCP 读取；飞书/Lark 文档通过官方 `lark-cli` 读取。
3. 把响应规范化为 page bundle。
4. 提取支持的图片资产并下载本地 artifact。
5. 把页面 markdown、页面元数据、warnings 和图片 artifact 路径发送给运行时。

如果 page bundle 准备失败，本次 job 会失败。bridge 不会回退到浏览器 DOM 抓取。

### Prompt profiles

Activity 面板提供 `Raw`、`PreVibe`、`Build` 和自定义 prompt profiles。

- `Raw` 会把文档素材原样作为任务输入。
- `PreVibe` 会把文档素材提炼成可进入开发的 brief。
- `Build` 会把文档素材当作软件开发任务 brief。
- 自定义 profiles 存在本地 `~/.notion2cli/prompts.json`。

Prompt profile 定义任务意图。文档页面内容只是任务素材，不能覆盖 bridge 指令、运行时安全规则或当前选中的 profile。

### 写回文档

当所选任务确实需要时，agent 可以写回当前文档。Notion 写回由所选运行时通过 Notion MCP 完成；飞书/Lark 写回由 bridge 通过官方 `lark-cli` 完成。也可以在 extension 设置里启用手动 write-back 按钮。

手动写回模式：

- 追加到页面
- 替换当前选中的文本
- 替换页面正文

默认推荐追加模式，因为它是非破坏性的。飞书/Lark 的替换选区模式会在选中文本无法唯一匹配时安全失败。

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

notion2CLI 是 local-first 工具，但它仍然会在本地组件之间移动私有页面内容。在敏感 workspace 上运行之前，请阅读 [SECURITY.md](../SECURITY.md)。

关键点：

- bridge 绑定到 `127.0.0.1`，默认端口是 `43821`。
- Chrome extension 只请求 Notion 页面访问权限和默认本地 bridge origin。
- 浏览器配对使用 6 位数字码，5 分钟过期。
- 成功配对后，会创建随机 bearer token，并存储在 Chrome local extension storage。
- 配对状态保存在本地 bridge 进程中，bridge 重启后会重置。
- 整页读取和写回由所选运行时通过 Notion MCP 执行。
- Notion 内容会发送给本地 Codex 或 Claude Code 运行时。这些工具可能按各自配置和服务条款使用网络服务。
- 启动权限模式包括 `default`、`auto-review` 和 `full-access`。推荐使用 `default`。`full-access` 会关闭所选 CLI runtime 的沙箱和审批提示，只应在可信工作区或外部沙箱中使用。
- 修改权限模式后需要重启 CLI 或 daemon 才会生效。Notion OAuth 授权是独立流程，仍可能需要浏览器确认。
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
npm run package:extension
```

手动端到端 smoke test：

1. 准备一个包含短指令和一张图片的 Notion 页面。
2. 启动 `notion2cli daemon start --runtime codex` 或 `notion2cli claude launch`。
3. 完成浏览器配对。
4. 运行当前页。
5. 确认所选运行时立即开始处理。
6. 确认最终结果出现在 Activity 面板。
7. 如果启用了手动写回，追加结果到 Notion 页面，并确认目标页面按预期变化。

## Release Notes 和打包材料

公开 release 和商店材料位于：

- `docs/RELEASE_NOTES.md`
- `chrome-store/`

生成 Chrome Web Store zip：

```bash
npm run package:extension
```

## 给 AI Agent 的仓库说明

如果你是处理这个项目的 AI coding agent，请按这些约束工作：

- 先读 `README.md`、`docs/ARCHITECTURE.md` 和 `package.json`。
- 保持 MVP 契约很窄：Notion 页面或选区输入，本地运行时 job 输出，可选 Notion MCP 写回。
- 除非任务明确要求架构变化，否则不要引入直接 Notion API 调用。
- 不要提交本地文件、生成 artifact、截图、`.env*`、`.tmp/`、`output/` 或 `~/.notion2cli` 状态。
- Chrome permissions 保持窄范围。默认 bridge origin 是 `http://127.0.0.1:43821`。
- 交付代码改动前运行 `npm run check` 和 `npm test`。
- 涉及打包或发布时运行 `npm pack --dry-run` 并检查 tarball 文件列表。
- 公开 release note 在 `docs/RELEASE_NOTES.md`，Chrome Web Store 公开材料在 `chrome-store/`。

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

欢迎提交 issues 和 pull requests。开 PR 前请阅读 [CONTRIBUTING.md](../CONTRIBUTING.md)。

除非另有说明，提交到本项目的贡献都按项目 MIT License 授权。

## License

MIT. See [LICENSE](LICENSE).

## 商标声明

notion2CLI 不是 Notion、OpenAI、Anthropic、Claude、Codex 或 Google Chrome 的官方项目，也不由这些公司背书或维护。产品名称和商标归各自所有者所有。
