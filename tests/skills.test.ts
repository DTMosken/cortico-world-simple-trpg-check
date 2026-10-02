import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { SIMPLE_TRPG_CHECK } from '../src/definition.ts';
import type { SkillScorer } from '../src/model.ts';
import { LEVEL_OPTIONS, budgetViolation, levelBands, questionsFor, type CheckRequest } from '../src/request.ts';
import { SimpleTrpgCheckWorld } from '../src/world.ts';
import { ALL_SKILL_NAMES, COC_SKILLS } from './helpers/coc-skills.ts';

const CHARACTER = { traits: '无特别之处。', condition: '无异常。' };
const SITUATION = { weather: '普通降雨', gear: '一双软底鞋', info: '布局已知', time: '无时限', senses: '灯光充足' };

function requestFor(skills: string[]): CheckRequest {
  return {
    character: { ...CHARACTER },
    situation: { ...SITUATION },
    checks: skills.map((skill) => ({ skill, goal: '在时限内达成眼前的目标。', evidence: '靠它吃饭多年，处理过大量同类情形。' })),
  };
}

describe('常用技能表', () => {
  it('keeps the expected coverage', () => {
    expect(COC_SKILLS).toHaveLength(29);
    expect(COC_SKILLS.map((entry) => entry.name)).toContain('财富');
    expect(COC_SKILLS.find((entry) => entry.name === '巧手')?.aliases).toEqual(['Sleight of Hand', '偷窃', '伪造', '锁匠']);
  });

  it('keeps every skill name and alias inside the budget with its own scale', () => {
    for (const skill of ALL_SKILL_NAMES) {
      const request = requestFor([skill]);
      for (const chinese of [true, false]) {
        expect(budgetViolation(request, chinese)).toBeNull();
        const question = questionsFor(request, chinese).check_0!;
        expect(question.instructions).toContain(skill);
        expect(Object.keys(question.criteria)).toEqual(LEVEL_OPTIONS.slice(0, levelBands(chinese, skill).length));
      }
    }
  });

  it('offers wealth descriptions for wealth and its aliases in both languages', () => {
    const wealth = COC_SKILLS.find((entry) => entry.name === '财富')!;
    for (const skill of [wealth.name, ...wealth.aliases]) {
      const request = requestFor([skill]);
      const chinese = questionsFor(request, true).check_0!.criteria;
      const english = questionsFor(request, false).check_0!.criteria;
      expect(Object.keys(chinese)).toHaveLength(6);
      expect(Object.keys(english)).toHaveLength(6);
      expect(chinese.D).toContain('富裕');
      expect(english.D).toContain('Wealthy');
      expect(chinese.F).toContain('超级有钱');
      expect(english.F).toContain('Extremely wealthy');
    }
  });

  it('lists the same skills in the environment prompt', () => {
    const prompt = readFileSync(fileURLToPath(new URL('../src/ENV_PROMPT.md', import.meta.url)), 'utf8');
    for (const entry of COC_SKILLS) expect(prompt).toContain(entry.name);
  });

  it('scores a mixed list of common skills in input order', async () => {
    const scratchDir = mkdtempSync(join(tmpdir(), 'trpg-skills-'));
    try {
      const ctx = fakeWorldContext(SIMPLE_TRPG_CHECK, { scratchDir });
      const seen: string[] = [];
      const scorer: SkillScorer = {
        async score(request) {
          seen.push(...request.checks.map((check) => check.skill));
          return request.checks.map((_, index) => 20 + index);
        },
        async close() {},
      };
      const world = new SimpleTrpgCheckWorld(ctx, scorer, () => 10);
      const names = ['智力', '灵感', '射击（步枪）', '财富'];
      const result = await world.tools()[0]!.handler({ ...requestFor(names) }, {} as ToolCallContext) as { text: string };
      expect(seen).toEqual(names);
      for (const name of names) expect(result.text).toContain(`${name}：`);
      expect(result.text).not.toContain('技能判定失败');
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });
});
