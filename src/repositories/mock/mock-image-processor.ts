/**
 * Mock の ImageProcessor 実装（expo 非依存・node 完結）。
 *
 * 実ファイル変換は行わず、domain の computeTargetSize で本画像（長辺1600）・サムネ（長辺400）の
 * 目標寸法のみ算出し、uri は入力 uri をベースにしたスタブを返す。
 * compose 経路では LocalImage.width/height が常に欠落する（research §4）ため、寸法欠落時の
 * フォールバック（FALLBACK_SRC_LONG_EDGE 基準の正方寸法で計算）をここで吸収する。
 * expo-image-manipulator を import しないことで node テストへの native 混入を防ぐ。
 */

import {
  MAIN_MAX_LONG_EDGE,
  THUMB_MAX_LONG_EDGE,
  computeTargetSize,
} from '@/domain/image-sizing';
import type { ImageProcessor, LocalImage, ProcessedImages } from '@/repositories/types';

/**
 * 寸法不明（width/height 欠落）時に使う仮の元寸法（長辺 px）。
 * Mock は実画像を読まないため、計算を成立させるための便宜値。
 * 1600 以上にして「縮小が必ず働く」ようにし、main/thumb とも上限に張り付くことを確認できる値。
 */
const FALLBACK_SRC_LONG_EDGE = 2000;

export class MockImageProcessor implements ImageProcessor {
  async process(input: LocalImage): Promise<ProcessedImages> {
    // 寸法欠落（compose 経路の常態）は仮の正方寸法へフォールバック。
    const srcW =
      typeof input.width === 'number' && Number.isFinite(input.width) && input.width > 0
        ? input.width
        : FALLBACK_SRC_LONG_EDGE;
    const srcH =
      typeof input.height === 'number' && Number.isFinite(input.height) && input.height > 0
        ? input.height
        : FALLBACK_SRC_LONG_EDGE;

    const main = computeTargetSize(srcW, srcH, MAIN_MAX_LONG_EDGE);
    const thumb = computeTargetSize(srcW, srcH, THUMB_MAX_LONG_EDGE);

    return {
      main: { uri: `${input.uri}#main`, width: main.width, height: main.height },
      thumb: { uri: `${input.uri}#thumb`, width: thumb.width, height: thumb.height },
    };
  }
}
