import { describe, expect, it } from 'vitest';
import { posix, win32 } from 'node:path';
import { listCondaPythonOptions } from '../src/conda-environments.ts';

describe('Conda Python options', () => {
  it.each([
    { targetPlatform: 'win32' as const, paths: win32, root: 'C:\\envs', executable: 'python.exe' },
    { targetPlatform: 'linux' as const, paths: posix, root: '/envs', executable: 'bin/python' },
  ])('lists $targetPlatform environments with an interpreter and removes duplicates', ({ targetPlatform, paths, root, executable }) => {
    const alpha = paths.join(root, 'alpha');
    const beta = paths.join(root, 'beta');
    const missing = paths.join(root, 'missing');
    const existing = new Set([paths.join(alpha, executable), paths.join(beta, executable)]);
    const options = listCondaPythonOptions(
      `${alpha}\n${missing}\n${alpha}\n\n${beta}\n`,
      (path) => existing.has(path),
      targetPlatform,
    );
    expect(options).toEqual([
      { value: paths.join(alpha, executable), label: `alpha · ${alpha}` },
      { value: paths.join(beta, executable), label: `beta · ${beta}` },
    ]);
  });
});
