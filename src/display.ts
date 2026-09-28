import {
  GRADE_LABEL,
  JOINT_LABEL,
  adviceFor,
  type CheckResult,
  type Grade,
  type Joint,
  type RollOutcome,
} from './check.ts';

/**
 * 一次判定的回执记录。两种形态互斥：
 * - `rolled`：调用过判定模型，有难度与骰值。
 * - `auto`：|bonus| ≥ 3，没有模型调用，因此没有难度、没有骰值。
 * 显示串与诊断行都由本模块生成，调用方只负责把结果拼成记录。
 */
export interface RolledCheck {
  kind: 'rolled';
  /** 显示用的技能标签；组合检定是「侦查&聆听」。 */
  skill: string;
  /** 出现时表示组合检定，值为组合方式。 */
  joint?: Joint;
  /** 有效难度：and 取最小、or 取最大。 */
  difficulty: number;
  /** 逐项难度，顺序与请求一致；单项时长度为 1，组合时长度 ≥ 2。 */
  difficulties: number[];
  roll: RollOutcome;
  /** 本项的合计修正：情境 + 本项花掉的 banked 奖励骰。 */
  bonus: number;
  grade?: Grade;
  result: CheckResult;
}

export interface AutoCheck {
  kind: 'auto';
  skill: string;
  joint?: Joint;
  bonus: number;
  auto: '成功' | '失败';
}

export type SkillCheck = RolledCheck | AutoCheck;

/** 对抗检定里一侧的结果；`skipped` 表示这一侧没有参与结算（对面已经定下胜负）。 */
export interface ContestSide {
  name: string;
  /** 显示用的技能标签；组合检定是「侦查&聆听」。 */
  skill: string;
  joint?: Joint;
  bonus: number;
  skipped?: true;
  auto?: '成功' | '失败';
  difficulty?: number;
  difficulties?: number[];
  roll?: RollOutcome;
  result?: CheckResult;
}

export interface ContestOutcome {
  actor: ContestSide;
  opponent: ContestSide;
  winner: 'actor' | 'opponent';
}

/** 普通成功与普通失败在面向用户的文本里简写。 */
function shorten(result: CheckResult): string {
  return result === '普通成功' ? '成功' : result === '普通失败' ? '失败' : result;
}

/** 技能标签：组合检定写成 `[侦查&聆听]组合检定`，否则是「技能名」加由调用方给的尾巴。 */
function headOf(skill: string, joint: Joint | undefined, suffix: string): string {
  return joint ? `[${skill}]组合检定` : `${skill}${suffix}`;
}

/** 「组合 → 难度 → 奖惩」里的标记段，顺序固定。 */
function markersOf(joint: Joint | undefined, grade: Grade | undefined, bonus: number): string[] {
  const marks: string[] = [];
  if (joint) marks.push(JOINT_LABEL[joint]);
  if (grade !== undefined) marks.push(GRADE_LABEL[grade]);
  if (bonus !== 0) marks.push(`${bonus > 0 ? '优势' : '劣势'}${Math.abs(bonus)}`);
  return marks;
}

/** 骰值段：基准难度只写选中的那一颗，带奖惩骰时把全部骰值列出来并标出选中的那颗。 */
function diceSlot(bonus: number, roll: RollOutcome): string {
  return bonus === 0 ? `${roll.chosen}` : `[${roll.dice.join('; ')}]=>${roll.chosen}`;
}

/** 难度段：组合检定列出逐项难度，否则只有一个有效难度。 */
function difficultySlot(joint: Joint | undefined, difficulty: number, difficulties: number[]): string {
  return joint ? `[${difficulties.join('; ')}]` : `${difficulty}`;
}

function valueOf(spec: Pick<RolledCheck, 'bonus' | 'joint' | 'roll' | 'difficulty' | 'difficulties'>): string {
  return `${diceSlot(spec.bonus, spec.roll)}/${difficultySlot(spec.joint, spec.difficulty, spec.difficulties)}`;
}

