/**
 * 读出拟合的纯函数：最小二乘、等渗回归（PAVA）、留一交叉验证。
 * 产物形状与运行时行为都在 src/readout.ts；这里只负责从样本里挑出那个映射。
 */
import { levelBands } from '../src/request.ts';
import { applyReadout, type LevelReadout } from '../src/readout.ts';

export interface Sample {
  id: string;
  skill: string;
  family: 'anchor' | 'fine';
  /** 读出前的原始期望：档位代表值的加权平均（与 expectation(p) 一致）。 */
  x: number;
  /** 归一化的档位分布（与 LEVEL_OPTIONS 同序，和为 1）。 */
  p: number[];
  /** 意图水平（标注侧）。 */
  y: number;
}

export interface FitResult {
  readout: LevelReadout;
  /** 每个候选的留一平均绝对误差（候选不可用时为 Infinity）。 */
  loo: Record<string, number>;
  /** 选中读出在全量数据上的平均绝对误差 / 带符号偏差 / 最大绝对误差。 */
  mae: number;
  bias: number;
  maxError: number;
}

export function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

/** 高斯-约当消元。 */
function solve(matrix: number[][], vector: number[]): number[] {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]!]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]![column]!) > Math.abs(augmented[pivot]![column]!)) pivot = row;
    }
    const swap = augmented[column]!;
    augmented[column] = augmented[pivot]!;
    augmented[pivot] = swap;
    const head = augmented[column]![column]!;
    if (Math.abs(head) < 1e-12) continue;
    for (let k = column; k <= size; k += 1) augmented[column]![k] = augmented[column]![k]! / head;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]![column]!;
      if (factor === 0) continue;
      for (let k = column; k <= size; k += 1) {
        augmented[row]![k] = augmented[row]![k]! - factor * augmented[column]![k]!;
      }
    }
  }
  return augmented.map((row) => row[size]!);
}

/** 对每个档位求“学习代表值”最小二乘：y ≈ Σ weights_i·p_i。p 归一化后各列线性相关，
 * 用截距 + 前 n−1 个特征（最后一个档位作参考）的参数化消掉冗余，再折成 n 元权重，解唯一。 */
export function fitLinear(samples: Sample[]): number[] {
  const width = samples[0]?.p.length ?? 0;
  if (width < 2) throw new Error('样本的档位分布为空');
  const matrix = Array.from({ length: width }, () => new Array<number>(width).fill(0));
  const vector = new Array<number>(width).fill(0);
  for (const sample of samples) {
    const features = [1, ...sample.p.slice(0, width - 1)];
    for (let row = 0; row < width; row += 1) {
      for (let column = 0; column < width; column += 1) {
        matrix[row]![column] += features[row]! * features[column]!;
      }
      vector[row] += features[row]! * sample.y;
    }
  }
  for (let index = 0; index < width; index += 1) matrix[index]![index] += 1e-9;
  const solution = solve(matrix, vector);
  const anchor = solution[0]!;
  return [...solution.slice(1).map((weight) => weight + anchor), anchor];
}

/** 保序回归（PAVA）：返回与输入等长的非降拟合值。 */
export function pava(values: number[], weights: number[]): number[] {
  interface Block { sum: number; weight: number; start: number; end: number }
  const blocks: Block[] = [];
  for (let index = 0; index < values.length; index += 1) {
    let block: Block = { sum: values[index]! * weights[index]!, weight: weights[index]!, start: index, end: index };
    while (blocks.length > 0) {
      const previous = blocks[blocks.length - 1]!;
      if (previous.sum / previous.weight <= block.sum / block.weight) break;
      blocks.pop();
      block = { sum: previous.sum + block.sum, weight: previous.weight + block.weight, start: previous.start, end: block.end };
    }
    blocks.push(block);
  }
  const fitted = new Array<number>(values.length).fill(0);
  for (const block of blocks) {
    const value = block.sum / block.weight;
    for (let index = block.start; index <= block.end; index += 1) fitted[index] = value;
  }
  return fitted;
}

