import type { Grade, Joint } from './check.ts';

/** 一次判定的输入：角色层面的共享事实、这一时刻的情境五维，以及逐项技能的判定说明。 */
export interface CheckSpec {
  skill: string;
  goal: string;
  evidence: string;
  /**
   * 情景代偿的合计修正：情境修正 + 本项花掉的 banked 奖励骰。省略即基准。
   * 只作用于掷骰（1+|bonus| 颗取极值），不进模型输入——判定模型看到的水平必须与情境无关。
   */
  bonus?: number;
  /** 难度等级；只用于难度本身是任务因素的情形，与顶层 joint 不能同时出现。 */
  grade?: Grade;
}

export interface CheckRequest {
  character: {
    /** 长期特质、背景、词条。 */
    traits: string;
    /** 伤势、疲劳、体温、精神与消耗状态。 */
    condition: string;
  };
  situation: {
    /** 天气与介质。 */
    weather: string;
    /** 工具与装备。 */
    gear: string;
    /** 已知信息与资料的秩序。 */
    info: string;
    /** 时限。 */
    time: string;
    /** 可见度与感官条件。 */
    senses: string;
  };
  checks: CheckSpec[];
  /** 出现时把本调用里的所有技能合成一次投掷；至少两项技能，且各项不得带 grade。 */
  joint?: Joint;
}

/** 组合检定用「侦查&聆听」这样的联合标签；单项时就是技能名。 */
export function checksLabel(checks: CheckSpec[], joint?: Joint): string {
  return joint ? checks.map((check) => check.skill).join('&') : checks[0]?.skill ?? '';
}

/**
 * 档位描述与代表值。普通技能按训练与专业水平分十档，财富按生活水准与资产分六档。
 */
export interface LevelBand {
  label: string;
  representative: number;
}

const LEVEL_BANDS: Record<'zh' | 'en', LevelBand[]> = {
  zh: [
    { label: '完全的外行人', representative: 3 },
    { label: '拥有少量知识的初学者', representative: 12 },
    { label: '刚入门的业余者，简单的情形能独立应付', representative: 24 },
    { label: '拥有一定程度的天赋或基本训练的业余者', representative: 35 },
    { label: '熟练的业余者，稍难的情形也能拿下来，接近能靠它吃饭', representative: 47 },
    { label: '凭此技能谋生，等同于相关领域的学士学位', representative: 62 },
    { label: '职业中的佼佼者，同行遇到麻烦时会想到他', representative: 72 },
    { label: '在专业知识上更进一步，相当于硕士或博士水平', representative: 82 },
    { label: '领域内公认最强的那几个人之一', representative: 89 },
    { label: '位列该技能的世界顶尖人物之列', representative: 95 },
  ],
  en: [
    { label: 'A complete outsider', representative: 3 },
    { label: 'A beginner with a little knowledge', representative: 12 },
    { label: 'An entry-level amateur who can handle the simple cases alone', representative: 24 },
    { label: 'An amateur with some talent or basic training', representative: 35 },
    { label: 'A seasoned amateur who can take on the harder cases, close to making a living by it', representative: 47 },
    { label: 'A professional who makes a living by it, equivalent to a bachelor degree', representative: 62 },
    { label: 'Among the more accomplished professionals; peers bring them their troublesome cases', representative: 72 },
    { label: 'An expert, equivalent to a master degree or a doctorate', representative: 82 },
    { label: 'One of the very few recognised as the strongest in the field', representative: 89 },
    { label: 'Among the best in the world at this skill', representative: 95 },
  ],
};

const WEALTH_BANDS: Record<'zh' | 'en', LevelBand[]> = {
  zh: [
    { label: '身无分文，流落街头', representative: 0 },
    { label: '极端贫困，勉强果腹', representative: 5 },
    { label: '中等水平，在合理的前提下生活得比较舒适', representative: 30 },
    { label: '富裕，某些条件下近乎奢侈', representative: 70 },
    { label: '富有，生活无忧并极为奢侈', representative: 94 },
    { label: '超级有钱，钱对你来说只是数字', representative: 99 },
  ],
  en: [
    { label: 'Penniless and living on the streets', representative: 0 },
    { label: 'Extremely poor, barely able to eat', representative: 5 },
    { label: 'Average means, living reasonably comfortably', representative: 30 },
    { label: 'Wealthy, with some luxuries', representative: 70 },
    { label: 'Rich, living carefree and very luxuriously', representative: 94 },
    { label: 'Extremely wealthy; money is just a number', representative: 99 },
  ],
};