/** 诊断行里的骰值/难度段：只有基准难度（无奖惩骰、也不组合）才套一层方括号。 */
function diagnosticSlot(spec: Pick<RolledCheck, 'bonus' | 'joint' | 'roll' | 'difficulty' | 'difficulties'>): string {
  const value = valueOf(spec);
  return spec.bonus === 0 && !spec.joint ? `[${value}]` : value;
}

/** 带符号的修正值，负数用 U+2212 与正文区分。 */
function signed(bonus: number): string {
  return bonus > 0 ? `+${bonus}` : `−${Math.abs(bonus)}`;
}

function autoReason(bonus: number): string {
  return bonus > 0 ? '优势过大' : '劣势过大';
}

/**
 * 面向用户的显示串。标记顺序固定为组合 → 难度 → 奖惩；普通成功与普通失败简写为成功/失败。
 * agent 照抄这一段即可，不需要自己拼格式。
 */
export function displayForCheck(check: SkillCheck): string {
  if (check.kind === 'auto') {
    const head = headOf(check.skill, check.joint, '检定');
    return `【${head}|自动${check.auto}：${autoReason(check.bonus)}（${signed(check.bonus)}）】`;
  }
  const marks = [headOf(check.skill, check.joint, '检定'), ...markersOf(check.joint, check.grade, check.bonus)];
  return `【${marks.join('|')}：${valueOf(check)} ${shorten(check.result)}】`;
}

/**
 * 回执里的诊断行。保留原有的两行形态：第一行给骰值与档位，第二行给一句结果陈述与固定建议。
 * 自动判定的两项没有骰值可写，改成一行结论加一行说明。
 */
function diagnosticFor(check: SkillCheck): string {
  if (check.kind === 'auto') {
    return `${check.skill}：自动${check.auto}（${autoReason(check.bonus)} ${signed(check.bonus)}）\n本次未调用判定模型。`;
  }
  return `${check.skill}：${check.result} ${diagnosticSlot(check)}\n此次${check.skill}${check.result}了。${adviceFor(check.result)}`;
}

/** 完整回执：诊断行 + 末尾的「显示：」块。 */
export function formatReceipt(checks: SkillCheck[]): string {
  const diagnostics = checks.map(diagnosticFor).join('\n\n');
  const display = checks.map(displayForCheck).join('\n');
  return `${diagnostics}\n\n显示：\n${display}`;
}

/** 对抗检定里一侧的显示片段；名字写在方括号外。 */
function sideSlot(side: ContestSide): string {
  return `${side.name}${sideBody(side)}`;
}

function sideBody(side: ContestSide): string {
  if (side.skipped) return '【跳过检定】';
  if (side.auto) {
    const head = headOf(side.skill, side.joint, '');
    return `【${head} 自动${side.auto}（${autoReason(side.bonus)} ${signed(side.bonus)}）】`;
  }
  const head = headOf(side.skill, side.joint, '');
  const marks = markersOf(side.joint, undefined, side.bonus);
  const value = `${diceSlot(side.bonus, side.roll!)}/${difficultySlot(side.joint, side.difficulty!, side.difficulties!)}`;
  return `【${[head, ...marks].join('|')} ${value} ${shorten(side.result!)}】`;
}

function sideDiagnostic(side: ContestSide): string {
  if (side.skipped) return `${side.name} 跳过检定`;
  if (side.auto) return `${side.name} 自动${side.auto}（${autoReason(side.bonus)} ${signed(side.bonus)}）`;
  const spec = { bonus: side.bonus, joint: side.joint, roll: side.roll!, difficulty: side.difficulty!, difficulties: side.difficulties! };
  return `${side.name} ${side.skill} ${side.result} ${diagnosticSlot(spec)}`;
}

/**
 * 对抗检定的完整回执。不附加奖励建议：对抗不触发奖励骰（战斗轮的大成功按常规反馈）。
 */
export function formatContest(outcome: ContestOutcome): string {
  const winnerName = (outcome.winner === 'actor' ? outcome.actor : outcome.opponent).name;
  return `${sideDiagnostic(outcome.actor)}；${sideDiagnostic(outcome.opponent)}\n\n显示：\n`
    + `${sideSlot(outcome.actor)} 对抗 ${sideSlot(outcome.opponent)}：${winnerName}胜出`;
}