/** 等渗回归折成单调分段线性 knots：x 严格升序、y 非降。x 先吸附到产物精度（0.01），重复项并档。 */
export function fitIsotonic(points: { x: number; y: number }[]): [number, number][] {
  const snapped = points.map((point) => ({ x: Math.round(point.x * 100) / 100, y: point.y }));
  const sorted = [...snapped].sort((left, right) => left.x - right.x);
  const xs: number[] = [];
  const ys: number[] = [];
  const counts: number[] = [];
  for (const point of sorted) {
    const last = xs.length - 1;
    if (last >= 0 && xs[last] === point.x) {
      ys[last] = (ys[last]! * counts[last]! + point.y) / (counts[last]! + 1);
      counts[last] += 1;
    } else {
      xs.push(point.x);
      ys.push(point.y);
      counts.push(1);
    }
  }
  const fitted = pava(ys, counts);
  return xs.map((x, index) => [x, fitted[index]!]);
}

export function isNonDecreasing(values: number[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index]! < values[index - 1]! - 1e-9) return false;
  }
  return true;
}

/**
 * 收缩读出（“学习率”所在的位置）：γ = 1 完全采用拟合值，γ < 1 把读出往未训练的基线拉——
 * 线性档 → 档位代表值，等渗映射 → y = x。两条基线都单调不减，所以收缩后仍然单调。
 * 线性+等渗只收缩线性段（knots 只在拟合尺度上有意义）。
 */
export function shrinkReadout(readout: LevelReadout, gamma: number): LevelReadout {
  if (gamma >= 1) return readout;
  const reps = levelBands(true).map((band) => band.representative);
  const toward = (value: number, baseline: number) => baseline + gamma * (value - baseline);
  switch (readout.kind) {
    case 'identity':
      return readout;
    case 'linear':
      return { kind: 'linear', weights: readout.weights.map((weight, index) => toward(weight, reps[index] ?? weight)) };
    case 'isotonic':
      return { kind: 'isotonic', knots: readout.knots.map(([x, y]) => [x, toward(y, x)] as [number, number]) };
    case 'linear-isotonic':
      return {
        kind: 'linear-isotonic',
        weights: readout.weights.map((weight, index) => toward(weight, reps[index] ?? weight)),
        knots: readout.knots,
      };
  }
}

interface Candidate {
  name: string;
  build(samples: Sample[]): LevelReadout | null;
}

/** 候选读出；线性候选要求档位权重非降，否则视为不可用。 */
const CANDIDATES: Candidate[] = [
  { name: 'identity', build: () => ({ kind: 'identity' }) },
  {
    name: 'linear',
    build: (samples) => {
      const weights = fitLinear(samples);
      return isNonDecreasing(weights) ? { kind: 'linear', weights } : null;
    },
  },
  {
    name: 'isotonic',
    build: (samples) => ({ kind: 'isotonic', knots: fitIsotonic(samples.map(({ x, y }) => ({ x, y }))) }),
  },
  {
    name: 'linear-isotonic',
    build: (samples) => {
      const weights = fitLinear(samples);
      if (!isNonDecreasing(weights)) return null;
      const points = samples.map((sample) => ({ x: dot(weights, sample.p), y: sample.y }));
      return { kind: 'linear-isotonic', weights, knots: fitIsotonic(points) };
    },
  },
];

function looError(samples: Sample[], build: Candidate['build'], shrinkage: number): number {
  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const readout = build(samples.filter((_, other) => other !== index));
    if (!readout) return Number.POSITIVE_INFINITY;
    total += Math.abs(applyReadout(samples[index]!.p, shrinkReadout(readout, shrinkage)) - samples[index]!.y);
  }
  return total / samples.length;
}

/** 用留一交叉验证在候选读出里挑一个（并列时取更简单者），并给出全量指标。shrinkage < 1 时更保守。 */
export function fitReadout(samples: Sample[], shrinkage = 1): FitResult {
  const loo: Record<string, number> = {};
  let chosen: LevelReadout | null = null;
  let chosenScore = Number.POSITIVE_INFINITY;
  for (const candidate of CANDIDATES) {
    const score = looError(samples, candidate.build, shrinkage);
    loo[candidate.name] = score;
    if (score < chosenScore) {
      const readout = candidate.build(samples);
      if (readout) {
        chosen = shrinkReadout(readout, shrinkage);
        chosenScore = score;
      }
    }
  }
  if (!chosen) throw new Error('没有可用的读出候选');
  const errors = samples.map((sample) => applyReadout(sample.p, chosen as LevelReadout) - sample.y);
  return {
    readout: chosen,
    loo,
    mae: mean(errors.map((error) => Math.abs(error))),
    bias: mean(errors),
    maxError: Math.max(...errors.map((error) => Math.abs(error))),
  };
}
