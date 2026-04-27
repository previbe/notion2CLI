# Contributing to notion2CLI

感谢你愿意参与改进 notion2CLI。这个项目接受 issue、文档改进、bug fix、测试补充和功能 PR。

## 贡献授权

除非你在提交时明确说明，否则你提交到本项目的代码、文档和其他贡献，都会按照本项目的 MIT License 授权。

请只提交你有权授权的内容。不要提交私有 Notion 页面内容、访问令牌、API key、本地配置文件、日志里的敏感信息，或来自第三方且许可证不兼容的素材。

## 开发流程

1. Fork 仓库并创建一个主题分支。
2. 保持改动聚焦，一次 PR 解决一个清晰问题。
3. 为行为变化补充或更新测试。
4. 提交前运行：

```bash
npm test
npm run check
```

## PR 说明

PR 描述请包含：

- 改动目的
- 主要实现点
- 已运行的验证命令
- 已知限制或后续事项

如果 PR 会影响 Notion、Codex CLI、Claude Code、Chrome 扩展权限、localhost bridge 或写回行为，请在描述里明确说明影响范围。
