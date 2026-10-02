<!-- Owner: src/definition.ts, src/world.ts, src/config.ts, src/request.ts, src/model.ts, src/ENV_PROMPT.md, src/display.ts, src/contest.ts -->

# Simple TRPG Check

Cortico 的 TRPG 技能检定 World 扩展，检定规则由COC7规则启发。agent 提供角色背景、技能证据和当前情境，Laya 或 Jev 估计角色的技能水平，扩展据此进行 d100 检定，返回骰值、结果和可直接展示的文本。

支持单项检定、组合检定、对抗检定，以及奖励骰、惩罚骰和困难／极难任务。技能名可以自定义，不需要预先填写数值角色卡。

## 安装与配置

要求 Node.js 22 或更新版本，以及 Cortico World API 5。在 Cortico 仓库的 `extensions/` 目录安装：

```powershell
Set-Location "<Cortico 仓库路径>\extensions"
corepack pnpm add --ignore-workspace cortico-world-simple-trpg-check
```

在目标部署的“扩展”页启用本 World，重启进程，再进入 World 的配置页选择判定模型。

| 判定模型 | 配置方式 |
| --- | --- |
| Jev | 将“判定模型”设为 `jev`，选择 TypeSafe、OpenRouter 或自定义来源，填写对应密钥。自定义来源还需配置服务地址。 |
| 多语言 Laya（默认） | 选择已安装 `laya` 的 Conda Python 环境。首次使用可能下载模型权重，后续使用本地缓存。 |
| 英文 Laya | 将“判定模型”设为 `laya`，通过可选依赖 `@receptron/laya` 在本机运行。 |

现有评测中，本地 Laya 对不同技能水平证据的区分较弱，建议使用 Jev。选择后点击“测试连接”验证服务与密钥；该操作不掷骰。

Jev 密钥保存在部署目录的 `.env` 中，配置页的“打开密钥文件”可打开该文件。填写并保存后，下一次模型请求读取密钥。

| Jev 来源 | 密钥变量 |
| --- | --- |
| TypeSafe | `CORTICO_JEV_TYPESAFE_API_KEY` |
| OpenRouter | `CORTICO_JEV_OPENROUTER_API_KEY` |
| 自定义 | `CORTICO_JEV_API_KEY` |

“强制适配多语言”要求 agent 用英文填写请求内容，不翻译已有输入。切换判定模型或 Python 环境后需要重启进程。Laya 空闲释放时间默认 10 分钟；同一进程内共用模型时取各使用者中最长的保留时间。

## 使用示例

环境提示词会指导 agent 在结果不确定且情境具有戏剧性时调用检定工具。单项和组合检定使用 `simple_trpg_check_roll`：

```json
{
  "character": {
    "traits": "常年带队登山的向导。",
    "condition": "无。"
  },
  "situation": {
    "weather": "晴天，无风。",
    "gear": "绳索与铁锁齐全，状态良好。",
    "info": "路线与岩点位置已知。",
    "time": "无时限。",
    "senses": "光线充足。"
  },
  "checks": [
    {
      "skill": "攀爬",
      "goal": "攀上岩壁，到达平台。",
      "evidence": "靠带队攀岩谋生，处理过大量同类线路，也能应付少见的难例。"
    }
  ]
}
```

`evidence` 描述已经确立的能力证据，例如训练经历、实操经验和同行评价，不直接填写技能数值或档位名。伤势、工具、天气等情境因素填写在对应字段，由 agent 据此选择 `bonus` 或 `grade`。`character.condition` 与 `situation` 的五个字段都必填，无影响时写“无”。

回执包含诊断结果，末尾的“显示：”块供 agent 原样展示。例如：

```text
【攀爬检定：80/62 失败】
```

两个会推理、会反应的角色互相比试时使用 `simple_trpg_check_roll_contest`。`actor` 和 `opponent` 各提供 `name`、`traits`、`condition`、`situation` 与 `checks`；每侧的 `bonus`、`joint` 填在该侧顶层。

完整工具约定见 [环境提示词](src/ENV_PROMPT.md)。

## 检定规则

模型根据 `evidence` 估计技能水平，转换成 1–99 的检定阈值，回执中称为“难度”。无修正时，骰值不超过难度即成功；不超过难度的一半为困难成功，四分之一为极难成功。1 固定为大成功，100 固定为大失败。

财富按收入、资产、生活水准和可支配资金评估，使用从贫困到富裕的档位；“信用”“信用评级”和对应英文名也可使用。

| 选项 | 行为 |
| --- | --- |
| `bonus` | 合计优势／劣势与花掉的奖励骰。通常为 −2…2；掷 `1 + |bonus|` 颗 d100，优势取最低、劣势取最高。达到 +3 自动成功，达到 −3 自动失败，均不调用模型、不掷骰。 |
| `grade` | 1 要求至少困难成功，2 要求至少极难成功。大成功与大失败不受影响。不能与 `joint` 同用。 |
| `joint` | 至少两项技能共用一次投骰。`and` 取各项难度和 `bonus` 的最小值，`or` 取最大值。 |
| 对抗 | 每侧投一次骰，先比成功等级，同级比难度数值，数值高者胜；再相等则 `actor` 胜。每侧多项技能必须指定该侧的 `joint`；对抗不接受 `grade`。 |

同一次普通调用中的多项技能默认独立检定。需要“先 A 再 B”时分两次调用，第二次根据变化后的事实重写情境。

奖励骰的授予和记账由 agent 通过外部工具完成，扩展不保存跨调用状态。对抗检定不触发奖励骰；某侧达到自动判定条件时，两侧都不调用模型、不掷骰，胜负规则见环境提示词。

模型不可用、答案无效或输入超出预算时，整次调用返回失败原因，不掷骰。请求按 token 估算限制长度：情境 768、单项问题 256、总输入 1000，检测时预留 10% 余量。对抗的两侧分别检测。

## 本地开发

```sh
corepack pnpm install
corepack pnpm test
corepack pnpm typecheck
corepack pnpm typecheck:web
corepack pnpm build:console
```

在 Cortico 仓库根目录运行 `corepack pnpm check:extension <本包绝对路径>` 验证扩展。构建控制台前需停止本机正在运行的 bot 进程。

评测方法、语料和离线读出训练见仓库内的 `evals/README.md`。运行时使用包内已有的读出表；`evals/` 和 `tests/` 不随 npm 包发布。

MIT License，见 [LICENSE](LICENSE)。
