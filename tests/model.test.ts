import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import { SystemOneSkillScorer } from '../src/model.ts';
import { applyReadout, readoutFor } from '../src/readout.ts';
import { LEVEL_OPTIONS, type CheckRequest } from '../src/request.ts';
import { SIMPLE_TRPG_CHECK_CUSTOM_SECRET, SIMPLE_TRPG_CHECK_OPENROUTER_SECRET, SIMPLE_TRPG_CHECK_TYPESAFE_SECRET } from '../src/config.ts';

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
        expect(body.model).toBe(source === 'openrouter' ? '~typesafe/jev-latest' : 'jev-latest');
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
        .rejects.toThrow('自定义 Jev 服务地址无效');
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
