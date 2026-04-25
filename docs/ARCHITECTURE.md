# notion2CLI 架构说明

## MVP 目标

当前 MVP 只做一件事：

**把 Notion 页面变成 Codex CLI 的富文本输入框。**

用户在 Notion 页面点击插件按钮后，系统把当前选区或当前整页作为下一条用户输入交给 Codex，并直接开始处理。终端界面只用于可选观察，不是必需操作步骤。

## 不做的事

MVP 暂不做：

- “只附加到当前会话、等待用户稍后追问”的模式
- `/api/session/deliver` 这类 context-only 投递接口
- bridge 自己直连 Notion API / MCP 读取页面
- bridge 自己确定性写回 Notion
- 完整文件附件支持
- Claude Code 与 Codex 的同等 live session 体验
- Chrome Native Messaging

## 第一性原理

Notion 输入框能承载：

- 文本
- 图片
- 文件

Codex 当前 MVP 实际稳定消费的是：

- 文本
- 本地图片工件

所以 bridge 的核心职责是把 Notion 页面整理成 Codex 能消费的输入，而不是让浏览器模拟复制粘贴，也不是让用户回终端手动确认。

## 总体架构

```mermaid
flowchart LR
  A["Notion 页面"] --> B["Chrome 扩展"]
  B --> C["Bridge HTTP API /api/jobs"]
  C --> D["JobStore"]
  C --> E["RuntimeBackedNotionPageBundleProvider"]
  E --> F["McpPageBundle"]
  F --> G["ArtifactResolver / ArtifactStore"]
  G --> H["InputBundle"]
  H --> I["CodexRuntime"]
  I --> J["CodexLiveSession"]
  J --> K["Codex app-server turn/start"]
  K --> L["Codex CLI"]
  L --> M["插件 Activity 面板"]
  L --> N["Notion MCP"]
  N --> O["Notion 页面"]
```

## 主流程

### 1. 运行选中内容

1. 内容脚本读取当前选区、页面标题和页面 URL
2. background 调 `/api/jobs`
3. bridge 创建 job
4. bridge 生成 `InputBundle`
5. `CodexRuntime` 把输入放入 `CodexLiveSession` 队列
6. `CodexLiveSession` 调 Codex app-server 的 `turn/start`
7. 插件轮询 `/api/jobs/:id`，展示最终回复

### 2. 运行当前页

1. 内容脚本发送页面标题和页面 URL
2. bridge 通过 `RuntimeBackedNotionPageBundleProvider` 借 Codex 的 Notion MCP 读取整页
3. bridge 规范化为 `McpPageBundle`
4. `ArtifactResolver` 从 bundle 中找图片附件
5. `ArtifactStore` 下载并缓存本地图片工件
6. `InputBundle` 合并页面正文、图片工件和警告信息
7. `CodexLiveSession` 通过 `turn/start` 直接启动处理
8. 插件显示 Codex 最新回复

如果 page bundle 准备失败，整页运行直接失败，不回退到浏览器 DOM 抓取。

### 3. 写回 Notion

1. 插件面板已有最新 Codex 回复
2. 用户点击“写回 Notion”
3. 插件再次创建 `write_reply_to_notion` job
4. Codex 通过 Notion MCP 执行追加、替换选区或覆盖正文
5. 需要授权时，插件面板显示 approval 操作

MVP 默认建议只使用非破坏性的“追加到页面末尾”。

## 分层职责

### Chrome 扩展

负责：

- 显示页面内 Activity 面板
- 发起“运行选中内容 / 运行当前页”
- 展示 job 状态、approval、最新回复
- 发起手动写回

不负责：

- 抓整页 DOM 正文
- 从 DOM 发现图片
- 下载图片
- OCR

相关代码：

- [extension/content-script.js](/Users/morrow/coding/notion2CLI/extension/content-script.js)
- [extension/background.js](/Users/morrow/coding/notion2CLI/extension/background.js)
- [extension/popup.js](/Users/morrow/coding/notion2CLI/extension/popup.js)

### Bridge Core

负责：

- pairing
- HTTP API
- job 生命周期
- page bundle 预取
- 图片 artifact 下载与缓存
- runtime 输入装配

