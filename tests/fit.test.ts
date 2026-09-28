import { describe, expect, it } from 'vitest';
import { levelBands } from '../src/request.ts';
import { fitIsotonic, fitLinear, fitReadout, pava, type Sample } from '../evals/fit.ts';

const REPS = levelBands(true).map((band) => band.representative);

function sample(id: string, p: number[], y: number): Sample {
  return {
    id,
    skill: '测试',
    family: 'fine',
    x: p.reduce((sum, share, index) => sum + share * REPS[index]!, 0),
    p,
    y,
  };
}

function oneHot(position: number): number[] {
  return Array.from({ length: REPS.length }, (_, index) => (index === position ? 1 : 0));
}

describe('readout fitting', () => {
  it('pools order violations with PAVA', () => {
    expect(pava([3, 1, 2, 5], [1, 1, 1, 1])).toEqual([2, 2, 2, 5]);
    expect(pava([1, 2, 3], [1, 1, 1])).toEqual([1, 2, 3]);
  });

  it('recovers an exact linear relation', () => {
    const samples = Array.from({ length: 20 }, (_, index) => sample(`s${index}`, oneHot(index % REPS.length), 5 + 10 * (index % REPS.length)));
    const weights = fitLinear(samples);
    weights.forEach((weight, index) => expect(weight).toBeCloseTo(5 + 10 * index, 5));
  });

  it('folds isotonic knots to strictly increasing x and non-decreasing y', () => {
    const knots = fitIsotonic([{ x: 5, y: 90 }, { x: 1, y: 10 }, { x: 3, y: 5 }, { x: 3, y: 9 }, { x: 2, y: 20 }]);
    expect(knots.map(([x]) => x)).toEqual([1, 2, 3, 5]);
    const fitted = knots.map(([, y]) => y);
    for (let index = 1; index < fitted.length; index += 1) {
      expect(fitted[index]!).toBeGreaterThanOrEqual(fitted[index - 1]!);
    }
  });

  it('picks a usable candidate by leave-one-out error', () => {
    const samples: Sample[] = [];
    for (let position = 0; position < REPS.length; position += 1) {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        samples.push(sample(`s${position}-${repeat}`, oneHot(position), REPS[position]!));
      }
    }
    const result = fitReadout(samples);
    expect(['identity', 'linear', 'isotonic', 'linear-isotonic']).toContain(result.readout.kind);
    expect(Number.isFinite(result.mae)).toBe(true);
    expect(result.loo.identity).toBeCloseTo(0, 6);
  });
});
