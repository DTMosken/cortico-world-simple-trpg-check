export type CheckResult = '大成功' | '极难成功' | '困难成功' | '普通成功' | '普通失败' | '大失败';

export interface SkillCheck {
  skill: string;
  difficulty: number;
  roll: number;
  result: CheckResult;
}

export function difficultyFromProbability(probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error('模型返回的成功把握必须是 0–1 的有限数值');
  }
  return Math.max(1, Math.min(99, Math.floor(probability * 100)));
}

export function classify(roll: number, difficulty: number): CheckResult {
  if (!Number.isInteger(roll) || roll < 1 || roll > 100) throw new Error('骰值必须是 1–100 的整数');
  if (roll === 1) return '大成功';
  if (roll === 100) return '大失败';
  if (roll <= difficulty * 0.25) return '极难成功';
  if (roll <= difficulty * 0.5) return '困难成功';
  return roll <= difficulty ? '普通成功' : '普通失败';
}

export function formatChecks(checks: SkillCheck[]): string {
  return checks.map(({ skill, difficulty, roll, result }) => {
    const advice = result === '大成功' ? '给予额外奖励。'
      : result === '大失败' ? '给予额外惩罚。'
        : result === '极难成功' || result === '困难成功' ? '酌情给予小奖励。'
          : '';
    return `${skill}：${result} [${roll}/${difficulty}]\n此次${skill}${result}了。${advice}`;
  }).join('\n\n');
}
