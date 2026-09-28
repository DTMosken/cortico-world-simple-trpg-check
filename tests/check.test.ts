import { describe, expect, it } from 'vitest';
import {
  adviceFor,
  autoVerdict,
  BAND_RANK,
  classify,
  difficultyFromLevel,
  effectiveBonus,
  effectiveDifficulty,
  rollDice,
  type CheckResult,
  type Grade,
} from '../src/check.ts';

const SUCCESSES: CheckResult[] = ['大成功', '极难成功', '困难成功', '普通成功'];
const ROLLS = Array.from({ length: 100 }, (_, index) => index + 1);

function countSuccesses(difficulty: number, grade?: Grade): number {
  return ROLLS.filter((roll) => SUCCESSES.includes(classify(roll, difficulty, grade))).length;
}

/** 依次吐出给定骰值的掷骰器。 */
function diceSource(sequence: number[]): () => number {
  const dice = [...sequence];
  return () => dice.shift()!;
}

describe('TRPG check rules', () => {
  it('rounds the model level to the nearest difficulty and clamps to 1–99', () => {
    expect([0, 1.9, 20.5, 98.5, 100].map(difficultyFromLevel)).toEqual([1, 2, 21, 99, 99]);
    expect(() => difficultyFromLevel(Number.NaN)).toThrow();
    expect(() => difficultyFromLevel(101)).toThrow();
  });

  it('keeps the chance of success at exactly difficulty/100 while uncompensated', () => {
    for (let difficulty = 1; difficulty <= 99; difficulty += 1) {
      expect(countSuccesses(difficulty), `难度 ${difficulty}`).toBe(difficulty);
    }
  });

  it('uses critical rolls before the success thresholds', () => {
    expect(classify(1, 1)).toBe('大成功');
    expect(classify(100, 99)).toBe('大失败');
    expect(classify(99, 99)).toBe('普通成功');
    expect(classify(20, 80)).toBe('极难成功');
    expect(classify(40, 80)).toBe('困难成功');
    expect(classify(80, 80)).toBe('普通成功');
    expect(classify(81, 80)).toBe('普通失败');
  });

  it('overrides the displayed band under a grade without moving the thresholds', () => {
    // 80 难度下 20 是极难区、40 是困难区、80 是普通成功区，这些边界不因 grade 改变。
    expect(classify(20, 80, 1)).toBe('极难成功');
    expect(classify(20, 80, 2)).toBe('普通成功');
    expect(classify(40, 80, 1)).toBe('普通成功');
    expect(classify(40, 80, 2)).toBe('普通失败');
    expect(classify(80, 80, 1)).toBe('普通失败');
    expect(classify(80, 80, 2)).toBe('普通失败');
    expect(classify(81, 80, 1)).toBe('普通失败');
  });

  it('never lets a grade move the critical bands', () => {
    for (const grade of [1, 2] as const) {
      expect(classify(1, 80, grade)).toBe('大成功');
      expect(classify(100, 80, grade)).toBe('大失败');
      expect(classify(1, 1, grade)).toBe('大成功');
      expect(classify(100, 99, grade)).toBe('大失败');
    }
  });

  it('makes the hard band unreachable at grade 1 and the extreme band unreachable at grade 2', () => {
    for (let difficulty = 1; difficulty <= 99; difficulty += 1) {
      expect(ROLLS.filter((roll) => classify(roll, difficulty, 1) === '困难成功'), `难度 ${difficulty}`).toEqual([]);
      expect(ROLLS.filter((roll) => classify(roll, difficulty, 2) === '极难成功'), `难度 ${difficulty}`).toEqual([]);
      expect(ROLLS.filter((roll) => classify(roll, difficulty, 2) === '困难成功'), `难度 ${difficulty}`).toEqual([]);
    }
  });

  it('halves and then quarters the effective success chance under a grade', () => {
    for (let difficulty = 1; difficulty <= 99; difficulty += 1) {
      expect(countSuccesses(difficulty, 1), `难度 ${difficulty}`).toBe(Math.max(1, Math.floor(difficulty / 2)));
      expect(countSuccesses(difficulty, 2), `难度 ${difficulty}`).toBe(Math.max(1, Math.floor(difficulty / 4)));
    }
  });

  it('rolls one die plus one per bonus step and keeps the extreme', () => {
    expect(rollDice(diceSource([45, 12, 71]), 2)).toEqual({ dice: [45, 12, 71], chosen: 12 });
    expect(rollDice(diceSource([45, 12]), -1)).toEqual({ dice: [45, 12], chosen: 45 });
    expect(rollDice(() => 7, 0)).toEqual({ dice: [7], chosen: 7 });
    expect(rollDice(() => 3, -2).dice).toHaveLength(3);
    expect(() => rollDice(() => 3, 1.5)).toThrow('必须是整数');
  });

  it('classifies only the chosen die', () => {
    // 优势取最低：选中 1 就是大成功，另一颗 100 不参与判定。
    expect(classify(rollDice(diceSource([1, 100]), 1).chosen, 60)).toBe('大成功');
    // 劣势取最高：选中 100 就是大失败。
    expect(classify(rollDice(diceSource([1, 100]), -1).chosen, 60)).toBe('大失败');
    // 优势下出现 100 需要每一颗都是 100，劣势下出现 1 需要每一颗都是 1。
    expect(rollDice(diceSource([100, 100]), 1).chosen).toBe(100);
    expect(rollDice(diceSource([1, 1]), -1).chosen).toBe(1);
  });

  it('auto-resolves once |bonus| reaches 3', () => {
    expect([0, 1, 2, -1, -2].map(autoVerdict)).toEqual([null, null, null, null, null]);
    expect(autoVerdict(3)).toBe('成功');
    expect(autoVerdict(-3)).toBe('失败');
  });

  it('takes the extreme difficulty and the extreme bonus for a joint check', () => {
    expect(effectiveDifficulty([62, 58], 'and')).toBe(58);
    expect(effectiveDifficulty([62, 58], 'or')).toBe(62);
    expect(effectiveBonus([1, -1], 'and')).toBe(-1);
    expect(effectiveBonus([1, -1], 'or')).toBe(1);
  });

  it('keys the advice to the displayed band', () => {
    expect(adviceFor('大成功')).toContain('额外奖励');
    expect(adviceFor('大失败')).toContain('额外惩罚');
    expect(adviceFor('极难成功')).toContain('酌情');
    expect(adviceFor('困难成功')).toContain('酌情');
    expect(adviceFor('普通成功')).toBe('');
    expect(adviceFor('普通失败')).toBe('');
  });

  it('ranks the bands for the contest comparison', () => {
    expect(BAND_RANK.大成功).toBeGreaterThan(BAND_RANK.极难成功);
    expect(BAND_RANK.极难成功).toBeGreaterThan(BAND_RANK.困难成功);
    expect(BAND_RANK.困难成功).toBeGreaterThan(BAND_RANK.普通成功);
    expect(BAND_RANK.普通成功).toBeGreaterThan(BAND_RANK.普通失败);
    expect(BAND_RANK.普通失败).toBeGreaterThan(BAND_RANK.大失败);
  });
});
