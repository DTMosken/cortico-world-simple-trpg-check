import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { listCondaPythonOptions } from '../src/conda-environments.ts';

describe('Conda Python options', () => {
  it('lists registered environments with an interpreter and removes duplicates', () => {
    const alpha = 'C:\\envs\\alpha';
    const beta = 'C:\\envs\\beta';
    const missing = 'C:\\envs\\missing';
    const existing = new Set([join(alpha, 'python.exe'), join(beta, 'python.exe')]);
    const options = listCondaPythonOptions(
      `${alpha}\n${missing}\n${alpha}\n\n${beta}\n`,
      (path) => existing.has(path),
      'win32',
    );
    expect(options).toEqual([
      { value: join(alpha, 'python.exe'), label: `alpha · ${alpha}` },
      { value: join(beta, 'python.exe'), label: `beta · ${beta}` },
    ]);
  });
});
