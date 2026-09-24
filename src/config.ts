import type { ConfigGroup } from 'cortico/core/types.ts';

export type CheckBackend = 'laya' | 'laya-multilingual' | 'jev';
export type JevSource = 'typesafe' | 'openrouter';

export interface SimpleTrpgCheckConfigSection {
  enabled: boolean;
  backend: CheckBackend;
  jevSource: JevSource;
  forceMultilingual: boolean;
  pythonExecutable: string;
}

export const SIMPLE_TRPG_CHECK_DEFAULTS: SimpleTrpgCheckConfigSection = {
  enabled: false,
  backend: 'laya-multilingual',
  jevSource: 'typesafe',
  forceMultilingual: false,
  pythonExecutable: 'python',
};

export const SIMPLE_TRPG_CHECK_TYPESAFE_SECRET = 'CORTICO_SIMPLE_TRPG_CHECK_TYPESAFE_API_KEY';
export const SIMPLE_TRPG_CHECK_OPENROUTER_SECRET = 'CORTICO_SIMPLE_TRPG_CHECK_OPENROUTER_API_KEY';

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
      },
      'worlds.simple-trpg-check.jevSource': {
        type: 'string',
        title: 'Jev 来源',
        enum: ['typesafe', 'openrouter'],
        'x-hot': true,
      },
      'worlds.simple-trpg-check.forceMultilingual': {
        type: 'boolean',
        title: '强制适配多语言',
        description: '要求 agent 用英文填写 scenario 与 skill_lists；不翻译输入，也不切换模型。',
        'x-hot': true,
      },
      'worlds.simple-trpg-check.pythonExecutable': {
        type: 'string',
        title: 'Python 命令',
        description: '本地 Laya multilingual 使用的 Python；该环境需安装 laya。',
        'x-hot': false,
      },
    },
  },
};
