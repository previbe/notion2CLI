# notion2CLI

`notion2CLI` 是一个面向 `Claude Code` / `Codex CLI` 用户的本地 companion：

- 浏览器扩展负责 Notion 页面入口
- 本地 daemon 负责配对、状态、任务分发
- `Claude Code` / `Codex CLI` 负责真正执行内容理解和写回

当前实现只保留 3 条运行路径：

- `Claude Code` dedicated daemon
- `Codex CLI` dedicated daemon
- `standalone` 调试模拟器

当前版本已经移除了旧的 `Claude legacy channel` 路径，也不再保留 browser-only 图片主路径或 `pageImages` fallback。

## 当前实现

### 纯文本和整页的处理方式

- 选中文本：浏览器直接把选区发给 bridge
- 整页：bridge 会先借当前 runtime 的 Notion MCP 预取统一的 `McpPageBundle`
- 图片：bridge 只使用 `McpPageBundle` 里解析出的附件链接来落地本地图片工件，再把这些本地工件注入 `Claude` / `Codex`

这意味着：

- 整页内容不会再走浏览器 DOM 抓取
- 图片也不会再靠浏览器侧发现的 `img[src]` 旁路传输
- 浏览器不做 OCR

## 前置要求

开始前，请确认你本机已经有：

- `Node.js`
- `npm`
- `Google Chrome`
- `Claude Code` 或 `Codex CLI`
- 一个已登录的 `Notion` 浏览器会话

建议先确认命令存在：

```bash
node --version
npm --version
claude --version
codex --version
```

## 安装

### 1. 安装仓库依赖

```bash
cd /Users/morrow/coding/notion2CLI
npm install
```

### 2. 安装全局 CLI

```bash
npm install -g .
```

验证：

```bash
notion2cli --help
```

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择目录：`/Users/morrow/coding/notion2CLI/extension`

## 本地状态目录

`notion2cli` 会把状态和日志写到：

```text
~/.notion2cli/
```

常见目录：

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/state/artifacts/`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`

## 快速开始

### Codex

```bash
notion2cli mcp install notion --runtime codex
notion2cli daemon start --runtime codex
notion2cli pair
```

然后：

1. 点击浏览器工具栏中的 `notion2CLI`
2. 粘贴 6 位配对码
3. 打开一个 Notion 页面
4. 选中文字后点击“发送选中内容”，或者不选中文字时点击“发送整页（MCP）”

### Claude

```bash
notion2cli mcp install notion --runtime claude
notion2cli daemon start --runtime claude
notion2cli pair
```

后续浏览器操作和 `Codex` 相同。

### Standalone

```bash
notion2cli daemon start --runtime standalone --foreground
notion2cli pair
```

这个模式只用于调浏览器交互，不会调用真实的 `Claude` / `Codex` / Notion MCP。

## 常用命令

```bash
notion2cli daemon start --runtime claude
notion2cli daemon start --runtime codex
notion2cli daemon start --runtime standalone --foreground
notion2cli daemon stop
notion2cli daemon status
notion2cli pair
notion2cli status
notion2cli doctor
notion2cli mcp install notion --runtime claude
notion2cli mcp install notion --runtime codex
```

## 使用说明

### 发送选中内容

当页面里有选区时，扩展会发送：

- `selectionText`
- `pageUrl`
- `pageTitle`

如果当前页 bundle 里已经有图片工件，也会一并注入 runtime。

### 发送整页（MCP）

当页面里没有选区时，bridge 会：

1. 借当前 runtime 的 Notion MCP 预取整页内容
2. 规范化为 `McpPageBundle`
3. 从 bundle 中解析附件链接
4. 下载并缓存图片工件
5. 把 `page bundle + 本地图片工件` 一起交给 runtime

如果 bridge 无法预取 page bundle，这次整页请求会直接失败，不再回退到旧的浏览器抓取路径。

### 写回 Notion

结果面板支持 3 种写回模式：

- `追加为新 section`
- `替换当前选中文本`
- `覆盖整页正文`

`Codex` 写回时如果 MCP 需要人工确认，面板会进入“等待确认”，你需要点击“允许继续”。

## 如何测试

### 1. 运行自动化测试

```bash
npm test
npm run check
```

### 2. 真机验证整页 + 图片

建议先准备一个简单的 Notion 测试页：

- 一行文本，例如：`请读出图片中的单词`
- 一张只有一个明显英文单词的图片，例如：`RED-ALPHA`

然后分别测试 `Codex` 和 `Claude`：

```bash
notion2cli daemon stop
notion2cli daemon start --runtime codex --foreground
notion2cli pair
```

在扩展里完成配对后：

1. 不选中文字
2. 点击“发送整页（MCP）”
3. 确认返回结果能准确读出图片里的词

再切到 `Claude` 重复同样流程：

```bash
notion2cli daemon stop
notion2cli daemon start --runtime claude --foreground
notion2cli pair
```

### 3. 真机验证写回

在已经得到回复后，点击“写回 Notion”，再分别验证：

- 追加模式
- 替换选区模式
- 覆盖整页模式

## 排错

### `notion2cli daemon start --runtime codex` 后不需要再单独开一个 Codex TUI 吗？

对当前 dedicated 模式来说，不需要。

`notion2cli` 会自己在后台调用 `Codex` / `Claude`。你手动打开一个独立 CLI 会话也可以，但它不会和插件请求共享上下文。

### daemon 会一直运行吗？

会。只要你执行了：

```bash
notion2cli daemon start --runtime codex
```

或：

```bash
notion2cli daemon start --runtime claude
```

它就会一直在后台监听，直到你主动停止：

```bash
notion2cli daemon stop
```

### 整页请求失败，提示 page bundle 无法准备

这说明 bridge 没能借当前 runtime 的 Notion MCP 预取到整页内容。优先检查：

- 当前 runtime 的 Notion MCP 是否已安装
- 是否已登录到正确 workspace
- 当前页面是否对该 MCP 上下文可读

先运行：

```bash
notion2cli doctor
```

### 图片仍然读不到

先区分两种情况：

1. `Notion MCP` 能读正文，但 bundle 没有任何图片工件  
   这通常说明页面里的图片块没有出现在当前 page bundle 里，或者预签名链接已经失效

2. bundle 有图片，但本地工件下载失败  
   这通常会在结果里看到明确警告

当前版本已经移除了浏览器 DOM 图片旁路，所以不要再按“扩展是否抓到了页面图片”来排查。

## 当前边界

- 当前主路径都是 `dedicated daemon`
- 插件请求不会和你手动打开的 `Claude` / `Codex` 会话共享上下文
- 整页能力依赖当前 runtime 的 Notion MCP
- 页面图片能力依赖 `McpPageBundle` 中能否拿到有效附件链接

如果后续要做“会话附着”，应该建立在当前这条 bundle-first 主路径之上，而不是重新引入旧的旁路兼容层。
