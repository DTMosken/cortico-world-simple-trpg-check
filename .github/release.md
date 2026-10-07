<!-- Owner: .github/workflows/release.yml, .github/workflows/ci.yml -->

# 发布

推送分支和提交 PR 会运行 CI，检查测试、类型、控制台构建、扩展契约与打包内容。npm 发布由维护者手动运行 Release。

## 检查环境

工作流使用 GitHub 托管的 Ubuntu runner、Node.js 24 和 `package.json.packageManager` 声明的 pnpm 版本。Cortico 检查基线由 `release.yml` 中的 `CORTICO_REF` 指定；CI 读取同一值。

两个仓库按以下目录关系检出，各自执行 `pnpm install --frozen-lockfile`：

```text
<父目录>/
  Cortico/
  cortico-world-simple-trpg-check/
```

本地在隔离的检出目录构建控制台，避免覆盖运行中的 bot 正在使用的资源。`tests/fit.test.ts` 使用的 `evals/fit.ts` 纳入 Git；npm 文件范围由 `package.json.files` 限定。

## 版本 PR

在 Actions 中选择 Release，从 `main` 运行，选择 `patch`、`minor` 或 `major`。工作流增加 `package.json.version`，执行完整检查并创建 `release/v<版本>` 分支和版本 PR，不发布 npm 或创建 tag。

版本 PR 的 CI 由工作流显式触发。仓库 Settings → Actions → General 中须允许 GitHub Actions 创建 Pull Request；工作流保留默认只读权限，在 Release job 中申请所需写权限。合并条件由主分支保护规则规定。

## 发布 npm

合并版本 PR 后，从 `main` 再运行 Release，选择 `publish`。工作流检查并打包该提交，创建 `v<版本>` tag，再通过 npm Trusted Publishing 发布 tarball，最后核对指定版本和 `latest`。

已有 tag 必须指向当前提交；指向其他提交时，需要先合并新版本 PR。同一提交已创建 tag 而 npm 尚未发布时，可修复失败原因后重试 `publish`。npm 已确认发布的版本不可重新发布。

本仓库 npm Trusted Publisher 的字段为：

| 字段 | 值 |
| --- | --- |
| Organization or user | `DTMosken` |
| Repository | `cortico-world-simple-trpg-check` |
| Workflow filename | `release.yml` |
| Environment name | 留空 |
| Allowed actions | `npm publish` |

不需要配置 `NPM_TOKEN`。Trusted Publisher 需由 npm 包维护者在 npm 设置页配置。

参考：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[GitHub 手动运行工作流](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)。
