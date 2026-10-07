import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import { levelsFromAnswers, SystemOneSkillScorer } from '../src/model.ts';
import { difficultyFromLevel } from '../src/check.ts';
import { applyReadout, readoutFor } from '../src/readout.ts';
import { LEVEL_OPTIONS, type CheckRequest } from '../src/request.ts';
import { DEFAULT_DECISION_MODELS, OPENROUTER_LUNA_MODEL, SIMPLE_TRPG_CHECK_CUSTOM_SECRET, SIMPLE_TRPG_CHECK_OPENROUTER_SECRET, SIMPLE_TRPG_CHECK_TYPESAFE_SECRET } from '../src/config.ts';

const REQUEST: CheckRequest = {
  character: { traits: '在码头干了八年夜活', condition: '无伤，体力正常' },
  situation: { weather: '普通降雨', gear: '一双软底鞋', info: '仓库布局已知', time: '无时限', senses: '灯光充足' },
  checks: [
    { skill: '跑步', goal: '穿过空地到达仓库门口', evidence: '在码头跑了八年夜活' },
    { skill: '攀爬', goal: '翻上货箱顶部', evidence: '常年在船上爬上爬下' },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe('System One skill scoring', () => {
  it.each([OPENROUTER_LUNA_MODEL, 'decision/fast'])('reads an uncalibrated decision model on the skill and wealth scales', async (model) => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev'; ctx.cfg.jevSource = 'openrouter'; ctx.cfg.jevModel = ` ${model} `;
      ctx.secret = (name) => name === SIMPLE_TRPG_CHECK_OPENROUTER_SECRET ? 'test-key' : '';
      vi.stubGlobal('fetch', async (_url: string, opts: RequestInit) => {
        const body = JSON.parse(String(opts.body));
        if (body.model !== model) return new Response('', { status: 404 });
        return new Response(JSON.stringify({ answers: {
          check_1: { type: 'choice', probabilities: { D: 1 } },
          check_0: { type: 'choice', probabilities: { D: 1 } },
        } }), { status: 200 });
      });
      const request = { ...REQUEST, checks: [REQUEST.checks[0]!, { skill: '财富', goal: '支付大额开支', evidence: '富裕' }] };
      expect(await new SystemOneSkillScorer(ctx).score(request)).toEqual([35, 70]);
    } finally { rmSync(scratchDir, { recursive: true, force: true }); }
  });

  it('replays the captured wealth distributions on every backend', () => {
    const probabilities = [
      { A: 0.99, C: 0.01 },
      { B: 0.99, C: 0.01 },
      { C: 1 },
      { D: 1 },
      { E: 0.99, F: 0.01 },
    ];
    const result = { answers: Object.fromEntries(probabilities.map((p, index) => [
      `check_${index}`, { type: 'choice', probabilities: p },
    ])) };
    for (const backend of ['jev', 'laya', 'laya-multilingual'] as const) {
      const levels = levelsFromAnswers(result, probabilities.map(() => '财富'), backend);
      expect(levels.map(difficultyFromLevel)).toEqual([1, 5, 30, 70, 94]);
    }
  });

  it('rejects a wealth answer whose probability mass is outside the wealth options', () => {
    const result = { answers: { check_0: { type: 'choice', probabilities: { G: 1 } } } };
    expect(() => levelsFromAnswers(result, ['财富'], 'jev')).toThrow('模型答案无效');
  });

  it.each(['财富', '信用', '信用评级', 'Wealth', 'Credit', 'Credit Rating'])(
    'reads %s and ordinary skills on their own scales in input order', async (skill) => {
      const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
      try {
        const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
        ctx.cfg.backend = 'jev';
        ctx.secret = () => 'test-key';
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: {
          check_2: { type: 'choice', probabilities: { E: 1 } },
          check_0: { type: 'choice', probabilities: { F: 1 } },
          check_1: { type: 'choice', probabilities: { D: 1 } },
        } }), { status: 200 }));
        const request: CheckRequest = { ...REQUEST, checks: [
          REQUEST.checks[0]!,
          { skill, goal: '支付一笔大额开支。', evidence: '富裕，随时拿得出大笔现金。' },
          { skill, goal: '支付一笔大额开支。', evidence: '生活无忧且极为奢侈，资产相当可观。' },
        ] };
        const professional = LEVEL_OPTIONS.map((_, index) => index === 5 ? 1 : 0);
        expect(await new SystemOneSkillScorer(ctx).score(request)).toEqual([
          applyReadout(professional, readoutFor('jev')), 70, 94,
        ]);
      } finally {
        rmSync(scratchDir, { recursive: true, force: true });
      }
    },
  );

  it.each([
    ['typesafe', 'https://api.typesafe.ai/v1/systemone', SIMPLE_TRPG_CHECK_TYPESAFE_SECRET],
    ['openrouter', 'https://openrouter.ai/api/alpha/decisions', SIMPLE_TRPG_CHECK_OPENROUTER_SECRET],
    ['custom', 'http://localhost:8080/decisions', SIMPLE_TRPG_CHECK_CUSTOM_SECRET],
  ] as const)('sends one Jev request to %s and restores input order', async (source, endpoint, secretName) => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev';
      ctx.cfg.jevSource = source;
      ctx.cfg.jevEndpoint = endpoint;
      ctx.secret = (name) => name === secretName ? 'test-key' : '';
      vi.stubGlobal('fetch', async (url: string, opts: RequestInit) => {
        expect(url).toBe(endpoint);
        expect(opts.headers).toMatchObject({ authorization: 'Bearer test-key' });
        const body = JSON.parse(String(opts.body)) as {
          model: string;
          state: { message: string };
          questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>;
        };
        expect(body.model).toBe(DEFAULT_DECISION_MODELS[source]);
        expect(JSON.parse(body.state.message)).toEqual({ character: REQUEST.character, situation: REQUEST.situation });
        expect(Object.keys(body.questions)).toEqual(['check_0', 'check_1']);
        expect(body.questions.check_0?.type).toBe('choice');
        expect(body.questions.check_0?.instructions).toContain('跑步');
        expect(body.questions.check_0?.instructions).toContain('在码头跑了八年夜活');
        expect(Object.keys(body.questions.check_0!.criteria)).toEqual([...LEVEL_OPTIONS]);
        expect(body.questions.check_1?.criteria[LEVEL_OPTIONS[LEVEL_OPTIONS.length - 1]!]).toContain('世界顶尖');
        return new Response(JSON.stringify({ answers: {
          check_1: { type: 'choice', choice: 'C', probabilities: { A: 0.5, C: 0.5 } },
          check_0: { type: 'choice', choice: 'A', probabilities: { A: 1 } },
        } }), { status: 200 });
      });
      const readout = readoutFor('jev');
      const oneHot = LEVEL_OPTIONS.map((_, position) => (position === 0 ? 1 : 0));
      const mixed = LEVEL_OPTIONS.map((_, position) => (position === 0 || position === 2 ? 0.5 : 0));
      expect(await new SystemOneSkillScorer(ctx).score(REQUEST)).toEqual([
        applyReadout(oneHot, readout),
        applyReadout(mixed, readout),
      ]);
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('rejects an invalid custom Jev endpoint before fetching', async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev';
      ctx.cfg.jevSource = 'custom';
      ctx.cfg.jevEndpoint = 'file:///tmp/decisions';
      ctx.secret = (name) => name === SIMPLE_TRPG_CHECK_CUSTOM_SECRET ? 'test-key' : '';
      vi.stubGlobal('fetch', () => { throw new Error('unexpected fetch'); });
      await expect(new SystemOneSkillScorer(ctx).score(REQUEST))
        .rejects.toThrow('自定义决策服务地址无效');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('rejects an incomplete model answer', async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev';
      ctx.secret = () => 'test-key';
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: {
        check_0: { type: 'choice', probabilities: { A: 0.2, B: 0.8 } },
      } }), { status: 200 }));
      await expect(new SystemOneSkillScorer(ctx).score(REQUEST))
        .rejects.toThrow('数量不匹配');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('rejects an answer with no usable level distribution', async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev';
      ctx.secret = () => 'test-key';
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answers: {
        check_0: { type: 'choice', choice: 'A', probabilities: {} },
      } }), { status: 200 }));
      await expect(new SystemOneSkillScorer(ctx).score({ ...REQUEST, checks: [REQUEST.checks[0]!] }))
        .rejects.toThrow('第 1 项技能的模型答案无效');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
