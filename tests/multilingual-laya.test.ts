import { spawn } from 'node:child_process';
import { expect, it } from 'vitest';
import { PythonLayaModel } from '../src/multilingual-laya.ts';

const WORKER = `
const lines = require('node:readline').createInterface({ input: process.stdin });
console.log(JSON.stringify({ type: 'ready' }));
lines.on('line', line => {
  const request = JSON.parse(line);
  if (request.type === 'close') process.exit(0);
  if (request.state === 'exit') process.exit(7);
  if (request.state === 'wait') return;
  console.log(JSON.stringify({ id: request.id, ok: true, result: request.questions }));
});
`;

it('rejects pending and subsequent requests after an unexpected worker exit', async () => {
  const model = new PythonLayaModel(spawn(process.execPath, ['-e', WORKER]));
  try {
    await model.waitUntilReady();
    expect(await model.systemOne('score', { skill: 'A' })).toEqual({ skill: 'A' });
    const pending = expect(model.systemOne('wait', {})).rejects.toThrow('进程已退出：7');
    const exiting = expect(model.systemOne('exit', {})).rejects.toThrow('进程已退出：7');
    await Promise.all([pending, exiting]);
    await expect(model.systemOne('score', {})).rejects.toThrow('已停止');
  } finally { await model.close(); }
});

it('rejects requests after a normal close and allows repeated close calls', async () => {
  const model = new PythonLayaModel(spawn(process.execPath, ['-e', WORKER]));
  await model.waitUntilReady();
  await model.close();
  await expect(model.systemOne({}, {})).rejects.toThrow('已停止');
  await model.close();
});
