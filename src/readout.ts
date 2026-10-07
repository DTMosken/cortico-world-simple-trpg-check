/**
 * 水平读出（level readout）：把模型给出的档位分布映射成 0–100 的水平。
 *
 * 读出是离线训练的产物（见 src/level-readout.ts 与 evals/train.ts）：运行时只做线性组合与插值，
 * 不训练、不访问网络。未训练的后端（本地 Laya 实测读不出水平证据）保持恒等读出。
 */
import { hasCalibratedReadout, type CheckBackend } from './config.ts';
import { LEVEL_READOUT } from './level-readout.ts';
import { levelBands } from './request.ts';

export type LevelReadout =
  | { kind: 'identity' }
  | { kind: 'linear'; weights: number[] }
  | { kind: 'isotonic'; knots: [number, number][] }
  | { kind: 'linear-isotonic'; weights: number[]; knots: [number, number][] };

/** 档位代表值的期望，即读出前的原始水平。 */
export function expectation(p: readonly number[]): number {
  return levelBands(true).reduce((sum, band, position) => sum + (p[position] ?? 0) * band.representative, 0);
}

/** 分段线性插值：knots 按 x 升序、y 非降；域外钳到端点。 */
export function interpolateKnots(knots: readonly (readonly [number, number])[], x: number): number {
  if (knots.length === 0) throw new Error('读出产物的 knots 不能为空');
  const first = knots[0]!;
  if (x <= first[0]) return first[1];
  for (let index = 1; index < knots.length; index += 1) {
    const previous = knots[index - 1]!;
    const current = knots[index]!;
    if (x <= current[0]) {
      const span = current[0] - previous[0];
      return span === 0 ? current[1] : previous[1] + ((x - previous[0]) / span) * (current[1] - previous[1]);
    }
  }
  return knots[knots.length - 1]![1];
}

/** 把档位分布过一遍读出；输出钳在 0–100（难度还会再钳到 1–99）。 */
export function applyReadout(p: readonly number[], readout: LevelReadout): number {
  let level: number;
  switch (readout.kind) {
    case 'identity':
      level = expectation(p);
      break;
    case 'linear':
      level = readout.weights.reduce((sum, weight, index) => sum + weight * (p[index] ?? 0), 0);
      break;
    case 'isotonic':
      level = interpolateKnots(readout.knots, expectation(p));
      break;
    case 'linear-isotonic': {
      const linear = readout.weights.reduce((sum, weight, index) => sum + weight * (p[index] ?? 0), 0);
      level = interpolateKnots(readout.knots, linear);
      break;
    }
  }
  return Math.max(0, Math.min(100, level));
}

/** 默认 JEV 模型使用训练产物；其余模型取档位代表值的期望。 */
export function readoutFor(backend: CheckBackend, model?: string): LevelReadout {
  return backend === 'jev' && (model === undefined || hasCalibratedReadout(model)) ? LEVEL_READOUT : { kind: 'identity' };
}