export const LEVEL_OPTIONS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'] as const;

const WEALTH_SKILLS = new Set(['财富', '信用', '信用评级', 'wealth', 'credit', 'credit rating']);

export function isWealthSkill(skill: string): boolean {
  return WEALTH_SKILLS.has(skill.trim().toLowerCase());
}

export function levelBands(chinese: boolean, skill = ''): LevelBand[] {
  return (isWealthSkill(skill) ? WEALTH_BANDS : LEVEL_BANDS)[chinese ? 'zh' : 'en'];
}

export interface LevelQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

/** 三条上限：整份请求、情境、单项问题；判定时都预留 10% 余量。 */
export const TOKEN_LIMITS = { state: 768, question: 256, total: 1000 } as const;

const ASCII_CHAR = /[\u0020-\u007e]/;
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[\u{20000}-\u{2fa1f}]/u;

/**
 * 按字符类型估算 token，单位是十分之一 token（整数运算，避免浮点误差）：
 * ASCII 0.3、CJK 0.6、其他字符 1（保守）。
 */
function estimateTenths(text: string): number {
  let tenths = 0;
  for (const char of text) {
    tenths += ASCII_CHAR.test(char) ? 3 : CJK_CHAR.test(char) ? 6 : 10;
  }
  return tenths;
}

function overLimit(tenths: number, limit: number): boolean {
  return tenths * 11 > limit * 100;
}

function describeUsage(tenths: number, limit: number): string {
  return `${Math.ceil(tenths / 10)} token（含余量 ${Math.ceil(tenths * 11 / 100)}，上限 ${limit}）`;
}

export interface TokenUsage {
  /** 以下三个值都以十分之一 token 为单位，便于与上限做整数比较。 */
  stateTenths: number;
  questionTenths: number[];
  totalTenths: number;
}

/** 情境、单项问题与整份请求的估算用量。 */
export function tokenUsage(request: CheckRequest, chinese: boolean): TokenUsage {
  const stateTenths = estimateTenths(serializeState(request));
  const questionTenths = Object.values(questionsFor(request, chinese)).map(
    (question) => estimateTenths(`${question.instructions}\n${JSON.stringify(question.criteria)}`),
  );
  return { stateTenths, questionTenths, totalTenths: stateTenths + questionTenths.reduce((sum, tenths) => sum + tenths, 0) };
}

/** 全部上限都满足时返回 null，否则返回给 agent 看的失败原因。 */
export function budgetViolation(request: CheckRequest, chinese: boolean): string | null {
  const { stateTenths, questionTenths, totalTenths } = tokenUsage(request, chinese);
  const problems: string[] = [];
  if (overLimit(stateTenths, TOKEN_LIMITS.state)) {
    problems.push(`情境 ${describeUsage(stateTenths, TOKEN_LIMITS.state)}`);
  }
  questionTenths.forEach((tenths, index) => {
    if (overLimit(tenths, TOKEN_LIMITS.question)) {
      problems.push(`第 ${index + 1} 项问题 ${describeUsage(tenths, TOKEN_LIMITS.question)}`);
    }
  });
  if (overLimit(totalTenths, TOKEN_LIMITS.total)) {
    problems.push(`总输入 ${describeUsage(totalTenths, TOKEN_LIMITS.total)}`);
  }
  return problems.length ? `输入超出预算：${problems.join('；')}。` : null;
}

/**
 * 序列化成 `state.message`。只放共享事实：技能、目标与该技能的水平证据逐条走问题，
 * 不进情境；字段边界靠 JSON 键保留。
 */
export function serializeState(request: CheckRequest): string {
  return JSON.stringify({ character: request.character, situation: request.situation }, null, 2);
}

/** 每项技能一个问题：角色在这一点上处于哪一档。选项键用中性字母，档位描述进 criteria。 */
export function questionsFor(request: CheckRequest, chinese: boolean): Record<string, LevelQuestion> {
  return Object.fromEntries(request.checks.map((check, index) => {
    const bands = levelBands(chinese, check.skill);
    return [`check_${index}`, {
      type: 'choice' as const,
      instructions: `In the skill "${check.skill}", which level is the character at? Character: ${check.evidence}`,
      criteria: Object.fromEntries(bands.map((band, position) => [LEVEL_OPTIONS[position]!, band.label])),
    }];
  }));
}
