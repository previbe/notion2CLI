# notion2CLI 上线发布中文指南

最后更新：2026-04-28

本文是第一次公开 MVP 发布的中文执行入口，覆盖 npm、GitHub Release、Chrome Web Store、Product Hunt 和社交媒体发布。英文平台可直接粘贴材料仍保留在相邻文档中：

- `docs/release/NPM_RELEASE.md`
- `docs/release/RELEASE_CHECKLIST.md`
- `docs/release/MANUAL_ONLY.md`
- `docs/release/GITHUB_RELEASE_NOTES.md`
- `chrome-store/`
- `marketing/`

## 发布目标

- 版本：`0.1.0`
- 发布类型：首次公开 MVP
- GitHub 仓库：`https://github.com/previbe/notion2CLI`
- npm 包名：`notion2cli`
- Chrome Web Store：等待 Google 开发者账号审核通过后提交
- Product Hunt：等 Chrome Web Store 通过审核且可安装后再安排

原则：先让开发者可以稳定安装和验证，再做公开曝光。Product Hunt 和社交媒体大范围传播应放在 npm、GitHub Release、Chrome Web Store 都可访问之后。

## 上线前验证

在仓库根目录运行：

```bash
npm run release:check
node ./bin/notion2cli.mjs doctor
```

预期结果：

- `npm run check` 通过。
- `npm test` 通过。
- `npm audit --omit=dev` 没有漏洞报告。
- `npm pack --dry-run` 只包含发布所需文件。
- `npm publish --dry-run --access public` 可以完成 dry run。
- `npm run package:extension` 在 `dist/chrome/` 下生成 Chrome 扩展 zip。
- `doctor` 能确认至少一个运行时已经安装 Codex CLI 或 Claude Code，并且对应 Notion MCP 已配置。

如果改动只涉及文档，可以至少运行：

```bash
npm pack --dry-run
git diff --check
```

## 手动端到端测试

用不含敏感信息的 Notion 测试页执行。不要在真实敏感 workspace 上做第一次发布前验证。

### Codex 运行时

1. 如果旧 bridge 正在运行，先执行 `notion2cli daemon stop`。
2. 执行 `notion2cli mcp install notion --runtime codex`。
3. 执行 `notion2cli daemon start --runtime codex`。
4. 执行 `notion2cli pair`。
5. 在 Chrome extension popup 中完成配对。
6. 在 Notion 页面中选中文本，运行 `Raw`。
7. 不选中文本，运行整页。
8. 执行 `notion2cli codex inspect`，确认 Codex App session 可见。
9. 开启手动写回，追加最新回复到 Notion 页面。
10. 确认 Notion 页面确实发生变化。
11. 执行 `notion2cli daemon stop`。

### Claude Code 运行时

1. 执行 `notion2cli claude launch`，并保持该终端打开。
2. 另开一个终端执行 `notion2cli pair`。
3. 在 Chrome extension popup 中完成配对。
4. 在 Notion 页面中选中文本，运行 `Raw`。
5. 不选中文本，运行整页。
6. 确认 Claude 终端收到 channel message，并调用 reply tool 返回结果。
7. 开启手动写回，追加最新回复到 Notion 页面。
8. 确认 Notion 页面确实发生变化。

### Chrome 扩展

1. 打开 `chrome://extensions`。
2. 加载本仓库 `extension/` 目录。
3. 确认 toolbar icon 正常显示。
4. 确认 popup 可以展示 bridge 状态。
5. 确认 Activity 面板只在 Notion 页面出现。
6. 确认 pair 和 unpair 正常。
7. 确认 prompt profile 管理正常。
8. 确认 stop 按钮可以取消等待中的 job。

## npm 发布

账号登录和 2FA 必须由你手动完成。发布前先确认包名 `notion2cli` 可以使用，且你希望以当前 npm 账号发布。

发布命令：

```bash
npm login
npm publish --access public
```

发布后验证：

```bash
npm view notion2cli version
npm install -g notion2cli
notion2cli --version
notion2cli --help
```

npm 页面重点信息：

- Node.js 要求：`>=22.15.0`
- Chrome extension 需要单独安装或从源码加载。
- 真实运行流需要本地 Codex CLI 或 Claude Code。
- 整页读取和写回依赖 Notion MCP。
- notion2CLI 本身不运营托管后端。

## GitHub Release

建议在 npm 发布成功后创建 GitHub Release。

