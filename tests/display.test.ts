import { describe, expect, it } from 'vitest';
import {
  displayForCheck,
  formatContest,
  formatReceipt,
  type ContestSide,
  type RolledCheck,
} from '../src/display.ts';
import type { CheckResult, Grade, Joint } from '../src/check.ts';

interface RolledSpec {
  skill: string;
  difficulty: number;
  result: CheckResult;
  bonus?: number;
  dice?: number[];
  chosen?: number;
  difficulties?: number[];
  grade?: Grade;
  joint?: Joint;
}

function rolledCheck(spec: RolledSpec): RolledCheck {
  const values = spec.dice ?? [spec.chosen!];
  return {
    kind: 'rolled',
    skill: spec.skill,
    joint: spec.joint,
    difficulty: spec.difficulty,
    difficulties: spec.difficulties ?? [spec.difficulty],
    roll: { dice: values, chosen: spec.chosen ?? values[0]! },
    bonus: spec.bonus ?? 0,
    grade: spec.grade,
    result: spec.result,
  };
}

describe('面向用户的显示串', () => {
  it('renders the uncompensated form', () => {
    expect(displayForCheck(rolledCheck({ skill: '攀爬', difficulty: 20, result: '普通失败', chosen: 38 })))
      .toBe('【攀爬检定：38/20 失败】');
  });

  it('lists every die for an advantage and marks the chosen one', () => {
    expect(displayForCheck(rolledCheck({
      skill: '攀爬', difficulty: 62, result: '普通成功', bonus: 2, dice: [45, 12, 71], chosen: 12,
    }))).toBe('【攀爬检定|优势2：[45; 12; 71]=>12/62 成功】');
  });

  it('renders a disadvantage', () => {
    expect(displayForCheck(rolledCheck({
      skill: '攀爬', difficulty: 40, result: '普通失败', bonus: -1, dice: [45, 12], chosen: 45,
    }))).toBe('【攀爬检定|劣势1：[45; 12]=>45/40 失败】');
  });

  it('marks the difficulty grade', () => {
    expect(displayForCheck(rolledCheck({ skill: '攀爬', difficulty: 62, result: '普通失败', grade: 1, chosen: 45 })))
      .toBe('【攀爬检定|困难：45/62 失败】');
    expect(displayForCheck(rolledCheck({ skill: '攀爬', difficulty: 62, result: '普通失败', grade: 2, chosen: 45 })))
      .toBe('【攀爬检定|极难：45/62 失败】');
  });

  it('renders a joint check with every difficulty', () => {
    expect(displayForCheck(rolledCheck({
      skill: '侦查&聆听', joint: 'and', difficulty: 58, difficulties: [62, 58], result: '普通成功', chosen: 45,
    }))).toBe('【[侦查&聆听]组合检定|全部：45/[62; 58] 成功】');
    expect(displayForCheck(rolledCheck({
      skill: '侦查&聆听', joint: 'or', difficulty: 62, difficulties: [62, 58], result: '普通成功', chosen: 45,
    }))).toBe('【[侦查&聆听]组合检定|任一：45/[62; 58] 成功】');
  });

  it('orders the markers 组合 → 难度 → 奖惩', () => {
    expect(displayForCheck(rolledCheck({
      skill: '侦查&聆听', joint: 'and', difficulty: 58, difficulties: [62, 58],
      result: '普通成功', bonus: 2, dice: [45, 40], chosen: 40,
    }))).toBe('【[侦查&聆听]组合检定|全部|优势2：[45; 40]=>40/[62; 58] 成功】');
  });

  it('renders an automatic verdict without dice or difficulty', () => {
    expect(displayForCheck({ kind: 'auto', skill: '攀爬', bonus: 3, auto: '成功' }))
      .toBe('【攀爬检定|自动成功：优势过大（+3）】');
    expect(displayForCheck({ kind: 'auto', skill: '攀爬', bonus: -3, auto: '失败' }))
      .toBe('【攀爬检定|自动失败：劣势过大（−3）】');
    expect(displayForCheck({ kind: 'auto', skill: '侦查&聆听', joint: 'and', bonus: 3, auto: '成功' }))
      .toBe('【[侦查&聆听]组合检定|自动成功：优势过大（+3）】');
  });

  it('appends the display block at the end of the receipt', () => {
    expect(formatReceipt([
      rolledCheck({ skill: '跑步', difficulty: 20, result: '普通失败', chosen: 38 }),
      rolledCheck({ skill: '攀爬', difficulty: 80, result: '极难成功', chosen: 20 }),
    ])).toBe('跑步：普通失败 [38/20]\n此次跑步普通失败了。\n\n攀爬：极难成功 [20/80]\n此次攀爬极难成功了。酌情（可选）给予小奖励。'
      + '\n\n显示：\n【跑步检定：38/20 失败】\n【攀爬检定：20/80 极难成功】');
  });

  it('keeps the multi-dice form in the diagnostic line', () => {
    expect(formatReceipt([rolledCheck({
      skill: '攀爬', difficulty: 62, result: '普通成功', bonus: 2, dice: [45, 12], chosen: 12,
    })])).toBe('攀爬：普通成功 [45; 12]=>12/62\n此次攀爬普通成功了。'
      + '\n\n显示：\n【攀爬检定|优势2：[45; 12]=>12/62 成功】');
  });

  it('says the model was skipped for an automatic verdict', () => {
    expect(formatReceipt([{ kind: 'auto', skill: '攀爬', bonus: -3, auto: '失败' }]))
      .toBe('攀爬：自动失败（劣势过大 −3）\n本次未调用判定模型。'
        + '\n\n显示：\n【攀爬检定|自动失败：劣势过大（−3）】');
  });
});

