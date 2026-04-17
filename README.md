# notion2CLI

`notion2CLI` 是一个本地优先的 MVP：你在浏览器版 Notion 中点一下按钮，把“选中的内容”或“整页内容”送进 Claude Code，并让当前 Claude 会话直接回答。

它不是云服务，也不是 Notion 官方插件。这个版本只验证一件事：**Notion 里的内容能否被可靠地送到 Claude，并拿回回复。**

它由三部分组成：

- 一个可通过开发者模式加载的 Chrome 扩展
- 一个本地 `channel bridge`
- 一个 Claude Code 本地 bridge 与项目内命令

## 这个版本能做什么

- 在 `notion.so` 页面注入一个悬浮按钮
- 把选中文本或整页内容发给 Claude
- 把 Claude 的回复回传到浏览器中的结果卡片

## 系统架构

```mermaid
flowchart LR
  A["Notion 页面按钮"] --> B["Chrome 扩展"]
  B --> C["本地 bridge (127.0.0.1:43821)"]
  C --> D["当前 Claude Code 会话"]
  D --> E["Notion 官方 MCP"]
  E --> F["Notion 工作区"]
  D --> G["reply tool"]
  G --> C
  C --> B
```

更详细说明见 [docs/ARCHITECTURE.md](/Users/morrow/coding/notion2CLI/docs/ARCHITECTURE.md)。

## 安装

### 1. 安装依赖

先进入项目目录，再安装依赖：

```bash
cd /Users/morrow/coding/notion2CLI
npm install
```

### 2. 启动 Claude Code

当前官方 `Channels` 仍处于 **research preview**。按照 Claude 官方文档，自定义 channel 在预览期内必须通过 `--dangerously-load-development-channels` 显式放行，不能完全省掉。来源：
[Channels reference](https://code.claude.com/docs/en/channels-reference)

但这个项目现在已经不再要求 `--plugin-dir`。进入项目目录后，直接启动：

```bash
cd /Users/morrow/coding/notion2CLI
claude --dangerously-load-development-channels server:notion2cli_bridge
```

这样做的原因是，这个仓库已经提供了项目级：

- `.mcp.json`
- `.claude/commands/*`

所以只要你在项目目录里运行 `claude`，命令和 bridge 配置都会自动生效。

### 3. 在 Claude Code 里装好 Notion 官方 MCP

官方文档：
[Connecting to Notion MCP](https://developers.notion.com/guides/mcp/get-started-with-mcp)

推荐命令：

```bash
claude mcp add --transport http notion https://mcp.notion.com/mcp
```

之后在 Claude Code 里用 `/mcp` 完成 OAuth。

### 4. 通过开发者模式加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择目录：`/Users/morrow/coding/notion2CLI/extension`

## 配对与使用

### 第一次连接

1. 在 Claude Code 中运行 `/notion2cli-connect`
2. Claude 会调用本地脚本并展示一个 6 位配对码
3. 点击浏览器工具栏中的 `notion2CLI`
4. 把配对码贴进去，点击“连接当前 Claude 会话”
5. 回到 Notion 页面，此时悬浮按钮会显示为“已连接”

如果扩展弹窗显示的是“已连接本地调试模式”，说明你现在连到的是 `npm run dev:standalone` 启动的模拟器，而不是当前 Claude 会话。这个状态下浏览器会收到模拟回执，但 Claude 终端不会收到真实的 channel 事件。

### 日常使用

1. 在浏览器里打开一个 Notion 页面
2. 可选：先选中一段文字
3. 点击右下角悬浮按钮
4. 点击“发送到 Claude”
5. Claude Code 当前会话会把这段内容当作输入并开始回答
6. 结果会出现在页面右下角的结果卡片里

## 调试

### 检查脚本语法

```bash
npm run check
```

### 独立启动 bridge（不接 Claude，仅做本地调试）

这个模式会模拟 Claude 回复，方便你先调浏览器侧交互。
不要在正式联调“当前 Claude 会话收消息”时同时运行它；正式使用时应直接启动 Claude，并让 Claude 自己加载 `notion2cli_bridge`。

```bash
npm run dev:standalone
```

### 在 Claude Code 里查看 bridge 状态

```bash
notion2cli-status
```

如果这里显示 `standalone: true`，就说明 127.0.0.1:43821 上当前跑的是本地模拟器，不是注入当前 Claude 会话的 bridge。

## 目录结构

```text
notion2CLI/
  .claude/
    commands/
      notion2cli-connect.md
      notion2cli-status.md
  .mcp.json
  bin/
    notion2cli-connect
    notion2cli-status
  docs/
    ARCHITECTURE.md
  extension/
    manifest.json
    background.js
    content-script.js
    content-style.css
    popup.html
    popup.js
    popup.css
  server/
    channel-server.mjs
  skills/
    connect/
      SKILL.md
```

## 当前 MVP 的边界

- 只支持浏览器版 Notion
- 只支持单机、本地 Claude Code 会话
- 配对状态按 Claude 会话生命周期管理；重启会话后需要重新配对
- 默认只把结果显示在浏览器卡片里，不自动写回 Notion
- 当前版本会把选中内容或整页内容当作当前 Claude 会话输入来回答，但还没有把回复写回 Notion 文档
- 依赖 Claude Code `Channels` 研究预览能力，因此启动时仍需 development channels 标志
