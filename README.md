<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, src/request.ts, src/readout.ts, src/level-readout.ts, src/console/client.ts -->

# cortico-world-simple-trpg-check

`cortico-world-simple-trpg-check` 是一个面向 Cortico 的 World 扩展。agent 调用 `simple_trpg_check_roll` 提交角色、情境与逐项技能，插件给出每项技能的难度并逐项掷骰；两个智能体互相比试时改用 `simple_trpg_check_roll_contest`。回执末尾自带面向用户的成品格式，agent 照抄即可。

## 功能

- `simple_trpg_check_roll` 接收结构化的 `character`、`situation` 与 `checks`；`situation` 的五个字段加上 `character.condition` 是必填的情境六维，没有影响也要写「无」。
- 每项技能的难度就是角色在该技能上的水平，也就是这次行动的达成概率百分数；可表达区间是 [1%, 99%]。
- 1 是大成功，100 是大失败；其余骰值不超过难度的 ¼ 为极难成功、½ 为困难成功、全值为普通成功，否则普通失败。
- 判定模型只从 `evidence` 读出角色属于哪一档（十档水平表），读出把档位分布映射成难度；运行时只查表，不训练。
- 情景代偿不进模型：`checks[i].bonus` 是 −2…2 的奖励/惩罚骰合计值（包含本项花掉的 banked 奖励骰），掷 1+|bonus| 颗取极值；`|bonus| ≥ 3` 时直接自动成功/失败，不调用判定模型也不掷骰。`checks[i].grade` 取 1（困难）或 2（极难），只把档位标签整体下压，阈值不动。
- 顶层 `joint`（`and`/`or`）把一次调用里的多项技能合成一次投掷：难度与奖惩骰都按 `and` 取最小、`or` 取最大。
- `simple_trpg_check_roll_contest` 对抗检定：两侧各写一份完整请求、各判一次，比成功等级定胜负；同级比难度数值，相等判玩家胜。任一侧失败则整次失败、不掷骰；对抗不触发奖励骰，也不接受 `grade`。
- 奖励骰的授予、记账与落盘由 agent 在外部工具里完成，本插件只在回执里给建议，不保存任何跨调用状态。
- 请求按 token 估算设三条上限（总 1000 / 情境 768 / 单问 256，判定时留一成余量）；对抗检定把两侧当作两份请求、各自检测。模型不可用、答案无效或超限时返回失败回执，不掷骰。
- 支持 Jev（TypeSafe / OpenRouter / 自定义）与本地 Laya；控制台提供配置页、模型状态灯和「测试连接」。

## 安装

要求 Node.js 22 或更新版本，以及 Cortico World API 5。

在 Cortico 仓库的 `extensions/` 目录安装：

```powershell
Set-Location "<Cortico 仓库路径>\extensions"
corepack pnpm add --ignore-workspace cortico-world-simple-trpg-check
```

然后在目标实例的“扩展”页启用本 World，并重启进程。默认判定模型是本地多语言 Laya；实测它读不出角色水平（难度几乎恒定在 60 上下），要拿到可用的难度请在配置页把“判定模型”改成 Jev。

## 判定模型

`worlds.simple-trpg-check.backend` 可选 `laya-multilingual`（默认）、`laya` 和 `jev`。

- `laya-multilingual`：在“多语言 Laya Python 环境”下拉选单中选择已安装 `laya` 的 Conda 环境，使用 `convaiinnovations/laya` 的 `multilingual` 检查点。选项来自本机 `~/.conda/environments.txt`，缺失或不可读时只显示当前配置值。首次运行可能由 Laya 下载权重；后续使用本地缓存。
- `laya`：通过可选依赖 `@receptron/laya` 在本机运行英文检查点。
- `jev`：按 `worlds.simple-trpg-check.jevSource` 选择 TypeSafe、OpenRouter 或自定义 System One API。自定义来源使用 `jevEndpoint` 地址和 `CORTICO_JEV_API_KEY`。工具调用会把序列化成一个 `state.message` 的情境与逐项技能问题发送给所选服务。配置页在“Jev 来源”旁显示密钥状态和“打开密钥文件”按钮；点击后打开部署目录的 `.env`，缺少当前来源密钥时补入空的密钥行。填写并保存文件后，下一次模型请求读取密钥。旧的 World 专用变量名仍可读取。

