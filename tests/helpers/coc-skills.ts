/**
 * 常用技能表（Call of Cthulhu 风格）：中文名 + 别名（英文名与「也叫」项）。
 * 只用于测试与文档示例；判定管线本身不限制技能名，有子分类的按具体项写。
 */
export interface SkillEntry {
  name: string;
  aliases: string[];
}

export const COC_SKILLS: SkillEntry[] = [
  { name: '力量', aliases: ['Strength'] },
  { name: '体质', aliases: ['Constitution'] },
  { name: '敏捷', aliases: ['Dexterity'] },
  { name: '智力', aliases: ['Intelligence', '灵感'] },
  { name: '意志', aliases: ['Willpower'] },
  { name: '教育', aliases: ['Education', '知识'] },
  { name: '说服', aliases: ['Persuade'] },
  { name: '取悦', aliases: ['Charm'] },
  { name: '恐吓', aliases: ['Intimidate'] },
  { name: '欺骗', aliases: ['Deceive'] },
  { name: '侦查', aliases: ['Spot Hidden'] },
  { name: '聆听', aliases: ['Listen'] },
  { name: '运动', aliases: ['Athletics'] },
  { name: '潜行', aliases: ['Stealth', '乔装', '追踪'] },
  { name: '巧手', aliases: ['Sleight of Hand', '偷窃', '伪造', '锁匠'] },
  { name: '驾驶', aliases: ['Drive'] },
  { name: '骑乘', aliases: ['Ride'] },
  { name: '导航', aliases: ['Navigate'] },
  { name: '格斗', aliases: ['Fighting'] },
  { name: '射击', aliases: ['Firearms'] },
  { name: '闪避', aliases: ['Dodge'] },
  { name: '投掷', aliases: ['Throw'] },
  { name: '爆破', aliases: ['Demolitions'] },
  { name: '急救', aliases: ['First Aid'] },
  { name: '医学', aliases: ['Medicine'] },
  { name: '科学', aliases: ['Science'] },
  { name: '神秘学', aliases: ['Occult'] },
  { name: '历史', aliases: ['History'] },
  { name: '信用', aliases: ['Credit'] },
];

/** 主名与别名的平铺列表，按出现顺序。 */
export const ALL_SKILL_NAMES: string[] = COC_SKILLS.flatMap((entry) => [entry.name, ...entry.aliases]);
