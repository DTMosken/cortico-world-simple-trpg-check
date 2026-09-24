import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import { SimpleTrpgCheckWorld } from '../src/world.ts';
import type { SkillScorer } from '../src/model.ts';
import { SIMPLE_TRPG_CHECK_OPENROUTER_SECRET, SIMPLE_TRPG_CHECK_TYPESAFE_SECRET } from '../src/config.ts';

let scratchDir: string;
beforeEach(() => { scratchDir = mkdtempSync(join(tmpdir(), 'simple-trpg-check-')); });
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

describe('Simple TRPG Check World', () => {
  it('passes the Cortico World dry mount', async () => {
    const report = await dryMountWorld(SIMPLE_TRPG_CHECK, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('evaluates all skills before rolling and returns each result in order', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = {
      async score(scenario, skills) {
        expect(scenario).toContain('瘸子');
        expect(skills).toEqual(['跑步', '攀爬']);
        return [0.2, 0.8];
      },
      async close() {},
    };
    const rolls = [38, 20];
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => rolls.shift()!);
    const result = await world.tools()[0]!.handler({ scenario: '瘸子试图逃跑', skill_lists: ['跑步', '攀爬'] }, {} as ToolCallContext);
    expect(result).toEqual({ text: '跑步：普通失败 [38/20]\n此次跑步普通失败了。\n\n攀爬：极难成功 [20/80]\n此次攀爬极难成功了。酌情给予小奖励。' });
  });

  it('does not roll when any model answer is missing', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [0.2]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler({ scenario: '尝试逃跑', skill_lists: ['跑步', '攀爬'] }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：模型返回的技能答案数量不匹配' });
  });

  it('changes only the agent language instruction when the checkbox changes', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = SIMPLE_TRPG_CHECK.create(ctx);
    expect((await world.envPromptVars())?.['simpleTrpgCheck.languageRule']).toBe('');
    ctx.persist({ forceMultilingual: true });
    expect((await world.envPromptVars())?.['simpleTrpgCheck.languageRule']).toContain('英文填写');
  });

  it('saves the selected Jev source key in deployment secrets and rejects a stale source', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const saved = new Map<string, string>();
    ctx.cfg.backend = 'jev';
    ctx.secret = (name) => saved.get(name) ?? '';
    ctx.storeSecret = (name, value) => { saved.set(name, value); };
    const world = SIMPLE_TRPG_CHECK.create(ctx);
    const panel = world.console?.();
    expect(await panel?.invoke?.('credentials', 'state', [])).toMatchObject({ source: 'typesafe', keySet: false });
    await panel?.invoke?.('credentials', 'saveKey', ['typesafe', 'first-key']);
    expect(saved.get(SIMPLE_TRPG_CHECK_TYPESAFE_SECRET)).toBe('first-key');
    ctx.cfg.jevSource = 'openrouter';
    await expect(panel?.invoke?.('credentials', 'saveKey', ['typesafe', 'wrong-key']))
      .rejects.toThrow('来源已改变');
    await panel?.invoke?.('credentials', 'saveKey', ['openrouter', 'second-key']);
    expect(saved.get(SIMPLE_TRPG_CHECK_OPENROUTER_SECRET)).toBe('second-key');
    expect(saved.get(SIMPLE_TRPG_CHECK_TYPESAFE_SECRET)).toBe('first-key');
  });
});
