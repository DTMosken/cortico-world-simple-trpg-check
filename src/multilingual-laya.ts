import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const WORKER_FILE = fileURLToPath(new URL('../python/laya_multilingual_worker.py', import.meta.url));

export interface MultilingualLayaModel {
  systemOne(state: unknown, questions: unknown): Promise<unknown>;
  close(): Promise<void>;
}

class PythonLayaModel implements MultilingualLayaModel {
  private nextId = 0;
  private readonly pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
  private readonly ready: Promise<void>;
  private readonly exited: Promise<void>;
  private closed = false;

  constructor(private readonly worker: ChildProcessWithoutNullStreams) {
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Laya multilingual 加载超时')), 120_000);
      const lines = createInterface({ input: worker.stdout });
      lines.on('line', (line) => {
        let message: Record<string, unknown>;
        try { message = JSON.parse(line) as Record<string, unknown>; }
        catch { this.fail(new Error('Laya multilingual 返回了无效 JSON')); return; }
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve();
          return;
        }
        const id = message.id;
        if (typeof id !== 'string') return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (message.ok === true) pending.resolve(message.result);
        else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Laya multilingual 请求失败'));
      });
      worker.once('error', () => { clearTimeout(timeout); reject(new Error('Python 进程无法启动')); });
      worker.once('exit', (code) => {
        clearTimeout(timeout);
        const error = new Error(`Laya multilingual 进程已退出：${code ?? 'unknown'}`);
        reject(error);
        this.fail(error);
      });
    });
    this.exited = new Promise((resolve) => worker.once('exit', () => resolve()));
  }

  async waitUntilReady(): Promise<void> { await this.ready; }

  async systemOne(state: unknown, questions: unknown): Promise<unknown> {
    if (this.closed) throw new Error('Laya multilingual 已停止');
    const id = String(++this.nextId);
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.worker.stdin.write(`${JSON.stringify({ id, state, questions })}\n`);
    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return this.exited;
    this.closed = true;
    this.worker.stdin.write(`${JSON.stringify({ type: 'close' })}\n`);
    this.worker.stdin.end();
    await this.exited;
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export async function startMultilingualLaya(pythonExecutable: string): Promise<MultilingualLayaModel> {
  const worker = spawn(pythonExecutable, [WORKER_FILE], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  worker.stderr.pipe(process.stderr);
  const model = new PythonLayaModel(worker);
  try { await model.waitUntilReady(); }
  catch (error) { worker.kill(); throw error; }
  return model;
}
