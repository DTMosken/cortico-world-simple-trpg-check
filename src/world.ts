import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldConsoleDecl, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import {
  autoVerdict,
  classify,
  difficultyFromLevel,
  effectiveBonus,
  effectiveDifficulty,
  rollDice,
  type Grade,
  type Joint,
} from './check.ts';
import {
  decisionModel,
  SIMPLE_TRPG_CHECK_CONFIG_GROUP,
  SIMPLE_TRPG_CHECK_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_CUSTOM_SECRET,
  SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET,
  type SimpleTrpgCheckConfigSection,
} from './config.ts';
import {
  compareContest,
  contestAutoVerdict,
  resolveSide,
  type ContestRequest,
  type ContestSideSpec,
  type ResolvedSide,
} from './contest.ts';
import { formatContest, formatReceipt, type ContestSide, type SkillCheck } from './display.ts';
import { SystemOneSkillScorer, type SkillScorer } from './model.ts';
import { budgetViolation, checksLabel, type CheckRequest, type CheckSpec } from './request.ts';
import { discoverCondaPythonOptions } from './conda-environments.ts';
import { ensureSecretPlaceholder, openSecretFile } from './secret-file.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function fieldText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 不能为空`);
  return value.trim();
}

function fieldInt(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`${label} 必须是整数`);
  return value;
}

function fieldGrade(value: unknown, label: string): Grade {
  if (value !== 1 && value !== 2) throw new Error(`${label} 必须是 1 或 2`);
  return value;
}

function fieldJoint(value: unknown, label: string): Joint {
  if (value !== 'and' && value !== 'or') throw new Error(`${label} 必须是 and 或 or`);
  return value;
}

/** 五维情境。某项确实无影响时写“无”，但不能省略。 */
function readSituation(value: unknown, label: string, prefix: string): CheckRequest['situation'] {
  const situation = asObject(value, label);
  return {
    weather: fieldText(situation.weather, `${prefix}weather`),
    gear: fieldText(situation.gear, `${prefix}gear`),
    info: fieldText(situation.info, `${prefix}info`),
    time: fieldText(situation.time, `${prefix}time`),
    senses: fieldText(situation.senses, `${prefix}senses`),
  };
}

function readCharacter(traits: unknown, condition: unknown, prefix: string): CheckRequest['character'] {
  return {
    traits: fieldText(traits, `${prefix}traits`),
    condition: fieldText(condition, `${prefix}condition`),
  };
}

/**
 * 逐项技能。`allowGrade` 只在对技能判定的工具里为真：对抗检定不支持难度等级。
 * 省略的 bonus/grade 不会写成键，判定请求的形状因此与不带代偿时逐字一致。
 */
