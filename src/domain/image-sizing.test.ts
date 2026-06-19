import { describe, expect, it } from '@jest/globals';

import {
  JPEG_QUALITY,
  MAIN_MAX_LONG_EDGE,
  THUMB_MAX_LONG_EDGE,
  computeTargetSize,
} from './image-sizing';

/** アスペクト比（width/height）を比較するヘルパ。 */
const ratio = (w: number, h: number): number => w / h;

describe('定数 (SPEC §13.3)', () => {
  it('長辺上限と JPEG 品質が規律どおり', () => {
    expect(MAIN_MAX_LONG_EDGE).toBe(1600);
    expect(THUMB_MAX_LONG_EDGE).toBe(400);
    expect(JPEG_QUALITY).toBe(0.7);
  });
});

describe('computeTargetSize', () => {
  it('横長: 長辺を max に合わせ、比率を保つ', () => {
    const { width, height } = computeTargetSize(4000, 3000, 1600);
    expect(width).toBe(1600); // 長辺はちょうど max
    expect(height).toBe(1200); // 3000 * 0.4
    expect(ratio(width, height)).toBeCloseTo(ratio(4000, 3000), 5);
  });

  it('縦長: 長辺（高さ）を max に合わせる', () => {
    const { width, height } = computeTargetSize(3000, 4000, 1600);
    expect(height).toBe(1600);
    expect(width).toBe(1200);
    expect(ratio(width, height)).toBeCloseTo(ratio(3000, 4000), 5);
  });

  it('正方形: 両辺が max になる', () => {
    expect(computeTargetSize(2000, 2000, 1600)).toEqual({ width: 1600, height: 1600 });
  });

  it('長辺が max 未満: 据え置き（拡大しない）', () => {
    expect(computeTargetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it('長辺がちょうど max: 据え置き', () => {
    expect(computeTargetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it('丸めで長辺が max を超えない（クランプ）', () => {
    // 長辺 1601 → scale で round が 1600 を超えうるケースでも min クランプで 1600 に張り付く。
    const { width } = computeTargetSize(1601, 1600, 1600);
    expect(width).toBe(1600);
    expect(width).toBeLessThanOrEqual(1600);
  });

  it('極端比 4000x10 → 長辺1600・短辺は最低1pxを下回らない', () => {
    const { width, height } = computeTargetSize(4000, 10, 1600);
    expect(width).toBe(1600);
    expect(height).toBe(4); // max(1, round(10 * 0.4)) = 4
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it('極端比で短辺が round で 0 に潰れても最低1pxを保証', () => {
    const { width, height } = computeTargetSize(100000, 1, 1600);
    expect(width).toBe(1600);
    expect(height).toBe(1); // round は 0 だが max(1, 0) = 1
  });

  it('サムネ長辺 400 でも同じ規則が効く', () => {
    const { width, height } = computeTargetSize(4000, 3000, THUMB_MAX_LONG_EDGE);
    expect(width).toBe(400);
    expect(height).toBe(300);
  });

  it('寸法 0 はフォールバック {0,0}', () => {
    expect(computeTargetSize(0, 1000, 1600)).toEqual({ width: 0, height: 0 });
    expect(computeTargetSize(1000, 0, 1600)).toEqual({ width: 0, height: 0 });
  });

  it('負値はフォールバック {0,0}', () => {
    expect(computeTargetSize(-100, 200, 1600)).toEqual({ width: 0, height: 0 });
  });

  it('NaN / Infinity はフォールバック {0,0}', () => {
    expect(computeTargetSize(NaN, 1000, 1600)).toEqual({ width: 0, height: 0 });
    expect(computeTargetSize(1000, Infinity, 1600)).toEqual({ width: 0, height: 0 });
    // undefined を数値として渡す（呼び出し側の欠落を模す）と NaN 演算経由でフォールバック。
    expect(computeTargetSize(undefined as unknown as number, 1000, 1600)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('maxLongEdge が 0・負ならフォールバック {0,0}', () => {
    expect(computeTargetSize(1000, 1000, 0)).toEqual({ width: 0, height: 0 });
    expect(computeTargetSize(1000, 1000, -1600)).toEqual({ width: 0, height: 0 });
  });
});
