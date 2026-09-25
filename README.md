<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, src/console/client.ts -->

# cortico-world-simple-trpg-check

`simple_trpg_check_roll` 接收 `scenario` 和 `skill_lists`。`scenario` 写明角色使用技能的方法、目标和相关情境，可写熟练程度或身体条件。模型一次评估所有技能的成功把握；World 将每项 `0–1` 数值乘 100、向下取整，限制在 1–99，回执中称为“难度”。每项技能各掷一次 1–100，按输入顺序返回固定判定文本。

1 是大成功，100 是大失败。其余骰值不超过难度的四分之一为极难成功，不超过二分之一为困难成功，不超过难度为普通成功；否则为普通失败。模型不可用或任何一项答案无效时，整次调用返回失败回执，不掷骰。

## 判定模型

`worlds.simple-trpg-check.backend` 可选 `laya-multilingual`（默认）、`laya` 和 `jev`。

- `laya-multilingual`：在“多语言 Laya Python 环境”下拉选单中选择已安装 `laya` 的 Conda 环境，使用 `convaiinnovations/laya` 的 `multilingual` 检查点。选项来自本机 `~/.conda/environments.txt`，缺失或不可读时只显示当前配置值。首次运行可能由 Laya 下载权重；后续使用本地缓存。
- `laya`：通过可选依赖 `@receptron/laya` 在本机运行英文检查点。
- `jev`：按 `worlds.simple-trpg-check.jevSource` 选择 TypeSafe 或 OpenRouter 的 System One API。工具调用会将 `scenario` 和技能名称发送给所选服务。配置页显示当前来源的密钥状态和“打开密钥文件”按钮；点击后打开部署目录的 `.env`，缺少当前来源密钥时补入空的 `CORTICO_JEV_TYPESAFE_API_KEY=` 或 `CORTICO_JEV_OPENROUTER_API_KEY=` 行。填写并保存文件后，下一次模型请求读取密钥。旧的 World 专用变量名仍可读取。

World 左栏的状态灯在首次成功完成模型评估后变绿；配置改变或评估失败后更新状态。
配置页的“测试连接”会发送一项英文技能评分请求，不掷骰；结果显示在按钮旁，并更新左栏状态灯。

同一 Cortico 进程中，若 continuity 与此 World 使用相同的 Laya 类型（multilingual 还需同一 Python 路径），两者共用已加载的模型或 worker。请求依次执行；模型在所有使用者空闲后按其中最长的 TTL 回收。`layaIdleTtlMinutes` 默认 10；设为 `0` 且无其他使用者需要保留模型时，每次评分后释放。不同进程不共用运行实例。

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
