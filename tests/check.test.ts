import { describe, expect, it } from 'vitest';
import { classify, difficultyFromProbability, formatChecks } from '../src/check.ts';

describe('TRPG check rules', () => {
  it('floors the model score and clamps difficulty to 1–99', () => {
    expect([0, 0.2, 0.999, 1].map(difficultyFromProbability)).toEqual([1, 20, 99, 99]);
    expect(() => difficultyFromProbability(Number.NaN)).toThrow();
    expect(() => difficultyFromProbability(1.1)).toThrow();
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

  it('renders a fixed two-line receipt per skill in input order', () => {
    expect(formatChecks([
      { skill: '跑步', difficulty: 20, roll: 38, result: '普通失败' },
      { skill: '攀爬', difficulty: 80, roll: 20, result: '极难成功' },
    ])).toBe('跑步：普通失败 [38/20]\n此次跑步普通失败了。\n\n攀爬：极难成功 [20/80]\n此次攀爬极难成功了。酌情给予小奖励。');
  });

  it('adds only the fixed advice for critical and hard outcomes', () => {
    expect(formatChecks([
      { skill: '观察', difficulty: 60, roll: 1, result: '大成功' },
      { skill: '潜行', difficulty: 60, roll: 30, result: '困难成功' },
      { skill: '交涉', difficulty: 60, roll: 100, result: '大失败' },
    ])).toBe('观察：大成功 [1/60]\n此次观察大成功了。给予额外奖励。\n\n潜行：困难成功 [30/60]\n此次潜行困难成功了。酌情给予小奖励。\n\n交涉：大失败 [100/60]\n此次交涉大失败了。给予额外惩罚。');
  });
});
