import type { WorldContext } from 'cortico/world.ts';
import {
  SIMPLE_TRPG_CHECK_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_CUSTOM_SECRET,
  SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET,
  type SimpleTrpgCheckConfigSection,
} from './config.ts';
import { startMultilingualLaya } from './multilingual-laya.ts';
import { layaRuntimeKey, sharedLayaPool, type SharedLayaClient, type SharedLayaModel } from './shared-laya.ts';

type Questions = Record<string, { type: 'noul'; instructions: string }>;
export interface SkillScorer {
  score(scenario: string, skills: string[]): Promise<number[]>;
  close(): Promise<void>;
}

function questionsFor(skills: string[]): Questions {
  return Object.fromEntries(skills.map((skill, index) => [
    `skill_${index}`,
    {
      type: 'noul',
      instructions: `Can the character achieve the stated goal by using the skill "${skill}" in this scenario? Consider the described method, goal, familiarity, and relevant circumstances.`,
    },
  ]));
}

function probabilitiesFrom(result: unknown, count: number): number[] {
  if (!result || typeof result !== 'object') throw new Error('模型没有返回判定结果');
  const answers = (result as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('模型没有返回技能答案');
  const keyed = answers as Record<string, unknown>;
  if (Object.keys(keyed).length !== count) throw new Error('模型返回的技能答案数量不匹配');
  return Array.from({ length: count }, (_, index) => {
    const item = keyed[`skill_${index}`];
    const value = item && typeof item === 'object' ? (item as { noul?: unknown }).noul : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`第 ${index + 1} 项技能的模型答案无效`);
    }
    return value;
  });
}

export class SystemOneSkillScorer implements SkillScorer {
  private layaClient: SharedLayaClient | null = null;
  private layaKey = '';

  constructor(private readonly ctx: WorldContext<SimpleTrpgCheckConfigSection>) {}

  async score(scenario: string, skills: string[]): Promise<number[]> {
    const questions = questionsFor(skills);
    const state = { scenario };
    if (this.ctx.cfg.backend === 'jev') {
      return probabilitiesFrom(await this.requestJev(state, questions), skills.length);
    }
    const result = await this.getLayaClient().systemOne(state, questions);
    return probabilitiesFrom(result, skills.length);
  }

  async close(): Promise<void> {
    const client = this.layaClient;
    this.layaClient = null;
    this.layaKey = '';
    await client?.dispose();
  }

  private getLayaClient(): SharedLayaClient {
    const backend = this.ctx.cfg.backend;
    const variant = backend === 'laya-multilingual' ? 'multilingual' : 'english';
    const pythonExecutable = this.ctx.cfg.pythonExecutable;
    const key = layaRuntimeKey(variant, pythonExecutable);
    if (this.layaClient && this.layaKey === key) return this.layaClient;
    void this.layaClient?.dispose();
    this.layaKey = key;
    this.layaClient = sharedLayaPool().create(
      key,
      () => variant === 'multilingual'
        ? startMultilingualLaya(pythonExecutable)
        : import('@receptron/laya').then(({ Laya }) => Laya.load() as Promise<SharedLayaModel>),
      () => this.ctx.cfg.layaIdleTtlMinutes,
    );
    return this.layaClient;
  }

  private async requestJev(state: unknown, questions: Questions): Promise<unknown> {
    const source = this.ctx.cfg.jevSource;
    const apiKey = source === 'custom' ? this.ctx.secret(SIMPLE_TRPG_CHECK_CUSTOM_SECRET)
      : source === 'openrouter'
        ? this.ctx.secret(SIMPLE_TRPG_CHECK_OPENROUTER_SECRET) || this.ctx.secret(SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET)
        : this.ctx.secret(SIMPLE_TRPG_CHECK_TYPESAFE_SECRET) || this.ctx.secret(SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET)
          || this.ctx.secret(SIMPLE_TRPG_CHECK_CUSTOM_SECRET);
    if (!apiKey) throw new Error(`${source === 'openrouter' ? 'OpenRouter' : source === 'custom' ? '自定义 Jev' : 'TypeSafe'} API key 未配置`);
    const endpoint = source === 'openrouter' ? 'https://openrouter.ai/api/alpha/decisions'
      : source === 'custom' ? this.ctx.cfg.jevEndpoint.trim() : 'https://api.typesafe.ai/v1/systemone';
    if (source === 'custom') {
      let url: URL;
      try { url = new URL(endpoint); } catch { throw new Error('自定义 Jev 服务地址无效'); }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('自定义 Jev 服务地址无效');
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: source === 'openrouter' ? '~typesafe/jev-latest' : 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Jev 请求失败：HTTP ${response.status}`);
    return response.json();
  }
}