World 左栏的状态灯在首次成功完成模型评估后变绿；配置改变或评估失败后更新状态。
配置页顶部的“测试连接”会发送一项英文技能评分请求，不掷骰；结果显示在按钮旁，并更新左栏状态灯。

同一 Cortico 进程中，若 continuity 与此 World 使用相同的 Laya 类型（multilingual 还需同一 Python 路径），两者共用已加载的模型或 worker。请求依次执行；模型在所有使用者空闲后按其中最长的 TTL 回收。`layaIdleTtlMinutes` 默认 10；设为 `0` 且无其他使用者需要保留模型时，每次评分后释放。不同进程不共用运行实例。

“强制适配多语言”勾选后，World 提示 agent 用英文填写 `character`、`situation` 与 `checks` 的取值；它不翻译输入，也不切换判定模型。问题文本里技能与目标照抄输入，因此问题语言跟随开关。

环境提示词让 agent 只在结果不确定且具有戏剧性的情境中酌情投骰、在投骰前提醒明显不奏效的方法（不强迫），并把回执末尾的「显示：」块原样拄成面向用户的文本。

## 判定规则

`checks` 里的 `evidence` 是角色的水平证据，也是唯一直接决定难度的字段：不写数字与档位名，也不把情境写进去，只写是否以此谋生、训练与实操年限、学历或认证、同行中的相对地位、过往成败。`skill` 用环境提示词里的常用技能表（力量、体质、敏捷、智力…信用），有子分类的写具体子项；表外的技能名也能用。同一调用内多项技能默认是同一时刻的独立检定，顺序只决定回执排列；需要它们共同决定一个 `goal` 时用 `joint`；「先 A 再 B」的链条分两次调用，第二段要重写变化后的六维。

难度是角色水平的百分数。没有代偿时，在 1–99 内成功条件等价于 `骰值 ≤ 难度`，所以 P(成功) = 难度/100 精确成立，大成功与大失败不改变这个概率；钳位不是可选项——允许 0 时掷出的 1 会把概率抬到 1%，允许 100 时掷出的 100 会把它压到 99%。加上代偿后这条不再成立：`grade` 1 把成功率压到约难度/200、`grade` 2 压到约难度/400（阈值不动，只覆盖标签，大成功与大失败免疫）；`bonus ≠ 0` 则掷 1+|bonus| 颗取极值，优势取最低、劣势取最高，暴击只判选中的那一颗。

### 情景代偿

`bonus` 的标尺是 −2…2（−2 巨大劣势、−1 劣势、0 基准、1 优势、2 巨大优势），优势与劣势 1:1 抵消，agent 只填合计值；超出 ±2 合法，而且是用奖励骰跳过检定的正路。`grade` 只用于「任务本身更难」的场合，它不改变难度数值也不改变 `evidence`，只把显示出来的档位往下压一档（1）或两档（2）。`grade` 与 `bonus` 可以同时用，`grade` 与 `joint` 不能。自动判定（`|bonus| ≥ 3`）压倒一切：不调模型、不掷骰，`grade` 被静默忽略。

### 组合检定

`joint: "and"` 要求列表里每项都成功，`joint: "or"` 只要任意一项成功。整组只掷一次骰，按有效难度判：`and` 取最小、`or` 取最大；有效 `bonus` 同构。出现 `joint` 时 `checks` 至少两项，且各项不得带 `grade`。自动判定按有效 `bonus` 判。

### 对抗检定

