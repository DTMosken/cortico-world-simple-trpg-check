import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import { SimpleTrpgCheckWorld } from '../src/world.ts';
import type { SkillScorer } from '../src/model.ts';
import { SIMPLE_TRPG_CHECK_CUSTOM_SECRET, SIMPLE_TRPG_CHECK_OPENROUTER_SECRET, SIMPLE_TRPG_CHECK_TYPESAFE_SECRET } from '../src/config.ts';

let scratchDir: string;
beforeEach(() => { scratchDir = mkdtempSync(join(tmpdir(), 'simple-trpg-check-')); });
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

const CHECK_ARGS = {
  character: {
    traits: '在码头干了八年夜活，习惯在黑里动手',
    condition: '无伤，体力正常',
  },
  situation: {
    weather: '普通降雨',
    gear: '一双软底鞋',
    info: '仓库布局已知',
    time: '无时限',
    senses: '灯光充足',
  },
  checks: [
    { skill: '跑步', goal: '穿过空地到达仓库门口', evidence: '在码头跑了八年夜活，比巡逻的人快' },
    { skill: '攀爬', goal: '翻上货箱顶部', evidence: '常年在船上爬上爬下' },
  ],
};

const SINGLE_CHECK_ARGS = { ...CHECK_ARGS, checks: [CHECK_ARGS.checks[0]!] };

function withWeather(weather: string) {
  return { ...SINGLE_CHECK_ARGS, situation: { ...SINGLE_CHECK_ARGS.situation, weather } };
}

function withChecks(count: number) {
  return {
    ...CHECK_ARGS,
    checks: Array.from({ length: count }, (_, index) => ({
      skill: `技能${index}`,
      goal: '把手伸进去',
      evidence: '干过很多次',
    })),
  };
}

const CONTEST_ARGS = {
  actor: {
    name: '张三',
    traits: '在码头干了八年夜活',
    condition: '无伤',
    situation: CHECK_ARGS.situation,
    checks: [{ skill: '格斗', goal: '压住对方', evidence: '常年在码头上动手' }],
  },
  opponent: {
    name: '李四',
    traits: '巡夜的人',
    condition: '无伤',
    situation: CHECK_ARGS.situation,
    checks: [{ skill: '闪避', goal: '挣脱', evidence: '躲过许多次抓扯' }],
  },
};

