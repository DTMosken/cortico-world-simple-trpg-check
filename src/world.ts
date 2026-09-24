import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolDef, ToolOutcome, World, WorldConsoleDecl, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext } from 'cortico/world.ts';
import { classify, difficultyFromProbability, formatChecks } from './check.ts';
import {
  SIMPLE_TRPG_CHECK_CONFIG_GROUP,
  SIMPLE_TRPG_CHECK_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
  type SimpleTrpgCheckConfigSection,
} from './config.ts';
import { SystemOneSkillScorer, type SkillScorer } from './model.ts';
import { ensureSecretPlaceholder, openSecretFile } from './secret-file.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));

export class SimpleTrpgCheckWorld implements World {
  readonly id = 'simple-trpg-check';
  private readonly scorer: SkillScorer;
  private modelState: 'offline' | 'loading' | 'online' | 'error' = 'offline';
  private modelSignature = '';
  private modelRequestId = 0;

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
        ? '调用此工具时，scenario 和 skill_lists 必须用英文填写。'
        : '',
    };
  }

  tools(): ToolDef[] {
    return [{
      name: 'simple_trpg_check_roll',
      description: '对 scenario 中的目标并行评估每项 skill_lists 的成功把握，再逐项掷 1–100。返回 [判定/难度] 与固定的结果建议；模型失败时不掷骰。',
      tags: ['act'],
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          scenario: {
            type: 'string',
            minLength: 1,
            description: '角色如何用这些技能达成什么目标，相关情境；可写熟练程度或身体条件。',
          },
          skill_lists: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
            description: '按判定顺序列出技能名称。',
          },
        },
        required: ['scenario', 'skill_lists'],
      },
      handler: (args) => this.runCheck(args),
    }];
  }

  console(): WorldConsoleDecl {
    const source = this.ctx.cfg.jevSource;
    const keySet = !!this.ctx.secret(source === 'openrouter'
      ? SIMPLE_TRPG_CHECK_OPENROUTER_SECRET
      : SIMPLE_TRPG_CHECK_TYPESAFE_SECRET);
    const signature = this.currentModelSignature();
    const modelState = signature === this.modelSignature ? this.modelState : 'offline';
    return {
      config: [SIMPLE_TRPG_CHECK_CONFIG_GROUP],
      lamps: [{
        label: '判定模型',
        state: modelState,
        hint: modelState === 'online' ? '最近一次模型请求成功' : modelState === 'error'
          ? '最近一次模型请求失败' : modelState === 'loading' ? '正在请求模型' : '尚未成功请求模型',
      }],
      badges: this.ctx.cfg.backend === 'jev'
        ? [{ label: source === 'openrouter' ? 'OpenRouter' : 'TypeSafe', value: keySet ? '密钥已配置' : '密钥未配置', tone: keySet ? 'on' : 'off' }]
        : [{ label: '判定模型', value: this.ctx.cfg.backend }],
      panels: [
        { id: 'connection-test', title: '测试连接', slot: 'model-test' },
        { id: 'credentials', title: 'Jev 密钥', slot: 'jev-key' },
      ] as unknown as WorldConsoleDecl['panels'],
      invoke: async (panel, method, args) => {
        if (panel === 'connection-test' && method === 'testConnection') {
          try {
            await this.assess('A character climbs a waist-high wall to reach the other side.', ['climbing']);
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) };
          }
        }
        if (panel !== 'credentials') throw new Error('未知面板');
        if (method === 'state') {
          return { backend: this.ctx.cfg.backend, source: this.ctx.cfg.jevSource, keySet: !!this.ctx.secret(
            this.ctx.cfg.jevSource === 'openrouter'
              ? SIMPLE_TRPG_CHECK_OPENROUTER_SECRET
              : SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
          ) };
        }
        if (method === 'openKeyFile') {
          const source = args[0];
          if (source !== this.ctx.cfg.jevSource || this.ctx.cfg.backend !== 'jev') {
            throw new Error('Jev 来源已改变，请重试');
          }
          const secretName = this.ctx.cfg.jevSource === 'openrouter'
            ? SIMPLE_TRPG_CHECK_OPENROUTER_SECRET
            : SIMPLE_TRPG_CHECK_TYPESAFE_SECRET;
          const file = ensureSecretPlaceholder(this.ctx.botDir, secretName);
          await this.openFile(file);
          return { file };
        }
        throw new Error('未知操作');
      },
      promptDocs: [{
        key: 'worlds.simple-trpg-check.envPrompt',
        title: 'Simple TRPG Check · 环境提示词',
        description: '何时调用技能判定，以及如何填写情境和技能。',
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
    const { backend, jevSource, pythonExecutable } = this.ctx.cfg;
    return `${backend}|${backend === 'jev' ? jevSource : pythonExecutable}`;
  }

  private async assess(scenario: string, skills: string[]): Promise<number[]> {
    const signature = this.currentModelSignature();
    const requestId = ++this.modelRequestId;
    this.modelSignature = signature;
    this.modelState = 'loading';
    try {
      const probabilities = await this.scorer.score(scenario, skills);
      if (probabilities.length !== skills.length) throw new Error('模型返回的技能答案数量不匹配');
      probabilities.forEach(difficultyFromProbability);
      if (signature !== this.currentModelSignature()) throw new Error('判定模型配置已改变，请重试');
      if (requestId === this.modelRequestId) this.modelState = 'online';
      return probabilities;
    } catch (error) {
      if (requestId === this.modelRequestId && signature === this.currentModelSignature()) this.modelState = 'error';
      throw error;
    }
  }

  private async runCheck(args: Record<string, unknown>): Promise<ToolOutcome> {
    try {
      const scenario = args.scenario;
      const skillLists = args.skill_lists;
      if (typeof scenario !== 'string' || !scenario.trim()) throw new Error('scenario 不能为空');
      if (!Array.isArray(skillLists) || skillLists.length === 0 || skillLists.some(
        (skill) => typeof skill !== 'string' || !skill.trim(),
      )) throw new Error('skill_lists 必须是非空技能名称列表');
      const skills = skillLists as string[];
      const probabilities = await this.assess(scenario, skills);
      const difficulties = probabilities.map(difficultyFromProbability);
      const checks = skills.map((skill, index) => {
        const difficulty = difficulties[index]!;
        const roll = this.roll();
        return { skill, difficulty, roll, result: classify(roll, difficulty) };
      });
      return { text: formatChecks(checks) };
    } catch (error) {
      return { text: `技能判定失败：${error instanceof Error ? error.message : String(error)}`, failed: true };
    }
  }
}
