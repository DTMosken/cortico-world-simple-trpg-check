import type { ConfigGroup } from 'cortico/core/types.ts';

export type CheckBackend = 'laya' | 'laya-multilingual' | 'jev';
export type JevSource = 'typesafe' | 'openrouter';

export interface SimpleTrpgCheckConfigSection {
  enabled: boolean;
  backend: CheckBackend;
  jevSource: JevSource;
  forceMultilingual: boolean;
  pythonExecutable: string;
  layaIdleTtlMinutes: number;
}

export const SIMPLE_TRPG_CHECK_DEFAULTS: SimpleTrpgCheckConfigSection = {
  enabled: false,
  backend: 'laya-multilingual',
  jevSource: 'typesafe',
  forceMultilingual: false,
  pythonExecutable: 'python',
  layaIdleTtlMinutes: 10,
};

export const SIMPLE_TRPG_CHECK_TYPESAFE_SECRET = 'CORTICO_JEV_TYPESAFE_API_KEY';
export const SIMPLE_TRPG_CHECK_OPENROUTER_SECRET = 'CORTICO_JEV_OPENROUTER_API_KEY';
export const SIMPLE_TRPG_CHECK_LEGACY_TYPESAFE_SECRET = 'CORTICO_SIMPLE_TRPG_CHECK_TYPESAFE_API_KEY';
export const SIMPLE_TRPG_CHECK_LEGACY_OPENROUTER_SECRET = 'CORTICO_SIMPLE_TRPG_CHECK_OPENROUTER_API_KEY';

export const SIMPLE_TRPG_CHECK_CONFIG_GROUP: ConfigGroup = {
  id: 'world:simple-trpg-check',
  owner: 'world:simple-trpg-check',
  schema: {
    type: 'object',
    title: 'Simple TRPG Check',
    properties: {
      'worlds.simple-trpg-check.backend': {
        type: 'string',
        title: '判定模型',
        enum: ['laya-multilingual', 'laya', 'jev'],
        'x-hot': false,
        'x-panel-slot': 'model-test',
      },
      'worlds.simple-trpg-check.jevSource': {
        type: 'string',
        title: 'Jev 来源',
        enum: ['typesafe', 'openrouter'],
        'x-hot': true,
        'x-panel-slot': 'jev-key',
      },
      'worlds.simple-trpg-check.forceMultilingual': {
        type: 'boolean',
        title: '强制适配多语言',
        description: '要求 agent 用英文填写 scenario 与 skill_lists；不翻译输入，也不切换模型。',
        'x-hot': true,
      },
      'worlds.simple-trpg-check.pythonExecutable': {
        type: 'string',
        title: '多语言 Laya Python 环境',
        'x-options': 'simple-trpg-check-conda-python',
        description: '从本机 Conda 环境中选择；该环境需安装 laya。',
        'x-hot': false,
      },
      'worlds.simple-trpg-check.layaIdleTtlMinutes': {
        type: 'integer',
        title: 'Laya 空闲释放时间',
        minimum: 0,
        multipleOf: 1,
        'x-suffix': 'min',
        'x-hot': true,
        description: '最后一次本地评分后保留模型的分钟数；与其他使用者共用时取最长 TTL。',
      },
    },
  },
} as ConfigGroup;
