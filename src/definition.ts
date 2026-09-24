import type { WorldDefinition } from 'cortico/world.ts';
import { SIMPLE_TRPG_CHECK_DEFAULTS, type SimpleTrpgCheckConfigSection } from './config.ts';
import { SimpleTrpgCheckWorld } from './world.ts';

export const SIMPLE_TRPG_CHECK: WorldDefinition<SimpleTrpgCheckConfigSection> = {
  id: 'simple-trpg-check',
  label: 'Simple TRPG Check',
  defaults: () => ({ ...SIMPLE_TRPG_CHECK_DEFAULTS }),
  create: (ctx) => new SimpleTrpgCheckWorld(ctx),
};