function readChecks(value: unknown, label: string, prefix: string, allowGrade: boolean): CheckSpec[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} 必须是非空数组`);
  return value.map((entry, index) => {
    const item = asObject(entry, `${prefix}[${index}]`);
    const spec: CheckSpec = {
      skill: fieldText(item.skill, `${prefix}[${index}].skill`),
      goal: fieldText(item.goal, `${prefix}[${index}].goal`),
      evidence: fieldText(item.evidence, `${prefix}[${index}].evidence`),
    };
    if (item.bonus !== undefined) spec.bonus = fieldInt(item.bonus, `${prefix}[${index}].bonus`);
    if (item.grade !== undefined) {
      if (!allowGrade) throw new Error('对抗检定不支持 grade');
      spec.grade = fieldGrade(item.grade, `${prefix}[${index}].grade`);
    }
    return spec;
  });
}

/** 工具参数 → 判定请求。六维与逐项技能说明缺一不可，字段边界在此固定下来。 */
function readRequest(args: Record<string, unknown>): CheckRequest {
  const character = asObject(args.character, 'character');
  const request: CheckRequest = {
    character: readCharacter(character.traits, character.condition, 'character.'),
    situation: readSituation(args.situation, 'situation', 'situation.'),
    checks: readChecks(args.checks, 'checks', 'checks', true),
  };
  if (args.joint !== undefined) request.joint = fieldJoint(args.joint, 'joint');
  return request;
}

/**
 * 对抗检定的一侧。仍然是一份完整请求（自己的六维与证据），
 * 但奖惩骰挂在侧上而不是逐项：每侧只投一次骰，逐项 bonus 没有取值规则。
 */
function readContestSide(value: unknown, key: 'actor' | 'opponent'): ContestSideSpec {
  const side = asObject(value, key);
  if (side.grade !== undefined) throw new Error('对抗检定不支持 grade');
  const name = fieldText(side.name, `${key}.name`);
  const request: CheckRequest = {
    character: readCharacter(side.traits, side.condition, `${key}.`),
    situation: readSituation(side.situation, `${key}.situation`, `${key}.situation.`),
    checks: readChecks(side.checks, `${key}.checks`, `${key}.checks`, false),
  };
  if (side.joint !== undefined) request.joint = fieldJoint(side.joint, `${key}.joint`);
  if (request.joint === undefined && request.checks.length > 1) {
    throw new Error('对抗检定中 checks 多于一项时必须指定 joint');
  }
  if (request.joint !== undefined && request.checks.length < 2) {
    throw new Error('组合检定至少需要两项技能');
  }
  const bonus = side.bonus === undefined ? 0 : fieldInt(side.bonus, `${key}.bonus`);
  return { name, request, bonus };
}

/** 结算结果 → 显示记录。 */
function toContestSide(spec: ContestSideSpec, resolved: ResolvedSide): ContestSide {
  return {
    name: spec.name,
    skill: resolved.skill,
    joint: resolved.joint,
    bonus: resolved.bonus,
    difficulty: resolved.difficulty,
    difficulties: resolved.difficulties,
    roll: resolved.roll,
    result: resolved.result,
  };
}

export class SimpleTrpgCheckWorld implements World {
  readonly id = 'simple-trpg-check';
  private readonly scorer: SkillScorer;
  private modelState: 'offline' | 'loading' | 'online' | 'error' = 'offline';
  private modelSignature = '';
  private modelRequestId = 0;

  private hasJevKey(): boolean {
    const source = this.ctx.cfg.jevSource;
    return !!(source === 'custom' ? this.ctx.secret(SIMPLE_TRPG_CHECK_CUSTOM_SECRET)
      : source === 'openrouter'
        ? this.ctx.secret(SIMPLE_TRPG_CHECK_OPENROUTER_SECRET) || this.ctx.secret(SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET)
        : this.ctx.secret(SIMPLE_TRPG_CHECK_TYPESAFE_SECRET) || this.ctx.secret(SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET)
          || this.ctx.secret(SIMPLE_TRPG_CHECK_CUSTOM_SECRET));
  }

  constructor(
    private readonly ctx: WorldContext<SimpleTrpgCheckConfigSection>,
    scorer?: SkillScorer,
    private readonly roll: () => number = () => randomInt(1, 101),
    private readonly openFile: (path: string) => void | Promise<void> = openSecretFile,
  ) {
    this.scorer = scorer ?? new SystemOneSkillScorer(ctx);
  }

  envPromptVars(): Record<string, string> {
    return {
      'simpleTrpgCheck.languageRule': this.ctx.cfg.forceMultilingual
        ? '调用判定工具时，character、situation 与 checks（对抗检定里是 actor 与 opponent 各自的 situation 与 checks）必须用英文填写。'
        : '',
    };
  }

  tools(): ToolDef[] {
    return [{
      name: 'simple_trpg_check_roll',
      description: '按 checks 里的人物证据判定角色在每项技能上的水平作为难度，再逐项掷骰出结果。回执末尾的「显示：」块就是面向用户的完整格式，照抄即可。'
        + 'checks[i].bonus 是情景代偿的奖励/惩罚骰：整数，标尺 -2（巨大劣势）…2（巨大优势），0 或省略即基准；掷 1+|bonus| 颗，优势取最低、劣势取最高，|bonus|≥3 时不调用判定模型、直接自动成功/失败。'
        + 'checks[i].grade 取 1（困难）或 2（极难），把档位标签整体下压；只在难度本身是任务因素时使用。'
        + '顶层 joint 取 and/or 把本调用里的所有技能合成一次投掷（and 取最小难度与最小 bonus、or 取最大），出现时至少两项技能且不得带 grade。'
        + '模型失败、答案无效、输入超出预算或字段非法时不掷骰。',
      tags: ['act'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          character: {
            type: 'object',
            additionalProperties: false,
            description: '角色层面、跨技能共享的事实。',
            properties: {
              traits: { type: 'string', minLength: 1, maxLength: 600, description: '长期特质、背景、词条。' },
              condition: { type: 'string', minLength: 1, maxLength: 600, description: '伤势、疲劳、体温、精神与消耗状态。' },
            },
            required: ['traits', 'condition'],
          },
          situation: {
            type: 'object',
            additionalProperties: false,
            description: '这一时刻的情境；某项确实无影响就写“无”，不要省略。',
            properties: {
              weather: { type: 'string', minLength: 1, maxLength: 600, description: '天气与介质。' },
              gear: { type: 'string', minLength: 1, maxLength: 600, description: '工具与装备。' },
              info: { type: 'string', minLength: 1, maxLength: 600, description: '已知信息与资料的秩序。' },
              time: { type: 'string', minLength: 1, maxLength: 600, description: '时限。' },
              senses: { type: 'string', minLength: 1, maxLength: 600, description: '可见度与感官条件。' },
            },
            required: ['weather', 'gear', 'info', 'time', 'senses'],
          },
          checks: {
            type: 'array',
            minItems: 1,
            description: '按判定顺序列出本时刻的技能；顺序只决定回执排列，不表示依赖关系。',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                skill: { type: 'string', minLength: 1, maxLength: 120, description: '技能名。' },
                goal: { type: 'string', minLength: 1, maxLength: 300, description: '这项技能要达成的直接结果。' },
                evidence: { type: 'string', minLength: 1, maxLength: 300, description: '角色在该技能上的水平证据；不写数字、不写档位名，也不把情境写进去。' },
                bonus: {
                  type: 'integer',
                  description: '情景代偿的奖励/惩罚骰，整数；标尺 -2（巨大劣势）…2（巨大优势），0 或省略即基准。'
                    + '填合计数：情境修正与本项花掉的 banked 奖励骰 1:1 抵消后相加。|bonus|≥3 时不调用判定模型，直接自动成功/失败。',
                },
                grade: {
                  type: 'integer',
                  enum: [1, 2],
                  description: '难度等级：1 = 困难（困难成功视为普通成功、成功视为失败），2 = 极难（极难成功视为成功、其余视为失败）。'
                    + '只用于难度本身是任务因素的场合；大成功与大失败不受影响；与顶层 joint 不能同时出现。',
                },
              },
              required: ['skill', 'goal', 'evidence'],
            },
          },
          joint: {
            type: 'string',
            enum: ['and', 'or'],
            description: '组合检定：and = 列表里每项都要成功（按最小难度与最小 bonus 判），or = 任意一项成功即可（按最大难度与最大 bonus 判）。'
              + '出现时 checks 至少两项，且各项不得带 grade。',
          },
        },
        required: ['character', 'situation', 'checks'],
      },
      handler: (args) => this.runCheck(args),
    }, {
      name: 'simple_trpg_check_roll_contest',
      description: '对抗检定：分别判定我方与对方的同一时刻水平，比成功等级定胜负。actor 与 opponent 各写完整一套（name、traits、condition、situation 五维、checks）；'
        + '每侧各发一次判定请求，任一侧失败则整次失败且不掷骰。bonus 与 joint 挂在侧上：每侧只投一次骰，侧内 checks 多于一项时必须 joint。不支持 grade。'
        + '自动判定按序短路：我方 bonus≥3 → 我方胜；对方≤-3 → 我方胜；我方≤-3 → 对方胜；对方≥3 → 对方胜。命中时两侧都不调用判定模型，未定调的一侧显示「跳过检定」。'
        + '比档：大成功>极难>困难>普通成功>普通失败>大失败，同级比难度数值高者胜、相等则我方胜。对抗不触发奖励骰。',
      tags: ['act'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          actor: {
            type: 'object',
            additionalProperties: false,
            description: '我方；一份完整的判定请求。',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 120, description: '我方角色的名字，用于回执与显示串。' },
              traits: { type: 'string', minLength: 1, maxLength: 600, description: '长期特质、背景、词条。' },
              condition: { type: 'string', minLength: 1, maxLength: 600, description: '伤势、疲劳、体温、精神与消耗状态。' },
              situation: {
                type: 'object',
                additionalProperties: false,
                description: '我方所面对的处境；某项确实无影响就写“无”，不要省略。',
                properties: {
                  weather: { type: 'string', minLength: 1, maxLength: 600, description: '天气与介质。' },
                  gear: { type: 'string', minLength: 1, maxLength: 600, description: '工具与装备。' },
                  info: { type: 'string', minLength: 1, maxLength: 600, description: '已知信息与资料的秩序。' },
                  time: { type: 'string', minLength: 1, maxLength: 600, description: '时限。' },
                  senses: { type: 'string', minLength: 1, maxLength: 600, description: '可见度与感官条件。' },
                },
                required: ['weather', 'gear', 'info', 'time', 'senses'],
              },
              checks: {
                type: 'array',
                minItems: 1,
                description: '参与对抗的技能；多于一项时必须同时给 joint。',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    skill: { type: 'string', minLength: 1, maxLength: 120, description: '技能名。' },
                    goal: { type: 'string', minLength: 1, maxLength: 300, description: '这一侧要靠它达到的直接结果。' },
                    evidence: { type: 'string', minLength: 1, maxLength: 300, description: '这一侧在该技能上的水平证据；不写数字与档位名。' },
                  },
                  required: ['skill', 'goal', 'evidence'],
                },
              },
              joint: {
                type: 'string',
                enum: ['and', 'or'],
                description: '这一侧的组合检定：and 取最小难度、or 取最大。侧内 checks 多于一项时必须指定。',
              },
              bonus: {
                type: 'integer',
                description: '这一侧的奖励/惩罚骰合计值：情境修正 + 这一侧花掉的 banked 奖励骰，0 或省略即基准。'
                  + '|bonus|≥3 时两侧都不调用判定模型，直接定胜负。',
              },
            },
            required: ['name', 'traits', 'condition', 'situation', 'checks'],
          },
          opponent: {
            type: 'object',
            additionalProperties: false,
            description: '对方；与 actor 同形，写对方自己的处境与证据。',
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 120, description: '对方的名字，用于回执与显示串。' },
              traits: { type: 'string', minLength: 1, maxLength: 600, description: '长期特质、背景、词条。' },
              condition: { type: 'string', minLength: 1, maxLength: 600, description: '伤势、疲劳、体温、精神与消耗状态。' },
              situation: {
                type: 'object',
                additionalProperties: false,
                description: '对方所面对的处境；某项确实无影响就写“无”，不要省略。',
                properties: {
                  weather: { type: 'string', minLength: 1, maxLength: 600, description: '天气与介质。' },
                  gear: { type: 'string', minLength: 1, maxLength: 600, description: '工具与装备。' },
                  info: { type: 'string', minLength: 1, maxLength: 600, description: '已知信息与资料的秩序。' },
                  time: { type: 'string', minLength: 1, maxLength: 600, description: '时限。' },
                  senses: { type: 'string', minLength: 1, maxLength: 600, description: '可见度与感官条件。' },
                },
                required: ['weather', 'gear', 'info', 'time', 'senses'],
              },
              checks: {
                type: 'array',
                minItems: 1,
                description: '参与对抗的技能；多于一项时必须同时给 joint。',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    skill: { type: 'string', minLength: 1, maxLength: 120, description: '技能名。' },
                    goal: { type: 'string', minLength: 1, maxLength: 300, description: '这一侧要靠它达到的直接结果。' },
                    evidence: { type: 'string', minLength: 1, maxLength: 300, description: '这一侧在该技能上的水平证据；不写数字与档位名。' },
                  },
                  required: ['skill', 'goal', 'evidence'],
                },
              },
              joint: {
                type: 'string',
                enum: ['and', 'or'],
                description: '这一侧的组合检定：and 取最小难度、or 取最大。侧内 checks 多于一项时必须指定。',
              },
              bonus: {
                type: 'integer',
                description: '这一侧的奖励/惩罚骰合计值：情境修正 + 这一侧花掉的 banked 奖励骰，0 或省略即基准。'
                  + '|bonus|≥3 时两侧都不调用判定模型，直接定胜负。',
              },
            },
            required: ['name', 'traits', 'condition', 'situation', 'checks'],
          },
        },
        required: ['actor', 'opponent'],
      },
      handler: (args) => this.runContest(args),
    }];
  }

  console(): WorldConsoleDecl {
    const source = this.ctx.cfg.jevSource;
    const keySet = this.hasJevKey();
    const signature = this.currentModelSignature();
    const modelState = signature === this.modelSignature ? this.modelState : 'offline';
    return {
      lamps: [{
        label: '判定模型',
        state: modelState,
        hint: modelState === 'online' ? '最近一次模型请求成功' : modelState === 'error'
          ? '最近一次模型请求失败' : modelState === 'loading' ? '正在请求模型' : '尚未成功请求模型',
      }],
      badges: this.ctx.cfg.backend === 'jev'
        ? [{ label: source === 'openrouter' ? 'OpenRouter' : source === 'custom' ? '自定义服务' : 'TypeSafe', value: keySet ? '密钥已配置' : '密钥未配置', tone: keySet ? 'on' : 'off' },
          { label: '决策模型', value: decisionModel(this.ctx.cfg) }]
        : [{ label: '判定模型', value: this.ctx.cfg.backend }],
      panels: [{ id: 'config', title: '配置' }],
      invoke: async (panel, method, args) => {
        if (panel !== 'config') throw new Error('未知面板');
        if (method === 'state') {
          return { config: { ...this.ctx.cfg }, keySet: this.hasJevKey() };
        }
        if (method === 'options') return discoverCondaPythonOptions();
        if (method === 'save') {
          const [key, value] = args;
          const property = SIMPLE_TRPG_CHECK_CONFIG_GROUP.schema.properties?.[`worlds.simple-trpg-check.${key}`];
          if (!property || typeof key !== 'string' || key === 'enabled') throw new Error('未知配置项');
          if (property.type === 'boolean' ? typeof value !== 'boolean'
            : property.type === 'integer' ? typeof value !== 'number' || !Number.isInteger(value) || value < (property.minimum ?? 0)
              : typeof value !== 'string' || (property.enum && !property.enum.includes(value))) {
            throw new Error('配置值无效');
          }
          this.ctx.persist({ [key]: value });
          return { config: { ...this.ctx.cfg }, keySet: this.hasJevKey() };
        }
        if (method === 'testConnection') {
          try {
            await this.assess({
              character: { traits: 'A patient mountain guide.', condition: 'Unhurt and rested.' },
              situation: {
                weather: 'Clear and dry.',
                gear: 'A full rack of climbing gear in working order.',
                info: 'The route is known from previous climbs.',
                time: 'No deadline.',
                senses: 'Daylight.',
              },
              checks: [{
                skill: 'climbing',
                goal: 'climb a waist-high wall to reach the other side',
                evidence: 'A working guide who climbs walls like this most weeks.',
              }],
            });
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        if (method === 'openKeyFile') {
          const source = args[0];
          if (source !== this.ctx.cfg.jevSource || this.ctx.cfg.backend !== 'jev') {
            throw new Error('决策服务已改变，请重试');
          }
          const secretName = this.ctx.cfg.jevSource === 'openrouter' ? SIMPLE_TRPG_CHECK_OPENROUTER_SECRET
            : this.ctx.cfg.jevSource === 'custom' ? SIMPLE_TRPG_CHECK_CUSTOM_SECRET : SIMPLE_TRPG_CHECK_TYPESAFE_SECRET;
          const file = ensureSecretPlaceholder(this.ctx.botDir, secretName);
          await this.openFile(file);
          return { file };
        }
        throw new Error('未知操作');
      },
      promptDocs: [{
        key: 'worlds.simple-trpg-check.envPrompt',
        title: 'Simple TRPG Check · 环境提示词',
        description: '何时调用技能判定或对抗检定，以及如何填写情境、技能与情景代偿。',
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: [{ name: 'simpleTrpgCheck.languageRule', description: '英文输入开关的当前要求。' }],
      }],
    };
  }

  async start(_host: WorldHost): Promise<void> {}
  async stop(): Promise<void> {
    this.modelState = 'offline';
    await this.scorer.close();
  }

  private currentModelSignature(): string {
    const { backend, jevSource, jevEndpoint, pythonExecutable } = this.ctx.cfg;
    return `${backend}|${backend === 'jev' ? `${jevSource}|${decisionModel(this.ctx.cfg)}|${jevSource === 'custom' ? jevEndpoint : ''}` : pythonExecutable}`;
  }

  /**
   * 判定模型的读数在这里就化成 1–99 的整数难度：浮点水平不流出本函数，
   * 所以任何一个调用方都不可能把小数写进回执。
   */
  private async assess(request: CheckRequest): Promise<number[]> {
    const violation = budgetViolation(request, !this.ctx.cfg.forceMultilingual);
    if (violation) throw new Error(violation);
    const signature = this.currentModelSignature();
    const requestId = ++this.modelRequestId;
    this.modelSignature = signature;
    this.modelState = 'loading';
    try {
      const levels = await this.scorer.score(request);
      if (levels.length !== request.checks.length) throw new Error('模型返回的技能答案数量不匹配');
      const difficulties = levels.map(difficultyFromLevel);
      if (signature !== this.currentModelSignature()) throw new Error('判定模型配置已改变，请重试');
      if (requestId === this.modelRequestId) this.modelState = 'online';
      return difficulties;
    } catch (error) {
      if (requestId === this.modelRequestId && signature === this.currentModelSignature()) this.modelState = 'error';
      throw error;
    }
  }

  /** 对抗请求分两次发给模型；任一侧出错就把这一侧的名字带进失败原因。 */
  private async assessSide(label: string, request: CheckRequest): Promise<number[]> {
    try {
      return await this.assess(request);
    } catch (error) {
      throw new Error(`${label} ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 技能判定。情景代偿全部在这一层落地：判定模型看不到 bonus 与 grade，
   * 它只回答「角色在这项技能上处于哪一档」，代偿只作用于之后的骰子与档位标签。
   * |bonus| ≥ 3 的项不参与判定请求，因此连预算也不用过——它本来就不会被发出去。
   */
  private async runCheck(args: Record<string, unknown>): Promise<ToolOutcome> {
    try {
      const request = readRequest(args);
      const joint = request.joint;
      const skill = checksLabel(request.checks, joint);
      if (joint) {
        if (request.checks.length < 2) throw new Error('组合检定至少需要两项技能');
        const groupBonus = effectiveBonus(request.checks.map((check) => check.bonus ?? 0), joint);
        const verdict = autoVerdict(groupBonus);
        // 自动判定压倒一切：不调模型、不掷骰，也不再追究 grade 与 joint 的互斥。
        if (verdict) return { text: formatReceipt([{ kind: 'auto', skill, joint, bonus: groupBonus, auto: verdict }]) };
        if (request.checks.some((check) => check.grade !== undefined)) {
          throw new Error('组合检定不能与 grade 同时使用');
        }
        const difficulties = await this.assess(request);
        const difficulty = effectiveDifficulty(difficulties, joint);
        const roll = rollDice(this.roll, groupBonus);
        return {
          text: formatReceipt([{
            kind: 'rolled', skill, joint, difficulty, difficulties, roll, bonus: groupBonus,
            result: classify(roll.chosen, difficulty),
          }]),
        };
      }
      const pending = request.checks
        .map((check, index) => ({ check, index }))
        .filter(({ check }) => autoVerdict(check.bonus ?? 0) === null);
      const difficulties = pending.length
        ? await this.assess({ ...request, checks: pending.map(({ check }) => check) })
        : [];
      const levelByIndex = new Map(pending.map(({ index }, position) => [index, difficulties[position]!]));
      const checks = request.checks.map((check, index): SkillCheck => {
        const bonus = check.bonus ?? 0;
        const verdict = autoVerdict(bonus);
        if (verdict) return { kind: 'auto', skill: check.skill, bonus, auto: verdict };
        const difficulty = levelByIndex.get(index)!;
        const roll = rollDice(this.roll, bonus);
        return {
          kind: 'rolled', skill: check.skill, difficulty, difficulties: [difficulty],
          roll, bonus, grade: check.grade, result: classify(roll.chosen, difficulty, check.grade),
        };
      });
      return { text: formatReceipt(checks) };
    } catch (error) {
      return { text: `技能判定失败：${error instanceof Error ? error.message : String(error)}`, failed: true };
    }
  }

  /**
   * 对抗检定。两侧各自发一次判定请求，但掷骰要等两侧都判完——任一侧失败则整次失败，不掷任何骰，
   * 玩家不会拿到半场对抗。自动判定命中时两侧都不发请求。
   */
  private async runContest(args: Record<string, unknown>): Promise<ToolOutcome> {
    try {
      const contest: ContestRequest = {
        actor: readContestSide(args.actor, 'actor'),
        opponent: readContestSide(args.opponent, 'opponent'),
      };
      const verdict = contestAutoVerdict(contest.actor.bonus, contest.opponent.bonus);
      if (verdict) {
        const sideOf = (key: 'actor' | 'opponent'): ContestSide => {
          const spec = contest[key];
          const base = { name: spec.name, skill: checksLabel(spec.request.checks, spec.request.joint), joint: spec.request.joint, bonus: spec.bonus };
          return key === verdict.decisive
            ? { ...base, auto: verdict.verdict }
            : { ...base, skipped: true };
        };
        return { text: formatContest({ actor: sideOf('actor'), opponent: sideOf('opponent'), winner: verdict.winner }) };
      }
      const actorLevels = await this.assessSide('我', contest.actor.request);
      const opponentLevels = await this.assessSide('对方', contest.opponent.request);
      const actor = resolveSide(contest.actor, actorLevels, this.roll);
      const opponent = resolveSide(contest.opponent, opponentLevels, this.roll);
      return {
        text: formatContest({
          actor: toContestSide(contest.actor, actor),
          opponent: toContestSide(contest.opponent, opponent),
          winner: compareContest(actor, opponent),
        }),
      };
    } catch (error) {
      return { text: `技能判定失败：${error instanceof Error ? error.message : String(error)}`, failed: true };
    }
  }
}