相关代码：

- [server/core/bridge-app.mjs](/Users/morrow/coding/notion2CLI/server/core/bridge-app.mjs)
- [server/core/http-server.mjs](/Users/morrow/coding/notion2CLI/server/core/http-server.mjs)
- [server/core/job-store.mjs](/Users/morrow/coding/notion2CLI/server/core/job-store.mjs)
- [server/core/schemas.mjs](/Users/morrow/coding/notion2CLI/server/core/schemas.mjs)
- [server/core/mcp-page-bundle.mjs](/Users/morrow/coding/notion2CLI/server/core/mcp-page-bundle.mjs)
- [server/core/page-bundle-provider.mjs](/Users/morrow/coding/notion2CLI/server/core/page-bundle-provider.mjs)
- [server/core/artifact-resolver.mjs](/Users/morrow/coding/notion2CLI/server/core/artifact-resolver.mjs)
- [server/core/artifact-store.mjs](/Users/morrow/coding/notion2CLI/server/core/artifact-store.mjs)
- [server/core/input-bundle.mjs](/Users/morrow/coding/notion2CLI/server/core/input-bundle.mjs)

### Codex Runtime

负责：

- 启动 Codex app-server
- 持有可恢复的 Codex thread
- 将每个插件请求作为新 turn 执行
- 捕获最新 assistant final answer
- 支持 approval 回调
- 为 thread 设置稳定标题 `notion2CLI - <项目名>`
- 每个 turn 完成后用 `thread/read` 和 `thread/list` 校验同一个 Codex App 可见 session

相关代码：

- [server/runtimes/codex-runtime.mjs](/Users/morrow/coding/notion2CLI/server/runtimes/codex-runtime.mjs)
- [server/runtimes/codex-live-session.mjs](/Users/morrow/coding/notion2CLI/server/runtimes/codex-live-session.mjs)
- [server/runtimes/codex-app-server-session.mjs](/Users/morrow/coding/notion2CLI/server/runtimes/codex-app-server-session.mjs)

## 核心对象

### McpPageBundle

整页 Notion 内容的统一表达：

- `pageUrl`
- `pageTitle`
- `markdown`
- `warnings`
- `assets`
- `stats`
- `provider`
- `runtimeId`

### Artifact

从 bundle 附件链接落地出来的本地工件。MVP 主要处理图片：

- `sourceUrl`
- `cachePath`
- `mimeType`
- `sizeBytes`
- `sha256`
- `width`
- `height`

### InputBundle

最终交给 Codex 的输入对象：

- `pageContext`
- `request`
- `pageBundle`
- `images`
- `warnings`
- `artifactSource`
- `cacheDir`

## API 边界

MVP 主 API：

- `GET /api/status`
- `POST /api/pair/create`
- `POST /api/pair/confirm`
- `POST /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/approval`
- `POST /api/session/open`

`GET /api/status` 会返回当前 Codex session 信息，包括 `threadId`、`threadName`、`turnCount`、`appVisible`、最近用户输入和最近助手回复。`notion2cli codex inspect` 用这些字段检查插件是否仍在复用同一个 Codex App session。`POST /api/session/open` 只负责打开 Codex App，不依赖私有 deep link。

MVP 已移除：

- `POST /api/session/deliver`
- `thread/inject_items` context-only 投递路径

## 日志边界

关键日志点：

1. `job created`
2. `page bundle prepared`
3. `input bundle prepared`
4. `codex_live_session_queued`
5. `codex_live_session_running`
6. `codex_live_session_completed`

排错时优先看：

- page bundle 是否准备成功
- `imageCount` 是否符合预期
- artifact 下载是否有 `warnings`
- Codex turn 是否进入 running / completed

## 当前边界

- 只正式支持 Codex MVP
- 整页读取仍依赖 Codex runtime 的 Notion MCP
- 图片只来自 `McpPageBundle` 中解析出的附件链接
- 写回仍由 Codex 通过 Notion MCP 完成
- 文件附件暂未完整支持
- 插件和 bridge 之间仍使用 localhost HTTP

这些边界是为了最快验证核心问题：Notion 能否成为 CLI Agent 的输入框。