两侧各写一份完整请求（`actor` / `opponent`，含 `name`、`traits`、`condition`、各自的五维 `situation` 与 `checks`），各发一次判定请求。`bonus` 与 `joint` 挂在侧上，因为每侧只掷一次骰；某侧 `checks` 多于一项时必须给这一侧指定 `joint`。比档序列是 大成功 > 极难成功 > 困难成功 > 普通成功 > 普通失败 > 大失败；同级比难度数值，**数值高者胜**，相等判玩家胜，所以对抗永远有一个赢家。任一侧失败（模型失败、答案无效、超预算）则整次失败且不掷任何骰。某一侧 `|bonus| ≥ 3` 时按序短路定胜负（我方 ≥ 3 → 我方胜；对方 ≤ −3 → 我方胜；我方 ≤ −3 → 对方胜；对方 ≥ 3 → 对方胜），命中时两侧都不调模型、不掷骰，未定调的一侧显示「跳过检定」。对抗不触发奖励骰。

### 回执

每项两行诊断（档位、骰值/难度、一句结果陈述与固定建议），其后追加一个「显示：」块——那就是面向用户的成品格式，标记顺序固定为组合 → 难度 → 奖惩，普通成功与普通失败简写为「成功」「失败」。模型请求失败或输入超限时整次调用失败，回执只有 `技能判定失败：<原因>`，不附显示块。

## 水平读出

模型对每项技能提一个问题：「在技能 X 上，角色处于哪一档」，选项是十档水平描述：六个语义锚点（外行 / 初学者 / 业余者 / 职业=学士 / 专家=硕士博士 / 世界顶尖）相邻之间各插一档，键用中性字母 A–J。World 把回答分布过一遍**水平读出**再四舍五入、限制在 1–99。

读出是离线训练的产物，写在生成文件 `src/level-readout.ts`（一条单调分段线性表，字段与运行时行为见 `src/readout.ts`）。**发布包只带拟合好的读出，运行时不做任何训练**；本地 Laya 的检查点读不出水平证据，保持恒等读出。

配置页在“判定模型”下拉选单下方会提示：本地 Laya 检查点实测读不出角色水平（难度几乎恒定在 60 上下），建议改用 Jev。该提示不阻止选择，Laya 仍可用。

训练与实测留在本仓库的 `evals/`，不随包发布：

```sh
corepack pnpm eval:train -- --collect    # 调 Jev 收集语料，写 evals/dataset-readout-<档位数>.json
corepack pnpm eval:train -- --fit        # 拟合读出，重写 src/level-readout.ts 与报告
```

2026-09-28（十档，44 条语料：4 技能 × 5 锚点 + 2 技能 × 12 个细分水平）：留一平均绝对误差 恒等 4.0 / 等渗 1.5（选中），全量平均绝对误差 0.33、带符号偏差 0.00。同日端到端 37 条：3 / 62 / 82 三档完全归位，12 与 35 各差 1 点，技能层平均绝对误差 0.25。信用评级沿用技能尺，仍是已知近似（CR 70 → 53、CR 94 → 34）。

读出默认完全采用拟合值；`--shrinkage=<γ>` 可把它往未训练基线收缩（实测更保守的设置误差更大，故默认 γ = 1）。

## 目录结构

- `src/`（随包发布）：运行时核心；`src/level-readout.ts` 是训练好的读出，属生成文件，不要手改。
- `python/`（随包发布）：多语言 Laya 的 worker。
- `dist/`（随包发布）：控制台面板产物。
- `evals/`、`tests/`（仅本地）：语料、训练与实测脚本、测试，不随包发布。

## 本地开发

```sh
corepack pnpm install
corepack pnpm typecheck
corepack pnpm typecheck:web
corepack pnpm test
corepack pnpm build:console
```

包内的 `pnpm-workspace.yaml` 已允许 `esbuild` 与 `onnxruntime-node` 的安装脚本。multilingual 模式需要在下拉选单中选择已安装 `laya` 的 Python 环境。

`evals/` 下的脚本走 `tsx`，不参与 `vitest`；重量级实测需要 Python 环境或 Jev 密钥，因此不放在 `pnpm test` 里。

在 Cortico 仓库根目录运行 `corepack pnpm check:extension <本包绝对路径>`。安装到运行中的实例需要重启进程；本包的测试和装载检查不会启动 bot。

项目采用 MIT License，详见 [LICENSE](LICENSE)。
