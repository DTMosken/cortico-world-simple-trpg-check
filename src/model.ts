import type { WorldContext } from 'cortico/world.ts';
import {
  SIMPLE_TRPG_CHECK_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
  type CheckBackend,
  type SimpleTrpgCheckConfigSection,
} from './config.ts';
import { startMultilingualLaya, type MultilingualLayaModel } from './multilingual-laya.ts';

type Questions = Record<string, { type: 'noul'; instructions: string }>;
type LocalModel = {
  systemOne(state: unknown, questions: Questions): Promise<unknown>;
  close(): Promise<void>;
};

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
  private localModel: Promise<LocalModel | MultilingualLayaModel> | null = null;
  private localBackend: CheckBackend | null = null;

  constructor(private readonly ctx: WorldContext<SimpleTrpgCheckConfigSection>) {}

  async score(scenario: string, skills: string[]): Promise<number[]> {
    const questions = questionsFor(skills);
    const state = { scenario };
    const result = this.ctx.cfg.backend === 'jev'
      ? await this.requestJev(state, questions)
      : await (await this.getLocalModel()).systemOne(state, questions);
    return probabilitiesFrom(result, skills.length);
  }

  async close(): Promise<void> {
    const model = this.localModel;
    this.localModel = null;
    this.localBackend = null;
    if (model) {
      try { await (await model).close(); }
      catch { /* A failed load has no model to close. */ }
    }
  }

  private getLocalModel(): Promise<LocalModel | MultilingualLayaModel> {
    const backend = this.ctx.cfg.backend;
    if (this.localModel && this.localBackend === backend) return this.localModel;
    this.localBackend = backend;
    const loading = backend === 'laya-multilingual'
      ? startMultilingualLaya(this.ctx.cfg.pythonExecutable)
      : import('@receptron/laya').then(({ Laya }) => Laya.load() as Promise<LocalModel>);
    this.localModel = loading;
    void loading.catch(() => {
      if (this.localModel === loading) { this.localModel = null; this.localBackend = null; }
    });
    return this.localModel;
  }

  private async requestJev(state: unknown, questions: Questions): Promise<unknown> {
    const source = this.ctx.cfg.jevSource;
    const secretName = source === 'openrouter'
      ? SIMPLE_TRPG_CHECK_OPENROUTER_SECRET
      : SIMPLE_TRPG_CHECK_TYPESAFE_SECRET;
    const apiKey = this.ctx.secret(secretName);
    if (!apiKey) throw new Error(`${source === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} API key 未配置`);
    const endpoint = source === 'openrouter'
      ? 'https://openrouter.ai/api/v1/systemone'
      : 'https://api.typesafe.ai/v1/systemone';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Jev 请求失败：HTTP ${response.status}`);
    return response.json();
  }
}
