# notion2CLI

`notion2CLI` 是一个面向 `Claude Code` / `Codex CLI` 用户的本地 companion：你在浏览器版 Notion 里点一下按钮，把选中的内容或当前整页送进本地 agent runtime，并把结果回显到页面面板里。

当前产品由 3 部分组成：

- `CLI`：全局命令 `notion2cli`
- `daemon`：本地 bridge，负责配对、状态和后台任务
- `Chrome 扩展`：负责 Notion 页面入口和结果展示

支持两种运行时：

- `Claude Code`：当前会话模式
- `Codex CLI`：后台任务模式，由 daemon 调起 `codex exec`

## 当前状态

现在已经实机验证通过的链路：

- 全局 CLI 安装
- `Codex` daemon 启动、配对、选中文本处理
- `Codex` 通过 Notion MCP 读取整页
- `Claude` 启动命令和用户级配置生成

当前已知限制：

- `Codex` 的 **整页读取** 可用
- `Codex` 的 **写回 Notion** 当前可能失败  
原因是某些 Notion 写操作会在 `codex exec` 模式下触发交互确认，而 `exec` 模式不支持 `request_user_input`
- 如果你现在需要更稳定的写回能力，优先使用 `Claude Code` 模式

## 你能做什么

- 在 `notion.so` 页面注入一个悬浮按钮
- 把选中文本直接发给本地 runtime
- 未选中文本时，通过 Notion MCP 读取当前整页内容再交给 runtime 处理
- 把运行结果显示在 Notion 页面右下角结果卡片中
- 在支持的运行时里，把结果写回当前 Notion 页面
- 用 `standalone` 模式模拟整条链路，方便调浏览器交互

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

如果你只打算用其中一个 runtime，那么另一个没有安装也没关系。

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

安装完成后，在任意目录验证：

```bash
notion2cli --help
```

如果命令能执行，说明全局 CLI 已经装好。

### 3. 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择目录：`/Users/morrow/coding/notion2CLI/extension`

扩展加载后，浏览器工具栏里会出现 `notion2CLI` 图标。

## 本地状态目录

CLI 会把自己的状态和日志写到：

```text
~/.notion2cli/
```

常见文件：

- `~/.notion2cli/state/daemon.json`
- `~/.notion2cli/logs/daemon.log`
- `~/.notion2cli/logs/daemon.err.log`
- `~/.notion2cli/claude.mcp.json`

## 快速开始

### 最短 Codex 流程

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

### 最短 Claude 流程

```bash
notion2cli mcp install notion --runtime claude
notion2cli claude launch
```

再开一个终端：

```bash
notion2cli pair
```

然后和上面一样，在扩展里贴入配对码即可。

## 详细安装与使用

### 方案 A：使用 Codex CLI

### 第一步：给 Codex 安装 Notion MCP

```bash
notion2cli mcp install notion --runtime codex
```

这条命令会按需要执行：

- `codex mcp add notion --url https://mcp.notion.com/mcp`
- `codex mcp login notion`

如果浏览器弹出 OAuth 授权页，按流程授权即可。

### 第二步：启动 notion2CLI daemon

```bash
notion2cli daemon start --runtime codex
```

查看 daemon 是否起来：

```bash
notion2cli daemon status
```

正常情况下会看到类似：

```text
notion2cli daemon 正在运行。
地址：http://127.0.0.1:43821
运行时：Codex CLI
```

### 第三步：生成配对码

```bash
notion2cli pair
```

你会拿到一个 6 位数字，例如：

```text
运行时：Codex CLI
配对码：123456
有效期至：2026-04-19T09:01:41.995Z
```

### 第四步：在扩展里完成配对

1. 点击 Chrome 工具栏中的 `notion2CLI`
2. 在输入框里粘贴 6 位配对码
3. 点击连接

连接成功后，扩展会显示当前 bridge 已连接。

### 第五步：在 Notion 页面里使用

进入一个 `https://www.notion.so/...` 页面后：

- 如果你先选中了一段文字，按钮会走“发送选中内容”
- 如果你没有选中文本，按钮会走“发送整页（MCP）”

结果会显示在页面右下角结果卡片里。

### 第六步：结束 daemon

不用时可以关闭：

```bash
notion2cli daemon stop
```

### 关于 Codex 进程的关闭

这里要区分两种进程：

- 你自己手动打开的 `codex` 交互 TUI
- `notion2cli daemon start --runtime codex` 启动的后台 daemon

它们不是同一个东西。

如果你手动运行了：

```bash
codex
```

那就是一个普通交互会话。关闭方式是：

- 在终端里按 `Ctrl+C`
- 或输入 `exit`
- 或直接关闭那个终端窗口

如果你运行的是：

```bash
notion2cli daemon start --runtime codex
```

那启动的是 `notion2cli` 的后台 bridge。它会在后台持续运行，直到你主动停止。

正确关闭命令是：

```bash
notion2cli daemon stop
```

如果你不手动关闭，它会一直在后台监听本地端口 `127.0.0.1:43821`，等待浏览器扩展发来新任务。

你可以随时查看它是否还在运行：

```bash
notion2cli daemon status
```

### 方案 B：使用 Claude Code

### 第一步：给 Claude 安装 Notion MCP

```bash
notion2cli mcp install notion --runtime claude
```

这条命令会执行：

```bash
claude mcp add --scope user --transport http notion https://mcp.notion.com/mcp
```