describe('Simple TRPG Check World', () => {
  it('passes the Cortico World dry mount', async () => {
    const report = await dryMountWorld(SIMPLE_TRPG_CHECK, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('evaluates every check before rolling and returns each result in order', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = {
      async score(request) {
        expect(request.character.traits).toContain('码头');
        expect(request.situation.weather).toBe('普通降雨');
        expect(request.checks).toEqual([
          { skill: '跑步', goal: '穿过空地到达仓库门口', evidence: '在码头跑了八年夜活，比巡逻的人快' },
          { skill: '攀爬', goal: '翻上货箱顶部', evidence: '常年在船上爬上爬下' },
        ]);
        return [20, 80];
      },
      async close() {},
    };
    const rolls = [38, 20];
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => rolls.shift()!);
    const result = await world.tools()[0]!.handler(CHECK_ARGS, {} as ToolCallContext);
    expect(result).toEqual({ text: '跑步：普通失败 [38/20]\n此次跑步普通失败了。\n\n攀爬：极难成功 [20/80]\n此次攀爬极难成功了。酌情（可选）给予小奖励。'
      + '\n\n显示：\n【跑步检定：38/20 失败】\n【攀爬检定：20/80 极难成功】' });
  });

  it('does not roll when any model answer is missing', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [20]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler(CHECK_ARGS, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：模型返回的技能答案数量不匹配' });
  });

  it('weighs Chinese text twice as heavily as English against the state budget', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    let scored = 0;
    const scorer: SkillScorer = { async score() { scored += 1; return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    const rejected = await world.tools()[0]!.handler(withWeather('攀'.repeat(1500)), {} as ToolCallContext) as { text: string };
    expect(rejected.text).toContain('输入超出预算');
    expect(rejected.text).toContain('上限 768');
    expect(scored).toBe(0);
    const accepted = await world.tools()[0]!.handler(withWeather('a'.repeat(1500)), {} as ToolCallContext) as { text: string };
    expect(accepted.text).not.toContain('输入超出预算');
    expect(scored).toBe(1);
  });

  it('charges other characters the conservative weight against the state budget', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    const result = await world.tools()[0]!.handler(withWeather('！'.repeat(800)), {} as ToolCallContext) as { text: string };
    expect(result.text).toContain('输入超出预算');
    expect(result.text).toContain('上限 768');
  });

  it('refuses a request whose single question breaks the option-head budget', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    const args = {
      ...SINGLE_CHECK_ARGS,
      checks: [{ skill: '开锁', goal: '撬'.repeat(400), evidence: '锁'.repeat(400) }],
    };
    const result = await world.tools()[0]!.handler(args, {} as ToolCallContext) as { text: string };
    expect(result.text).toContain('输入超出预算');
    expect(result.text).toContain('第 1 项问题');
    expect(result.text).toContain('上限 256');
    expect(result.text).not.toContain('总输入');
  });

  it('rejects a request that omits one of the six situation fields', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { throw new Error('model should not be called'); }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const situation: Partial<typeof CHECK_ARGS.situation> = { ...CHECK_ARGS.situation };
    delete situation.senses;
    const result = await world.tools()[0]!.handler({ ...CHECK_ARGS, situation }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：situation.senses 不能为空' });
  });

  it('rejects an empty check list', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { throw new Error('model should not be called'); }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler({ ...CHECK_ARGS, checks: [] }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：checks 必须是非空数组' });
  });

  it('trims padded text before it reaches the receipt', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = {
      async score(request) {
        expect(request.checks).toEqual([{ skill: '跑步', goal: '穿过空地', evidence: '八年夜活' }]);
        return [50];
      },
      async close() {},
    };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    const result = await world.tools()[0]!.handler({
      ...SINGLE_CHECK_ARGS,
      checks: [{ skill: ' 跑步 ', goal: ' 穿过空地 ', evidence: ' 八年夜活 ' }],
    }, {} as ToolCallContext) as { text: string };
    expect(result.text).toContain('跑步：');
  });

  it('refuses a request whose total input breaks the request budget', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    const result = await world.tools()[0]!.handler(withChecks(24), {} as ToolCallContext) as { text: string };
    expect(result.text).toContain('输入超出预算');
    expect(result.text).toContain('总输入');
    expect(result.text).toContain('上限 1000');
    expect(result.text).not.toContain('上限 768');
    expect(result.text).not.toContain('第 1 项问题');
  });

  it('changes only the agent language instruction when the checkbox changes', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = SIMPLE_TRPG_CHECK.create(ctx);
    expect((await world.envPromptVars())?.['simpleTrpgCheck.languageRule']).toBe('');
    ctx.persist({ forceMultilingual: true });
    expect((await world.envPromptVars())?.['simpleTrpgCheck.languageRule']).toContain('英文填写');
  });

  it('saves declared fields through the config panel and rejects invalid values', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = new SimpleTrpgCheckWorld(ctx);
    expect(world.console().config).toBeUndefined();
    expect(await world.console().invoke?.('config', 'save', ['backend', 'jev']))
      .toMatchObject({ config: { backend: 'jev' } });
    expect(ctx.cfg.backend).toBe('jev');
    await expect(world.console().invoke?.('config', 'save', ['backend', 'invalid']))
      .rejects.toThrow('配置值无效');
    await expect(world.console().invoke?.('config', 'save', ['enabled', false]))
      .rejects.toThrow('未知配置项');
  });

  it('opens a deployment key file with the selected Jev placeholder and rejects a stale source', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    ctx.cfg.backend = 'jev';
    const opened: string[] = [];
    const scorer: SkillScorer = { async score() { return [0.5]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20, (file) => { opened.push(file); });
    const panel = world.console?.();
    expect(panel?.panels).toEqual([{ id: 'config', title: '配置' }]);
    expect(await panel?.invoke?.('config', 'state', [])).toMatchObject({ config: { jevSource: 'typesafe' }, keySet: false });
    const first = await panel?.invoke?.('config', 'openKeyFile', ['typesafe']) as { file: string };
    expect(opened).toEqual([first.file]);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`);
    ctx.cfg.jevSource = 'custom';
    await panel?.invoke?.('config', 'openKeyFile', ['custom']);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_CUSTOM_SECRET}=`);
    ctx.cfg.jevSource = 'typesafe';
    await panel?.invoke?.('config', 'openKeyFile', ['typesafe']);
    expect(readFileSync(first.file, 'utf8').match(new RegExp(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`, 'g'))).toHaveLength(1);
    writeFileSync(first.file, `${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=existing-value\n`);
    await panel?.invoke?.('config', 'openKeyFile', ['typesafe']);
    expect(readFileSync(first.file, 'utf8')).toBe(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=existing-value\n`);
    ctx.cfg.jevSource = 'openrouter';
    await expect(panel?.invoke?.('config', 'openKeyFile', ['typesafe']))
      .rejects.toThrow('来源已改变');
    await panel?.invoke?.('config', 'openKeyFile', ['openrouter']);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_OPENROUTER_SECRET}=`);
    expect(readFileSync(first.file, 'utf8')).toContain(`${SIMPLE_TRPG_CHECK_TYPESAFE_SECRET}=`);
  });

  it('lights the model lamp after a successful score and clears it on source change', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [0.5]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 20);
    expect(world.console().lamps?.[0]?.state).toBe('offline');
    await world.tools()[0]!.handler(SINGLE_CHECK_ARGS, {} as ToolCallContext);
    expect(world.console().lamps?.[0]?.state).toBe('online');
    ctx.cfg.backend = 'jev';
    expect(world.console().lamps?.[0]?.state).toBe('offline');
  });

  it('tests the selected model with one score, lights the lamp, and never rolls dice', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    ctx.cfg.backend = 'jev';
    const scorer: SkillScorer = {
      async score(request) {
        expect(request.situation.weather).toContain('Clear');
        expect(request.checks).toEqual([{
          skill: 'climbing',
          goal: 'climb a waist-high wall to reach the other side',
          evidence: 'A working guide who climbs walls like this most weeks.',
        }]);
        return [0.7];
      },
      async close() {},
    };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    expect(world.console().panels).toEqual([{ id: 'config', title: '配置' }]);
    expect(await world.console().invoke?.('config', 'testConnection', [])).toEqual({ ok: true });
    expect(world.console().lamps?.[0]?.state).toBe('online');
  });

  it('reports a failed model test and shows an error lamp', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { throw new Error('connection refused'); }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer);
    expect(await world.console().invoke?.('config', 'testConnection', [])).toEqual({
      ok: false,
      error: 'connection refused',
    });
    expect(world.console().lamps?.[0]?.state).toBe('error');
  });

  it('never asks the model when the compensation crosses the auto threshold', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    let scored = 0;
    const scorer: SkillScorer = { async score() { scored += 1; return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler({
      ...SINGLE_CHECK_ARGS,
      checks: [{ ...SINGLE_CHECK_ARGS.checks[0]!, bonus: 3 }],
    }, {} as ToolCallContext);
    expect(scored).toBe(0);
    expect(result).toEqual({
      text: '跑步：自动成功（优势过大 +3）\n本次未调用判定模型。'
        + '\n\n显示：\n【跑步检定|自动成功：优势过大（+3）】',
    });
  });

  it('only asks the model about the checks that still need a difficulty', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const asked: string[] = [];
    const scorer: SkillScorer = {
      async score(request) { asked.push(...request.checks.map((check) => check.skill)); return [20]; },
      async close() {},
    };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 38);
    const result = await world.tools()[0]!.handler({
      ...CHECK_ARGS,
      checks: [{ ...CHECK_ARGS.checks[0]!, bonus: -3 }, CHECK_ARGS.checks[1]!],
    }, {} as ToolCallContext) as { text: string };
    expect(asked).toEqual(['攀爬']);
    expect(result.text).toContain('跑步：自动失败（劣势过大 −3）');
    expect(result.text).toContain('\n\n显示：\n【跑步检定|自动失败：劣势过大（−3）】\n【攀爬检定：38/20 失败】');
  });

  it('rolls a joint group once against the smallest difficulty', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { return [60, 40]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 35);
    const result = await world.tools()[0]!.handler({ ...CHECK_ARGS, joint: 'and' }, {} as ToolCallContext);
    expect(result).toEqual({
      text: '跑步&攀爬：普通成功 35/[60; 40]\n此次跑步&攀爬普通成功了。'
        + '\n\n显示：\n【[跑步&攀爬]组合检定|全部：35/[60; 40] 成功】',
    });
  });

  it('rejects a joint check with fewer than two skills', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = { async score() { throw new Error('model should not be called'); }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler({ ...SINGLE_CHECK_ARGS, joint: 'and' }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：组合检定至少需要两项技能' });
  });

  it('rejects a joint check that also carries a grade', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    let scored = 0;
    const scorer: SkillScorer = { async score() { scored += 1; return [60, 40]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[0]!.handler({
      ...CHECK_ARGS,
      joint: 'and',
      checks: [{ ...CHECK_ARGS.checks[0]!, grade: 1 }, CHECK_ARGS.checks[1]!],
    }, {} as ToolCallContext);
    expect(scored).toBe(0);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：组合检定不能与 grade 同时使用' });
  });

  it('rejects an unusable bonus, grade or joint value', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = new SimpleTrpgCheckWorld(ctx, { async score() { return [50]; }, async close() {} });
    const withCheck = (check: Record<string, unknown>) => ({ ...SINGLE_CHECK_ARGS, checks: [check] });
    const first = SINGLE_CHECK_ARGS.checks[0]!;
    expect(await world.tools()[0]!.handler(withCheck({ ...first, bonus: 1.5 }), {} as ToolCallContext))
      .toMatchObject({ text: '技能判定失败：checks[0].bonus 必须是整数' });
    expect(await world.tools()[0]!.handler(withCheck({ ...first, grade: 3 }), {} as ToolCallContext))
      .toMatchObject({ text: '技能判定失败：checks[0].grade 必须是 1 或 2' });
    expect(await world.tools()[0]!.handler({ ...SINGLE_CHECK_ARGS, joint: 'xor' }, {} as ToolCallContext))
      .toMatchObject({ text: '技能判定失败：joint 必须是 and 或 or' });
  });

  it('resolves a contest with one model request per side', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const asked: string[] = [];
    const scorer: SkillScorer = {
      async score(request) {
        asked.push(request.checks[0]!.skill);
        return request.checks[0]!.skill === '格斗' ? [62] : [40];
      },
      async close() {},
    };
    const rolls = [30, 35];
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => rolls.shift()!);
    const result = await world.tools()[1]!.handler(CONTEST_ARGS, {} as ToolCallContext);
    expect(asked).toEqual(['格斗', '闪避']);
    expect(result).toEqual({
      text: '张三 格斗 困难成功 [30/62]；李四 闪避 普通成功 [35/40]'
        + '\n\n显示：\n张三【格斗 30/62 困难成功】 对抗 李四【闪避 35/40 成功】：张三胜出',
    });
  });

  it('rounds fractional model levels before they reach the receipt', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const scorer: SkillScorer = {
      async score(request) { return request.checks[0]!.skill === '格斗' ? [72.6] : [53.4]; },
      async close() {},
    };
    const rolls = [30, 35];
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => rolls.shift()!);
    const result = await world.tools()[1]!.handler(CONTEST_ARGS, {} as ToolCallContext);
    expect(result).toEqual({
      text: '张三 格斗 困难成功 [30/73]；李四 闪避 普通成功 [35/53]'
        + '\n\n显示：\n张三【格斗 30/73 困难成功】 对抗 李四【闪避 35/53 成功】：张三胜出',
    });
  });

  it('skips both sides of a contest when the verdict is automatic', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    let scored = 0;
    const scorer: SkillScorer = { async score() { scored += 1; return [50]; }, async close() {} };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[1]!.handler({
      ...CONTEST_ARGS,
      opponent: { ...CONTEST_ARGS.opponent, bonus: -3 },
    }, {} as ToolCallContext);
    expect(scored).toBe(0);
    expect(result).toEqual({
      text: '张三 跳过检定；李四 自动失败（劣势过大 −3）'
        + '\n\n显示：\n张三【跳过检定】 对抗 李四【闪避 自动失败（劣势过大 −3）】：张三胜出',
    });
  });

  it('fails the whole contest and rolls nothing when one side cannot be judged', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    let calls = 0;
    const scorer: SkillScorer = {
      async score() { calls += 1; return calls === 1 ? [62] : []; },
      async close() {},
    };
    const world = new SimpleTrpgCheckWorld(ctx, scorer, () => { throw new Error('dice were rolled'); });
    const result = await world.tools()[1]!.handler(CONTEST_ARGS, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：对方 模型返回的技能答案数量不匹配' });
  });

  it('requires joint on a contest side that lists more than one skill', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = new SimpleTrpgCheckWorld(ctx, { async score() { return [50]; }, async close() {} });
    const result = await world.tools()[1]!.handler({
      ...CONTEST_ARGS,
      actor: { ...CONTEST_ARGS.actor, checks: [CONTEST_ARGS.actor.checks[0]!, CONTEST_ARGS.actor.checks[0]!] },
    }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：对抗检定中 checks 多于一项时必须指定 joint' });
  });

  it('rejects a grade inside a contest', async () => {
    const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
    const world = new SimpleTrpgCheckWorld(ctx, { async score() { return [50]; }, async close() {} });
    const result = await world.tools()[1]!.handler({
      ...CONTEST_ARGS,
      actor: { ...CONTEST_ARGS.actor, checks: [{ ...CONTEST_ARGS.actor.checks[0]!, grade: 1 }] },
    }, {} as ToolCallContext);
    expect(result).toMatchObject({ failed: true, text: '技能判定失败：对抗检定不支持 grade' });
  });
});
