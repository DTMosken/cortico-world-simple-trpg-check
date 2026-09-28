import type { WorldContext } from 'cortico/world.ts';
import {
  SIMPLE_TRPG_CHECK_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_CUSTOM_SECRET,
  SIMPLE_TRPG_CHECK_TYPESAFE_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET,
  SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET,
  type CheckBackend,
  type SimpleTrpgCheckConfigSection,
} from './config.ts';
import { startMultilingualLaya } from './multilingual-laya.ts';
import { applyReadout, readoutFor } from './readout.ts';
import { LEVEL_OPTIONS, questionsFor, serializeState, type CheckRequest, type LevelQuestion } from './request.ts';
import { layaRuntimeKey, sharedLayaPool, type SharedLayaClient, type SharedLayaModel } from './shared-laya.ts';

type Questions = Record<string, LevelQuestion>;
export interface SkillScorer {
  /** 返回每项技能的期望水平（0–100）。 */
  score(request: CheckRequest): Promise<number[]>;
  close(): Promise<void>;
}

/**
 * 英文检查点默认只有 512 上下文（192 选项头 + 320 情境），装不下世界统一的 1000 token 预算，
 * 长情境会被静默截断。这里把它提到与 multilingual 相同的 1024，使两个后端的预算一致；
 * 该提升尚未用真实权重验证过，配置页的“测试连接”可以当场暴露失败。
 */
export async function loadEnglishLaya(): Promise<SharedLayaModel> {
  const { Laya } = await import('@receptron/laya');
  const model = await Laya.load();
  const config = (model as unknown as { config: { max_len: number; head_max_len: number } }).config;
  config.max_len = 1024;
  config.head_max_len = 256;
  return model;
}

/**
 * 水平读出：模型对每项技能给出档位分布（十档），读出把分布映射成 0–100 的水平。
 * Jev 走离线训练产物（src/level-readout.ts；训练与选择见 evals/train.ts），运行时只做插值，不训练。
 * 本地 Laya 检查点实测读不出水平证据（极端证据只挪动 15 点），保持恒等读出。
 */

/** 读一项技能的档位概率分布并归一化；缺项按 0 计。无效时抛错。 */
export function probabilityVector(item: unknown, label: string): number[] {
  const probabilities = item && typeof item === 'object' ? (item as { probabilities?: unknown }).probabilities : undefined;
  if (!probabilities || typeof probabilities !== 'object') throw new Error(`${label}的模型答案无效`);
  const distribution = probabilities as Record<string, unknown>;
  const shares = LEVEL_OPTIONS.map((option) => {
    const share = distribution[option];
    if (share === undefined) return 0;
    if (typeof share !== 'number' || !Number.isFinite(share) || share < 0 || share > 1) {
      throw new Error(`${label}的模型答案无效`);
    }
    return share;
  });
  const mass = shares.reduce((sum, share) => sum + share, 0);
  if (mass <= 0) throw new Error(`${label}的模型答案无效`);
  return shares.map((share) => share / mass);
}

/** 读模型答案里的档位分布，过一遍对应后端的水平读出。 */
export function levelsFromAnswers(result: unknown, count: number, backend: CheckBackend): number[] {
  if (!result || typeof result !== 'object') throw new Error('模型没有返回判定结果');
  const answers = (result as { answers?: unknown }).answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('模型没有返回技能答案');
  const keyed = answers as Record<string, unknown>;
  if (Object.keys(keyed).length !== count) throw new Error('模型返回的技能答案数量不匹配');
  const readout = readoutFor(backend);
  return Array.from({ length: count }, (_, index) => applyReadout(
    probabilityVector(keyed[`check_${index}`], `第 ${index + 1} 项技能`),
    readout,
  ));
}

export class SystemOneSkillScorer implements SkillScorer {
  private layaClient: SharedLayaClient | null = null;
  private layaKey = '';

  constructor(private readonly ctx: WorldContext<SimpleTrpgCheckConfigSection>) {}

  async score(request: CheckRequest): Promise<number[]> {
    const state = { message: serializeState(request) };
    const questions = questionsFor(request, !this.ctx.cfg.forceMultilingual);
    const result = this.ctx.cfg.backend === 'jev'
      ? await this.requestJev(state, questions)
      : await this.getLayaClient().systemOne(state, questions);
    return levelsFromAnswers(result, request.checks.length, this.ctx.cfg.backend);
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
      () => variant === 'multilingual' ? startMultilingualLaya(pythonExecutable) : loadEnglishLaya(),
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