如果后续需要授权，按 Claude 会话里的提示完成。

### 第二步：启动 Claude 会话

```bash
notion2cli claude launch
```

这条命令会自动生成用户级配置文件：

```text
~/.notion2cli/claude.mcp.json
```

然后用下面这套参数启动 Claude：

- `--mcp-config ~/.notion2cli/claude.mcp.json`
- `--dangerously-load-development-channels server:notion2cli_bridge`

如果你只想看它会执行什么命令，可以先跑：

```bash
notion2cli claude launch --print
```

### 第三步：生成配对码

另开一个终端执行：

```bash
notion2cli pair
```

然后像 Codex 流程一样，在浏览器扩展里输入 6 位配对码。

### 第四步：在 Notion 页面里使用

用法和 Codex 完全相同：

- 选中文字后点“发送选中内容”
- 不选中文字时点“发送整页（MCP）”

如果当前运行时支持写回，也可以点“写回 Notion”。

### 方案 C：只做本地联调

如果你只是想调扩展和 bridge，不想连真实 Claude/Codex：

```bash
notion2cli daemon start --runtime standalone
notion2cli pair
```

这个模式下：

- 选区和页面按钮仍然可用
- 会返回模拟结果
- 不会调用真实 Claude/Codex
- 不会调用真实 Notion MCP

## 日常使用流程

### Codex

1. `notion2cli daemon start --runtime codex`
2. `notion2cli pair`
3. 在扩展里输入 6 位配对码
4. 打开 Notion 页面
5. 选中文字后点“发送选中内容”，或不选中文字时点“发送整页（MCP）”
6. 查看右下角结果卡片
7. 用完后执行 `notion2cli daemon stop`

### Claude

1. `notion2cli claude launch`
2. `notion2cli pair`
3. 在扩展里输入 6 位配对码
4. 打开 Notion 页面并触发动作

## 常用命令

```bash
notion2cli --help
notion2cli doctor
notion2cli status
notion2cli pair
notion2cli daemon start --runtime codex
notion2cli daemon start --runtime standalone --foreground
notion2cli daemon status
notion2cli daemon stop
notion2cli claude launch
notion2cli claude launch --print
notion2cli claude config-path
notion2cli mcp install notion --runtime codex
notion2cli mcp install notion --runtime claude
```

兼容包装命令仍然保留：

- `notion2cli-bridge`
- `notion2cli-connect`
- `notion2cli-status`

仓库内开发脚本也还保留：

- `npm run bridge:codex`
- `npm run dev:standalone`
- `npm run pair`
- `npm run status`
- `npm run doctor`

## 诊断与排错

### 看 bridge 当前状态

```bash
notion2cli status
```

### 看 daemon 当前状态

```bash
notion2cli daemon status
```

### 做一次全链路体检

```bash
notion2cli doctor
```

它会检查：

- `notion2cli` home 目录
- daemon 是否在运行
- `claude` / `codex` 是否可执行
- Claude / Codex 的 Notion MCP 状态
- Claude launch 配置是否已经生成

### 如果提示 “bridge 不可达”

先看：

```bash
notion2cli daemon status
```

如果是 `Codex`：

```bash
notion2cli daemon start --runtime codex
```

如果是 `Claude`：

```bash
notion2cli claude launch
```

### 如果提示 “浏览器还没有和 bridge 连接”

重新生成配对码：

```bash
notion2cli pair
```

再去扩展弹窗里输入新的 6 位数字。

### 如果 Codex 整页读取失败

先确认 MCP：

```bash
notion2cli mcp install notion --runtime codex
notion2cli doctor
```

### 如果 Codex 写回失败

这通常不是 bridge 配对问题，而是当前 `codex exec` 模式下的 Notion 写操作触发了交互确认。

这是当前版本的已知限制。建议：

- 优先用 `Claude Code` 做写回
- 或者先用 `Codex` 做读取和生成，再手动把结果贴回 Notion

### 如果你想确认 Codex 后台进程有没有关掉

先看：

```bash
notion2cli daemon status
```

如果显示 daemon 仍在运行，执行：

```bash
notion2cli daemon stop
```

注意：

- `notion2cli daemon stop` 只会停止 notion2CLI 的后台 daemon
- 它不会替你关闭一个你手动打开的 `codex` 交互窗口

### 如果全局命令找不到

重新安装：

```bash
cd /Users/morrow/coding/notion2CLI
npm install -g .
```

如果你本地改了代码，也需要重新执行一次这条命令，让全局 CLI 指向最新版本。

## 架构

详细说明见 [docs/ARCHITECTURE.md](/Users/morrow/coding/notion2CLI/docs/ARCHITECTURE.md)。

当前核心结构是：

- `server/core/*`：runtime-neutral 的协议、状态机和 HTTP API
- `server/runtimes/*`：Claude / Codex / Standalone 三个适配层
- `cli/*`：全局 CLI、daemon 生命周期、doctor、用户目录管理
- `extension/*`：浏览器入口和结果展示

## 边界

- 只支持浏览器版 Notion
- 只支持单机、本地 runtime
- Claude 模式依赖 `Channels` 研究预览能力
- Codex 模式当前不复用已打开的交互 TUI
- 整页读取和写回依赖当前 runtime 中已配置并已授权的 Notion 官方 MCP
- 选中内容仍然来自浏览器选区，不通过 MCP 获取当前高亮范围
- `Codex` 写回当前有已知限制，不应在 README 里假设它稳定可用
