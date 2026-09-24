import type { WorldDefinition } from 'cortico/world.ts';
import { discoverCondaPythonOptions } from './conda-environments.ts';
import { SIMPLE_TRPG_CHECK_DEFAULTS, type SimpleTrpgCheckConfigSection } from './config.ts';
import { SimpleTrpgCheckWorld } from './world.ts';

export const SIMPLE_TRPG_CHECK: WorldDefinition<SimpleTrpgCheckConfigSection> = {
  id: 'simple-trpg-check',
  label: 'Simple TRPG Check',
  defaults: () => ({ ...SIMPLE_TRPG_CHECK_DEFAULTS }),
  configOptions: (kind) => kind === 'simple-trpg-check-conda-python' ? discoverCondaPythonOptions() : [],
  create: (ctx) => new SimpleTrpgCheckWorld(ctx),
};
