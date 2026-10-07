<!-- Owner: package.json, tsconfig.json, tsconfig.web.json, vitest.config.ts, .github/workflows/ci.yml, .github/workflows/release.yml -->

# 贡献指南

本仓库维护 Cortico 的 TRPG 技能检定 World 扩展，包括模型评分、d100 掷骰、组合与对抗检定以及扩展控制台。使用方法见 [README](README.md)，社区交流遵循 [行为准则](CODE_OF_CONDUCT.md)。

## Issue

提交前搜索已有 Issue，一个 Issue 描述一个问题或一项需求。缺陷报告填写扩展和 Cortico 版本、实际与预期行为、复现步骤；涉及评分时，提供技能、角色证据、情境和评分方式。涉及随机结果时，保留骰值与完整检定回执。

日志、配置和截图只保留复现必需的信息，移除密钥、令牌和私人角色资料。安全漏洞和涉及个人隐私的材料通过 [noreply@mosken.observer](mailto:noreply@mosken.observer) 私密报告。

功能请求说明使用场景、具体输入与预期行为，以及现有配置或操作为何不足。Core、Persona 或其他 World 的改动在其所属仓库讨论。

## 开发环境

CI 使用 Node.js 24，pnpm 版本由 `package.json.packageManager` 指定。测试中的控制台组件与 jsdom 来自相邻的 Cortico 检出目录：

```text
<父目录>/
  Cortico/
  cortico-world-simple-trpg-check/
```

以下 PowerShell 命令在新的开发目录中检出两个仓库，并将 Cortico 固定到 Release 声明的检查基线：

```powershell
git clone https://github.com/Pal-AI-Lab/Cortico.git Cortico
git clone https://github.com/DTMosken/cortico-world-simple-trpg-check.git cortico-world-simple-trpg-check
Set-Location cortico-world-simple-trpg-check
$corticoRef = (Select-String -Path .github/workflows/release.yml -Pattern '^  CORTICO_REF: ([a-f0-9]{40})\s*$').Matches.Groups[1].Value
git -C ../Cortico checkout $corticoRef
corepack pnpm --dir ../Cortico install --frozen-lockfile
corepack pnpm install --frozen-lockfile
```

其他系统使用相同目录关系与 `CORTICO_REF`。

## 修改与验证

World 负责检定工具和评分服务，不向 Memory 写入数据。配置项在本扩展的 ConfigGroup 中声明；修改控制台无需改动 Cortico 的 `src/web/`。

行为变更补充验证契约的测试。测试使用临时目录和模拟模型响应，不访问真实服务或启动真实 bot。评分标尺、骰点规则和展示格式的改动需要对应的输入与结果用例，并同步更新 README。

在扩展目录执行：

```powershell
corepack pnpm test
corepack pnpm run typecheck
corepack pnpm run typecheck:web
git diff --check
```

控制台变更还需在隔离的检出目录执行 `corepack pnpm run build:console`，避免覆盖运行中的 bot 正在使用的资源。构建后，从相邻的 Cortico 目录检查扩展契约：

```powershell
corepack pnpm --dir ../Cortico check:extension ../cortico-world-simple-trpg-check
```

CI 的 `Validate` 还执行发布文件审计和 npm 打包内容检查，步骤见 [ci.yml](.github/workflows/ci.yml)。模型权重、密钥和一次性探针不纳入 Git；临时工作放在 `scratch/`。

## Pull Request

从最新 `main` 创建分支，一个 PR 处理一个主题。说明解决的问题、变更后的行为、验证结果以及兼容性与迁移要求，文档和示例与行为一同更新。

提交信息使用 Conventional Commits，例如 `fix(conda-environments): 修正目标平台路径`。类型与作用域使用小写英文，完整主题不超过 72 个字符。合并条件以 GitHub 当前保护规则为准；使用 AI 辅助时，提交者仍需核对行为和验证结果。

## 版本与发布

维护者通过 Release 工作流创建版本 PR，合并后再选择 `publish` 发布 npm。普通代码 PR 无需改动版本号。流程与 npm Trusted Publisher 字段见 [发布说明](.github/release.md)。
