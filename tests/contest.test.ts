import { describe, expect, it } from 'vitest';
import { compareContest, contestAutoVerdict, resolveSide, type ContestSideSpec } from '../src/contest.ts';
import type { CheckRequest } from '../src/request.ts';

function side(overrides: Partial<CheckRequest> = {}, bonus = 0, name = '张三'): ContestSideSpec {
  return {
    name,
    bonus,
    request: {
      character: { traits: '在码头干了八年夜活', condition: '无伤' },
      situation: { weather: '普通降雨', gear: '软底鞋', info: '布局已知', time: '无时限', senses: '灯光充足' },
      checks: [{ skill: '格斗', goal: '压住对方', evidence: '常年在码头上动手' }],
      ...overrides,
    },
  };
}

function diceSource(sequence: number[]): () => number {
  const dice = [...sequence];
  return () => dice.shift()!;
}

describe('对抗检定的自动判定', () => {
  it('short-circuits in order and never needs a model call', () => {
    expect(contestAutoVerdict(0, 0)).toBeNull();
    expect(contestAutoVerdict(2, 2)).toBeNull();
    expect(contestAutoVerdict(3, 0)).toEqual({ winner: 'actor', decisive: 'actor', verdict: '成功' });
    expect(contestAutoVerdict(0, -3)).toEqual({ winner: 'actor', decisive: 'opponent', verdict: '失败' });
    expect(contestAutoVerdict(0, 3)).toEqual({ winner: 'opponent', decisive: 'opponent', verdict: '成功' });
    expect(contestAutoVerdict(-3, 0)).toEqual({ winner: 'opponent', decisive: 'actor', verdict: '失败' });
  });

  it('lets the earlier rule win when both sides break the range', () => {
    // 双方都是 +3：我方那条先行，所以不再比难度。
    expect(contestAutoVerdict(3, 3)).toEqual({ winner: 'actor', decisive: 'actor', verdict: '成功' });
    // 双方都是 −3：「对方 ≤ −3」先行，仍是我方胜。
    expect(contestAutoVerdict(-3, -3)).toEqual({ winner: 'actor', decisive: 'opponent', verdict: '失败' });
    // 我方自动失败、对方自动成功：这是对方唯一凭自动取胜的格子。
    expect(contestAutoVerdict(-3, 3)).toEqual({ winner: 'opponent', decisive: 'actor', verdict: '失败' });
  });
});

describe('对抗检定的比档', () => {
  it('ranks the bands first and the difficulty number second', () => {
    expect(compareContest({ result: '困难成功', difficulty: 30 }, { result: '普通成功', difficulty: 90 })).toBe('actor');
    expect(compareContest({ result: '普通失败', difficulty: 30 }, { result: '困难成功', difficulty: 90 })).toBe('opponent');
  });

  it('breaks a tie by the difficulty number and gives equality to the player', () => {
    expect(compareContest({ result: '普通成功', difficulty: 62 }, { result: '普通成功', difficulty: 40 })).toBe('actor');
    expect(compareContest({ result: '普通成功', difficulty: 40 }, { result: '普通成功', difficulty: 62 })).toBe('opponent');
    expect(compareContest({ result: '普通成功', difficulty: 40 }, { result: '普通成功', difficulty: 40 })).toBe('actor');
  });

  it('still picks a winner when both sides fail, and puts 大失败 last', () => {
    expect(compareContest({ result: '普通失败', difficulty: 60 }, { result: '普通失败', difficulty: 20 })).toBe('actor');
    expect(compareContest({ result: '大失败', difficulty: 99 }, { result: '普通失败', difficulty: 1 })).toBe('opponent');
  });
});

describe('对抗检定的一侧结算', () => {
  it('rolls once and takes the minimum difficulty for an and group', () => {
    const resolved = resolveSide(side({
      joint: 'and',
      checks: [
        { skill: '侦查', goal: '发现对方', evidence: '夜班巡了八年' },
        { skill: '聆听', goal: '听出脚步', evidence: '码头上的动静都听得出来' },
      ],
    }), [62, 58], diceSource([45]));
    expect(resolved).toMatchObject({
      skill: '侦查&聆听', joint: 'and', difficulty: 58, difficulties: [62, 58], bonus: 0, result: '普通成功',
    });
    expect(resolved.roll).toEqual({ dice: [45], chosen: 45 });
  });

  it('takes the maximum difficulty for an or group', () => {
    const resolved = resolveSide(side({
      joint: 'or',
      checks: [
        { skill: '侦查', goal: '发现对方', evidence: '夜班巡了八年' },
        { skill: '聆听', goal: '听出脚步', evidence: '码头上的动静都听得出来' },
      ],
    }), [62, 58], diceSource([45]));
    expect(resolved.difficulty).toBe(62);
  });

  it('rounds the model reading to an integer difficulty', () => {
    const resolved = resolveSide(side({}, 0), [72.6], diceSource([30]));
    expect(resolved.difficulty).toBe(73);
    expect(resolved.difficulties).toEqual([73]);
    expect(resolved.result).toBe('困难成功');
  });

  it('rounds each difficulty before taking the extreme of a joint group', () => {
    const jointSide = side({
      joint: 'and',
      checks: [
        { skill: '侦查', goal: '发现对方', evidence: '夜班巡了八年' },
        { skill: '聆听', goal: '听出脚步', evidence: '动静都听得出来' },
      ],
    });
    const resolved = resolveSide(jointSide, [62.4, 57.6], diceSource([45]));
    expect(resolved.difficulties).toEqual([62, 58]);
    expect(resolved.difficulty).toBe(58);
  });

  it('rolls the side bonus dice and never applies a grade', () => {
    const resolved = resolveSide(side({}, 2), [62], diceSource([45, 12, 71]));
    expect(resolved.roll).toEqual({ dice: [45, 12, 71], chosen: 12 });
    expect(resolved.bonus).toBe(2);
    // 12 <= 62 * 0.25，按基准阈值判极难成功。
    expect(resolved.result).toBe('极难成功');
  });
});
