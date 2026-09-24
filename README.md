<!-- Owner: src/definition.ts, src/world.ts, src/config.ts -->

# cortico-world-simple-trpg-check

`simple_trpg_check_roll` 接收 `scenario` 和 `skill_lists`。`scenario` 写明角色使用技能的方法、目标和相关情境，可写熟练程度或身体条件。模型一次评估所有技能的成功把握；World 将每项 `0–1` 数值乘 100、向下取整，限制在 1–99，回执中称为“难度”。每项技能各掷一次 1–100，按输入顺序返回固定判定文本。

1 是大成功，100 是大失败。其余骰值不超过难度的四分之一为极难成功，不超过二分之一为困难成功，不超过难度为普通成功；否则为普通失败。模型不可用或任何一项答案无效时，整次调用返回失败回执，不掷骰。

## 判定模型

`worlds.simple-trpg-check.backend` 可选 `laya-multilingual`（默认）、`laya` 和 `jev`。

- `laya-multilingual`：在“多语言 Laya Python 环境”下拉选单中选择已安装 `laya` 的 Conda 环境，使用 `convaiinnovations/laya` 的 `multilingual` 检查点。选项来自本机 `~/.conda/environments.txt`，缺失或不可读时只显示当前配置值。首次运行可能由 Laya 下载权重；后续使用本地缓存。
- `laya`：通过可选依赖 `@receptron/laya` 在本机运行英文检查点。
- `jev`：按 `worlds.simple-trpg-check.jevSource` 选择 TypeSafe 或 OpenRouter 的 System One API。工具调用会将 `scenario` 和技能名称发送给所选服务。密钥在 World 的“Jev 密钥”面板输入；仅显示当前来源的密码框，按“保存”写入部署的 `.env`。两个来源使用独立密钥。

“强制适配多语言”勾选后，World 提示 agent 用英文填写 `scenario` 和 `skill_lists`；它不翻译输入，也不切换判定模型。

环境提示词让 agent 只在结果不确定且具有戏剧性的情境中酌情投骰，并在面向用户的文本中写出每项骰值、难度和结果。

## 开发与安装

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm typecheck:web
corepack pnpm test
corepack pnpm build:console
```

包内的 `pnpm-workspace.yaml` 已允许 `esbuild` 与 `onnxruntime-node` 的安装脚本。multilingual 模式需要在下拉选单中选择已安装 `laya` 的 Python 环境。

在 Cortico 仓库根目录运行 `corepack pnpm check:extension <本包绝对路径>`。然后在目标实例的“扩展”页手动安装此目录，并在 World 配置中启用。安装到运行中的实例需要重启进程；本包的测试和装载检查不会启动 bot。
