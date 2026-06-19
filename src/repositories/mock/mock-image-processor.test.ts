import { describe, expect, it } from '@jest/globals';

import { MAIN_MAX_LONG_EDGE, THUMB_MAX_LONG_EDGE } from '@/domain/image-sizing';
import type { LocalImage } from '@/repositories/types';

import { MockImageProcessor } from './mock-image-processor';

const longEdge = (w: number, h: number): number => Math.max(w, h);
const ratio = (w: number, h: number): number => w / h;

describe('MockImageProcessor', () => {
  const processor = new MockImageProcessor();

  it('main は長辺 ≤ 1600、thumb は長辺 ≤ 400', async () => {
    const { main, thumb } = await processor.process({ uri: 'file://x.jpg', width: 4000, height: 3000 });
    expect(longEdge(main.width, main.height)).toBeLessThanOrEqual(MAIN_MAX_LONG_EDGE);
    expect(longEdge(thumb.width, thumb.height)).toBeLessThanOrEqual(THUMB_MAX_LONG_EDGE);
  });

  it('main / thumb ともアスペクト比を保つ', async () => {
    const input: LocalImage = { uri: 'file://x.jpg', width: 4000, height: 3000 };
    const { main, thumb } = await processor.process(input);
    expect(ratio(main.width, main.height)).toBeCloseTo(ratio(4000, 3000), 5);
    expect(ratio(thumb.width, thumb.height)).toBeCloseTo(ratio(4000, 3000), 5);
  });

  it('入力が小さい場合は本画像を据え置き（拡大しない）', async () => {
    const { main } = await processor.process({ uri: 'file://small.jpg', width: 300, height: 200 });
    expect(main.width).toBe(300);
    expect(main.height).toBe(200);
  });

  it('uri は入力 uri ベースのスタブを返す', async () => {
    const { main, thumb } = await processor.process({ uri: 'file://x.jpg', width: 4000, height: 3000 });
    expect(main.uri).toBe('file://x.jpg#main');
    expect(thumb.uri).toBe('file://x.jpg#thumb');
  });

  it('寸法欠落（compose の常態）でもフォールバックで有効な2サイズを返す', async () => {
    const { main, thumb } = await processor.process({ uri: 'file://nodims.jpg' });
    expect(longEdge(main.width, main.height)).toBeLessThanOrEqual(MAIN_MAX_LONG_EDGE);
    expect(longEdge(thumb.width, thumb.height)).toBeLessThanOrEqual(THUMB_MAX_LONG_EDGE);
    // 0px に潰れない（resize へ {0,0} を流さない保証）。
    expect(main.width).toBeGreaterThan(0);
    expect(main.height).toBeGreaterThan(0);
    expect(thumb.width).toBeGreaterThan(0);
    expect(thumb.height).toBeGreaterThan(0);
    expect(main.uri).toBe('file://nodims.jpg#main');
  });

  it('片方の寸法だけ欠落してもフォールバックする', async () => {
    const { main } = await processor.process({ uri: 'file://half.jpg', width: 4000 });
    expect(main.width).toBeGreaterThan(0);
    expect(main.height).toBeGreaterThan(0);
  });

  it('不正寸法（0 / 負）はフォールバックで 0px に潰さない', async () => {
    const { main, thumb } = await processor.process({ uri: 'file://bad.jpg', width: 0, height: -10 });
    expect(main.width).toBeGreaterThan(0);
    expect(thumb.width).toBeGreaterThan(0);
  });
});
