import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { basename, join } from 'node:path';

export interface CondaPythonOption {
  value: string;
  label: string;
}

export function listCondaPythonOptions(
  manifest: string,
  exists: (path: string) => boolean = existsSync,
  targetPlatform: NodeJS.Platform = platform(),
): CondaPythonOption[] {
  const executable = targetPlatform === 'win32' ? 'python.exe' : join('bin', 'python');
  const seen = new Set<string>();
  const options: CondaPythonOption[] = [];
  for (const line of manifest.split(/\r?\n/u)) {
    const prefix = line.trim();
    if (!prefix || seen.has(prefix)) continue;
    seen.add(prefix);
    const pythonExecutable = join(prefix, executable);
    if (!exists(pythonExecutable)) continue;
    options.push({ value: pythonExecutable, label: `${basename(prefix)} · ${prefix}` });
  }
  return options;
}

export function discoverCondaPythonOptions(): CondaPythonOption[] {
  try {
    return listCondaPythonOptions(readFileSync(join(homedir(), '.conda', 'environments.txt'), 'utf8'));
  } catch {
    return [];
  }
}