1. 确认 `CHANGELOG.md` 已更新。
2. 创建并推送 tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. 在 GitHub 上从 `v0.1.0` 创建 release。
4. release body 使用 `docs/release/GITHUB_RELEASE_NOTES.md`。
5. 附加 release artifact：
   - npm tarball：`dist/npm/notion2cli-0.1.0.tgz`
   - Chrome extension zip：`dist/chrome/notion2cli-chrome-extension-v0.1.0.zip`

如果你希望先保守处理，可以先创建 draft release，等 Chrome Web Store 审核通过后再正式 publish。

## Chrome Web Store 发布

你已经注册 Google 开发者账号，目前应等待审核通过。审核通过后再执行提交。

提交前重新生成扩展包：

```bash
npm run package:extension
```

上传文件：

```text
dist/chrome/notion2cli-chrome-extension-v0.1.0.zip
```

Chrome Web Store 控制台材料对应关系：

- 商店 listing：`chrome-store/LISTING.md`
- Privacy tab：`chrome-store/PRIVACY_DISCLOSURE.md`
- 审核说明：`chrome-store/REVIEW_NOTES.md`
- 素材清单和截图计划：`chrome-store/ASSETS.md`
- 隐私政策正文：`PRIVACY.md`

必须补齐的线上信息：

- 公开隐私政策 URL。可以把 `PRIVACY.md` 发布到 GitHub Pages、项目官网或其他稳定公开页面。
- 公开支持邮箱。
- 开发者或公司展示名称。
- 如果按产品、业务或商业目的发布，选择 Trader account，并完成 trader verification。

提交时不要夸大权限。核心解释应保持一致：

- 扩展只访问 Notion 页面和本地 bridge origin。
- 页面内容发送到本机 `127.0.0.1` bridge。
- 整页读取和写回由用户本地配置的 Notion MCP 执行。
- 项目本身不运行云端后端。

## Product Hunt 发布

不要在 Chrome Web Store 可安装前发布 Product Hunt。Product Hunt 首发的转化目标应清晰，否则流量会浪费在等待安装或解释审核状态上。

执行顺序：

1. npm 包可安装。
2. GitHub Release 已发布。
3. Chrome Web Store 已通过审核，并且商店链接可访问。
4. 使用 `marketing/PRODUCT_HUNT.md` 准备 Product Hunt 页面。
5. 准备至少两张 gallery image。
6. 用个人 Product Hunt 账号发布或定时。

## 社交媒体发布

社交媒体文案使用 `marketing/SOCIAL_POSTS.md`。

推荐顺序：

1. GitHub Release 公告。
2. npm 包发布公告。
3. Chrome Web Store 通过审核公告。
4. Product Hunt 当日发布帖。
5. 后续补充 demo、经验和使用案例。

## 必须由你手动处理

这些事项涉及账号、支付、2FA、法律判断或真实产品决策，不能由代码仓库直接完成：

- Google 开发者账号审核和身份验证。
- Chrome Web Store trader verification。
- Chrome Web Store 最终上传、提交审核、回复审核问题。
- npm 登录、2FA 和最终 publish 确认。
- GitHub Release 最终 publish，如果仓库权限或浏览器授权要求你本人操作。
- Product Hunt 账号 onboarding、发布日期选择、gallery 上传和最终发布。
- 隐私政策和公开 trader 信息的法律确认。
- 最终支持邮箱、官网和隐私政策 URL。
- 使用真实 Notion 测试页完成 Codex、Claude 和手动写回验证。
- Chrome Web Store 上架后从商店安装一次，并确认生产安装包可用。

## 发布阻断条件

出现以下情况时不要继续公开发布：

- `npm run release:check` 失败。
- `npm audit --omit=dev` 报出未处理漏洞。
- Chrome extension zip 无法在本地 unpacked 模式正常运行。
- Codex 或 Claude 至少一个主路径无法完成 Notion 页面运行。
- 隐私政策 URL 还不是公开可访问页面。
- Chrome Web Store listing 中的权限解释和真实行为不一致。
- Product Hunt 发布时间早于 Chrome Web Store 通过审核。

## 快速命令

```bash
npm run release:check
npm run package:npm
npm run package:extension
npm login
npm publish --access public
npm view notion2cli version
git tag v0.1.0
git push origin v0.1.0
```

## 发布顺序建议

1. 完成本地验证和真实 Notion 端到端验证。
2. 发布 npm。
3. 创建 GitHub Release。
4. Google 开发者账号审核通过后，提交 Chrome Web Store。
5. Chrome Web Store 通过后，发布 Product Hunt。
6. 按节奏发布社交媒体内容。
