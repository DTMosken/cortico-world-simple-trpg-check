export type CheckResult = '大成功' | '极难成功' | '困难成功' | '普通成功' | '普通失败' | '大失败';

/** 难度等级：1 = 困难、2 = 极难。省略表示基准难度。 */
export type Grade = 1 | 2;

/** 组合检定：and 要求每项都成功，or 任意一项成功即可。 */
export type Joint = 'and' | 'or';

/**
 * 奖励/惩罚骰的自动判定阈值：|bonus| 达到它就不再调用判定模型，直接给出结论。
 * agent 填的是合计值（情境修正 + 本项花掉的 banked 奖励骰），所以连压两颗 banked 骰
 * 越过一次检定是可达的——这正是「用奖励骰跳过检定」的通路。
 */
export const AUTO_BONUS = 3;

export const GRADE_LABEL: Record<Grade, string> = { 1: '困难', 2: '极难' };
export const JOINT_LABEL: Record<Joint, string> = { and: '全部', or: '任一' };

/**
 * 难度是角色达成概率的百分数，直接取自标定后的水平估计。
 * 结果钳在 1–99，可表达区间是 [1%, 99%]；钳位不是可选项：允许 0 时掷出的 1 是大成功、
 * 允许 100 时掷出的 100 是大失败，都会把实际成功概率从 0 或 1 挤开。
 * 在 1–99 内且 grade 与 bonus 都是基准时，`classify` 的成功条件等价于 `roll <= difficulty`
 * （1 <= 难度、100 > 难度恒成立），因此 P(成功) = 难度/100 精确成立，暴击不改变这个概率。
 * 加上代偿之后这条不再成立：grade 把成功率压到约 难度/200（grade 1）或 难度/400（grade 2）；
 * bonus ≠ 0 时掷 1+|bonus| 颗取极值，成功率变成 1-(1-p)^n（优势）或 p^n（劣势）。
 */
export function difficultyFromLevel(level: number): number {
  if (!Number.isFinite(level) || level < 0 || level > 100) {
    throw new Error('模型返回的水平必须是 0–100 的有限数值');
  }
  return Math.max(1, Math.min(99, Math.round(level)));
}

/**
 * 难度等级的覆盖表：阈值完全不动，只把落在某些区域里的档位改个标签。
 * 大成功与大失败从不被覆盖——它们由骰值本身决定，不因为上游区域被占而改变。
 * 于是 grade 1 下「困难成功」不再出现，grade 2 下「极难成功」也不再出现。
 * 查表一律以基准档位为键，不做链式替换。
 */
const GRADE_OVERRIDES: Record<Grade, Partial<Record<CheckResult, CheckResult>>> = {
  1: { 困难成功: '普通成功', 普通成功: '普通失败' },
  2: { 极难成功: '普通成功', 困难成功: '普通失败', 普通成功: '普通失败' },
};

export function classify(roll: number, difficulty: number, grade?: Grade): CheckResult {
  if (!Number.isInteger(roll) || roll < 1 || roll > 100) throw new Error('骰值必须是 1–100 的整数');
  if (roll === 1) return '大成功';
  if (roll === 100) return '大失败';
  const base: CheckResult = roll <= difficulty * 0.25 ? '极难成功'
    : roll <= difficulty * 0.5 ? '困难成功'
      : roll <= difficulty ? '普通成功' : '普通失败';
  return grade === undefined ? base : GRADE_OVERRIDES[grade][base] ?? base;
}

export interface RollOutcome {
  /** 1+|bonus| 颗，按掷出顺序。 */
  dice: number[];
  /** 用于判档的那一颗：优势取最低、劣势取最高。暴击只判这一颗。 */
  chosen: number;
}

/**
 * 奖惩骰：掷 1+|bonus| 颗 d100，优势取最低、劣势取最高。
 * bonus = 0 时只有一颗，与不带代偿的旧行为完全一致。
 * 注意取极值会让暴击概率随骰数变化：优势下大失败要求每颗都是 100，劣势下大成功要求每颗都是 1。
 */
export function rollDice(roll: () => number, bonus: number): RollOutcome {
  if (!Number.isInteger(bonus)) throw new Error('奖励/惩罚骰必须是整数');
  const dice = Array.from({ length: 1 + Math.abs(bonus) }, () => roll());
  const chosen = bonus > 0 ? Math.min(...dice) : bonus < 0 ? Math.max(...dice) : dice[0]!;
  return { dice, chosen };
}

/** 单项的自动判定：|bonus| 达到 AUTO_BONUS 就不调用判定模型。 */
export function autoVerdict(bonus: number): '成功' | '失败' | null {
  if (bonus >= AUTO_BONUS) return '成功';
  if (bonus <= -AUTO_BONUS) return '失败';
  return null;
}

/** 组合检定的有效难度：and 取最小（每项都要过）、or 取最大（任意一项过即可）。 */
export function effectiveDifficulty(difficulties: number[], joint: Joint): number {
  return joint === 'and' ? Math.min(...difficulties) : Math.max(...difficulties);
}

/** 组合检定的有效奖惩：同样是 and 取最小、or 取最大，与难度规则同构。 */
export function effectiveBonus(bonuses: number[], joint: Joint): number {
  return joint === 'and' ? Math.min(...bonuses) : Math.max(...bonuses);
}

/** 建议文案跟显示标签走：grade 把区域改标成普通成功/普通失败之后，那一段就不再提示奖励。 */
export function adviceFor(result: CheckResult): string {
  return result === '大成功' ? '给予额外奖励。'
    : result === '大失败' ? '给予额外惩罚。'
      : result === '极难成功' || result === '困难成功' ? '酌情（可选）给予小奖励。'
        : '';
}

/** 档位高低：大成功 > 极难成功 > 困难成功 > 普通成功 > 普通失败 > 大失败。对抗检定按它比大小。 */
export const BAND_RANK: Record<CheckResult, number> = {
  大成功: 6, 极难成功: 5, 困难成功: 4, 普通成功: 3, 普通失败: 2, 大失败: 1,
};