describe('对抗检定的显示串', () => {
  const actor: ContestSide = {
    name: '张三', skill: '格斗', bonus: 0, difficulty: 62, difficulties: [62],
    roll: { dice: [45], chosen: 45 }, result: '困难成功',
  };
  const opponent: ContestSide = {
    name: '李四', skill: '闪避', bonus: 0, difficulty: 40, difficulties: [40],
    roll: { dice: [78], chosen: 78 }, result: '普通成功',
  };

  it('renders both sides and names the winner', () => {
    expect(formatContest({ actor, opponent, winner: 'actor' }))
      .toBe('张三 格斗 困难成功 [45/62]；李四 闪避 普通成功 [78/40]'
        + '\n\n显示：\n张三【格斗 45/62 困难成功】 对抗 李四【闪避 78/40 成功】：张三胜出');
  });

  it('carries the joint and the bonus markers inside the side slot', () => {
    const joint: ContestSide = {
      name: '张三', skill: '侦查&聆听', joint: 'and', bonus: 0, difficulty: 58, difficulties: [62, 58],
      roll: { dice: [45], chosen: 45 }, result: '普通成功',
    };
    const hard: ContestSide = { ...opponent, name: '李四', result: '困难成功' };
    expect(formatContest({ actor: joint, opponent: hard, winner: 'actor' }))
      .toContain('张三【[侦查&聆听]组合检定|全部 45/[62; 58] 成功】 对抗 李四【闪避 78/40 困难成功】：张三胜出');

    const advantaged: ContestSide = {
      name: '张三', skill: '格斗', bonus: 2, difficulty: 62, difficulties: [62],
      roll: { dice: [45, 12], chosen: 12 }, result: '困难成功',
    };
    expect(formatContest({ actor: advantaged, opponent, winner: 'actor' }))
      .toContain('张三【格斗|优势2 [45; 12]=>12/62 困难成功】');
  });

  it('marks the settled side as skipped when the verdict is automatic', () => {
    const auto: ContestSide = { name: '张三', skill: '格斗', bonus: 3, auto: '成功' };
    const skipped: ContestSide = { name: '李四', skill: '闪避', bonus: 0, skipped: true };
    expect(formatContest({ actor: auto, opponent: skipped, winner: 'actor' }))
      .toBe('张三 自动成功（优势过大 +3）；李四 跳过检定'
        + '\n\n显示：\n张三【格斗 自动成功（优势过大 +3）】 对抗 李四【跳过检定】：张三胜出');

    const skippedActor: ContestSide = { name: '张三', skill: '格斗', bonus: 0, skipped: true };
    const autoFail: ContestSide = { name: '李四', skill: '闪避', bonus: -3, auto: '失败' };
    expect(formatContest({ actor: skippedActor, opponent: autoFail, winner: 'actor' }))
      .toBe('张三 跳过检定；李四 自动失败（劣势过大 −3）'
        + '\n\n显示：\n张三【跳过检定】 对抗 李四【闪避 自动失败（劣势过大 −3）】：张三胜出');
  });

  it('carries no reward advice: contests never award dice', () => {
    expect(formatContest({ actor, opponent, winner: 'actor' })).not.toContain('酌情');
    expect(formatContest({ actor, opponent, winner: 'actor' })).not.toContain('额外');
  });
});
