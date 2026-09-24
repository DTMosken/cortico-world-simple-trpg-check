import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('opens a deployment key file with the selected Jev placeholder and rejects a stale source', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    ctx.cfg.backend = 'jev';
    const opened: string[] = [];
    const scorer: SkillScorer = { async score() { return [0.5]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20, (file) => { opened.push(file); });
    const panel = world.console?.();
    expect(panel?.panels?.[0]).toMatchObject({ id: 'credentials', slot: 'jev-key' });
    expect(await panel?.invoke?.('credentials', 'state', [])).toMatchObject({ source: 'typesafe', keySet: false });
    const first = await panel?.invoke?.('credentials', 'openKeyFile', ['typesafe']) as { file: string };
    expect(opened).toEqual([first.file]);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`);
    await panel?.invoke?.('credentials', 'openKeyFile', ['typesafe']);
    expect(readFileSync(first.file, 'utf8').match(new RegExp(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`, 'g'))).toHaveLength(1);
    writeFileSync(first.file, `${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=existing-value\n`);
    await panel?.invoke?.('credentials', 'openKeyFile', ['typesafe']);
    expect(readFileSync(first.file, 'utf8')).toBe(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=existing-value\n`);
    ctx.cfg.jevSource = 'openrouter';
    await expect(panel?.invoke?.('credentials', 'openKeyFile', ['typesafe']))
      .rejects.toThrow('来源已改变');
    await panel?.invoke?.('credentials', 'openKeyFile', ['openrouter']);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_OPENROUTER_SECRET}=`);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`);
  });

  it('lights the model lamp after a successful score and clears it on source change', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [0.5]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    expect(world.console().lamps?.[0]?.state).toBe('offline');
    await world.tools()[0]!.handler({ scenario: '爬过墙', skill_lists: ['攀爬'] }, {} as ToolCallContext);
    expect(world.console().lamps?.[0]?.state).toBe('online');
    ctx.cfg.backend = 'jev';
    expect(world.console().lamps?.[0]?.state).toBe('offline');
  });
});
