import {
  AUTO_BONUS,
  BAND_RANK,
  classify,
  difficultyFromLevel,
  effectiveDifficulty,
  rollDice,
  type CheckResult,
  type Joint,
  type RollOutcome,
} from './check.ts';
import type { CheckRequest } from './request.ts';

/** 参与对抗的一侧：自己的完整请求（六维 + 证据 + 技能），加上挂在这一侧上的合计修正。 */
export interface ContestSideSpec {
  name: string;
  request: CheckRequest;
  /** 情境 + 这一侧花掉的 banked 奖励骰。每侧只投一次骰，所以奖惩骰挂在侧上而不是逐项。 */
  bonus: number;
}

export interface ContestRequest {
  actor: ContestSideSpec;
  opponent: ContestSideSpec;
}

/**
 * 自动判定的结论。`decisive` 是提供定调的那一侧：它显示自动成功/失败，另一侧显示「跳过检定」。
 * 四条按序短路，所以「双方都是 +3」时我方胜，而不是退回去比难度。
 */
export interface AutoVerdict {
  winner: 'actor' | 'opponent';
  decisive: 'actor' | 'opponent';
  verdict: '成功' | '失败';
}

/**
 * 对抗检定的自动判定：命中即两侧都不调用判定模型。
 * A 我方 ≥ 3 → 我方胜；B 对方 ≤ −3 → 我方胜；C 我方 ≤ −3 → 对方胜；D 对方 ≥ 3 → 对方胜。
 */
export function contestAutoVerdict(actorBonus: number, opponentBonus: number): AutoVerdict | null {
  if (actorBonus >= AUTO_BONUS) return { winner: 'actor', decisive: 'actor', verdict: '成功' };
  if (opponentBonus <= -AUTO_BONUS) return { winner: 'actor', decisive: 'opponent', verdict: '失败' };
  if (actorBonus <= -AUTO_BONUS) return { winner: 'opponent', decisive: 'actor', verdict: '失败' };
  if (opponentBonus >= AUTO_BONUS) return { winner: 'opponent', decisive: 'opponent', verdict: '成功' };
  return null;
}

export interface ScoredSide {
  result: CheckResult;
  difficulty: number;
}

/**
 * 比对两侧：先比档位，同级比难度数值，数值相等判我方胜。
 * 规则是无条件的，所以在「普通失败」这一级同样适用——对抗永远有一个赢家。
 */
export function compareContest(actor: ScoredSide, opponent: ScoredSide): 'actor' | 'opponent' {
  const gap = BAND_RANK[actor.result] - BAND_RANK[opponent.result];
  if (gap !== 0) return gap > 0 ? 'actor' : 'opponent';
  return actor.difficulty >= opponent.difficulty ? 'actor' : 'opponent';
}

/** 一侧结算完的投掷：难度已定、骰已掷、档位已判。 */
export interface ResolvedSide {
  skill: string;
  joint?: Joint;
  bonus: number;
  /** 有效难度：组合检定 and 取最小、or 取最大；单项就是那一项的难度。 */
  difficulty: number;
  difficulties: number[];
  roll: RollOutcome;
  result: CheckResult;
}

/**
 * 把一侧的模型读数结算成一次投掷。每侧只投一次骰：组合检定用有效难度，
 * 奖惩骰用挂在这一侧上的那一个合计值。对抗不接受 grade，所以档位一律按基准阈值判。
 * 模型给的是浮点水平，难度必须是 1–99 的整数——回执里不该出现小数，
 * 所以在这里先钳再取极值（Math.round 单调，先钳后取与先取后钳等价）。
 */
export function resolveSide(spec: ContestSideSpec, levels: number[], roll: () => number): ResolvedSide {
  const difficulties = levels.map(difficultyFromLevel);
  const joint = spec.request.joint;
  const difficulty = joint ? effectiveDifficulty(difficulties, joint) : difficulties[0]!;
  const outcome = rollDice(roll, spec.bonus);
  return {
    skill: joint ? spec.request.checks.map((check) => check.skill).join('&') : spec.request.checks[0]!.skill,
    joint,
    bonus: spec.bonus,
    difficulty,
    difficulties,
    roll: outcome,
    result: classify(outcome.chosen, difficulty),
  };
}
