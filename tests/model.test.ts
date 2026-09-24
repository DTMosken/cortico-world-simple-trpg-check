import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import { SystemOneSkillScorer } from '../src/model.ts';
import { SIMPLE_TRPG_CHECK_OPENROUTER_SECRET, SIMPLE_TRPG_CHECK_TYPESAFE_SECRET } from '../src/config.ts';

afterEach(() => vi.unstubAllGlobals());

describe('System One skill scoring', () => {
  it.each([
    ['typesafe', 'https://api.typesafe.ai/v1/systemone', SIMPLE_TRPG_CHECK_TYPESAFE_SECRET],
    ['openrouter', 'https://openrouter.ai/api/alpha/decisions', SIMPLE_TRPG_CHECK_OPENROUTER_SECRET],
  ] as const)('sends one Jev request to %s and restores input order', async (source, endpoint, secretName) => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-model-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      ctx.cfg.backend = 'jev';
      ctx.cfg.jevSource = source;
      ctx.secret = (name) => name === secretName ? 'test-key' : '';
      vi.stubGlobal('fetch', async (url: string, opts: RequestInit) => {
        expect(url).toBe(endpoint);
        expect(opts.headers).toMatchObject({ authorization: 'Bearer test-key' });
        const body = JSON.parse(String(opts.body)) as {
          model: string;
          state: { scenario: string };
          questions: Record<string, { type: string; instructions: string }>;
        };
        expect(body.model).toBe(source === 'openrouter' ? '~typesafe/jev-latest' : 'jev-latest');
        expect(body.state.scenario).toBe('穿过山谷');
        expect(Object.keys(body.questions)).toEqual(['skill_0', 'skill_1']);
        expect(body.questions.skill_0?.instructions).toContain('跑步');
        expect(body.questions.skill_1?.instructions).toContain('攀爬');
        return new Response(JSON.stringify({ answers: {
          skill_1: { type: 'noul', noul: 0.8 },
          skill_0: { type: 'noul', noul: 0.2 },
        } }), { status: 200 });
      });
      expect(await new SystemOneSkillScorer(ctx).score('穿过山谷', ['跑步', '攀爬'])).toEqual([0.2, 0.8]);
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
        skill_0: { type: 'noul', noul: 0.2 },
      } }), { status: 200 }));
      await expect(new SystemOneSkillScorer(ctx).score('情境', ['跑步', '攀爬']))
        .rejects.toThrow('数量不匹配');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
