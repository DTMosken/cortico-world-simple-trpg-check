import { describe, expect, it } from 'vitest';
import { LEVEL_READOUT } from '../src/level-readout.ts';
import { levelBands } from '../src/request.ts';
import { applyReadout, expectation, readoutFor, type LevelReadout } from '../src/readout.ts';

const BANDS = levelBands(true);
const LAST = BANDS.length - 1;
const ONE_HOT = (index: number): number[] => Array.from({ length: BANDS.length }, (_, position) => (position === index ? 1 : 0));

describe('level readout', () => {
  it('keeps the shipped artifact well formed', () => {
    expect(['identity', 'linear', 'isotonic', 'linear-isotonic']).toContain(LEVEL_READOUT.kind);
    if (LEVEL_READOUT.kind === 'linear' || LEVEL_READOUT.kind === 'linear-isotonic') {
      expect(LEVEL_READOUT.weights).toHaveLength(BANDS.length);
      LEVEL_READOUT.weights.forEach((weight) => expect(Number.isFinite(weight)).toBe(true));
      for (let index = 1; index < LEVEL_READOUT.weights.length; index += 1) {
        expect(LEVEL_READOUT.weights[index]!).toBeGreaterThanOrEqual(LEVEL_READOUT.weights[index - 1]!);
      }
    }
    if (LEVEL_READOUT.kind === 'isotonic' || LEVEL_READOUT.kind === 'linear-isotonic') {
      const knots = LEVEL_READOUT.knots;
      expect(knots.length).toBeGreaterThanOrEqual(2);
      knots.forEach(([x, y]) => {
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
      });
      for (let index = 1; index < knots.length; index += 1) {
        expect(knots[index]![0]).toBeGreaterThan(knots[index - 1]![0]);
        expect(knots[index]![1]).toBeGreaterThanOrEqual(knots[index - 1]![1]);
      }
    }
  });

  it('reads the raw expectation from the band representatives', () => {
    expect(expectation(ONE_HOT(0))).toBe(3);
    expect(expectation(ONE_HOT(LAST))).toBe(95);
    expect(expectation(ONE_HOT(3))).toBe(35);
    const half = ONE_HOT(0).map((_, position) => (position === 0 || position === 3 ? 0.5 : 0));
    expect(expectation(half)).toBe(19);
  });

  it('keeps local checkpoints on the identity readout', () => {
    expect(readoutFor('laya').kind).toBe('identity');
    expect(readoutFor('laya-multilingual').kind).toBe('identity');
    expect(applyReadout(ONE_HOT(3), readoutFor('laya'))).toBe(35);
  });

  it('applies a linear readout to the distribution', () => {
    const readout: LevelReadout = { kind: 'linear', weights: BANDS.map((_, index) => index * 10) };
    expect(applyReadout(ONE_HOT(0), readout)).toBe(0);
    expect(applyReadout(ONE_HOT(LAST), readout)).toBe(LAST * 10);
    const half = ONE_HOT(0).map((_, position) => (position === 0 || position === LAST ? 0.5 : 0));
    expect(applyReadout(half, readout)).toBe((LAST * 10) / 2);
  });

  it('interpolates isotonic knots and clamps outside their domain', () => {
    const readout: LevelReadout = { kind: 'isotonic', knots: [[10, 20], [30, 40]] };
    expect(applyReadout(ONE_HOT(0), readout)).toBe(20);
    expect(applyReadout(ONE_HOT(1), readout)).toBe(22);
    expect(applyReadout(ONE_HOT(LAST), readout)).toBe(40);
  });

  it('stays monotone across one-hot distributions', () => {
    const readout = readoutFor('jev');
    const levels = Array.from({ length: BANDS.length }, (_, index) => applyReadout(ONE_HOT(index), readout));
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!).toBeGreaterThanOrEqual(levels[index - 1]!);
    }
  });

  it('clamps the readout output to 0–100', () => {
    expect(applyReadout(ONE_HOT(0), { kind: 'linear', weights: BANDS.map((_, index) => (index === 0 ? 200 : 0)) })).toBe(100);
    expect(applyReadout(ONE_HOT(0), { kind: 'linear', weights: BANDS.map((_, index) => (index === 0 ? -200 : 0)) })).toBe(0);
  });
});
