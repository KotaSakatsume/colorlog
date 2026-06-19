/**
 * 画像2サイズ（本画像・サムネ）のサイズ決定純ロジック。
 *
 * Firebase / expo-image-manipulator 非依存の純関数。寸法計算を domain 層に閉じ込め、
 * Mock / Expo の `ImageProcessor` 実装はこの関数を共有する（native 非依存で node テスト可能）。
 * 定数（長辺・JPEG 品質）も SPEC §13.3（実装コスト規律）の数値をここ1か所に集約する。
 */

/** 本画像の長辺上限（px）。SPEC §13.3: 長辺1600px・約300KB目安。 */
export const MAIN_MAX_LONG_EDGE = 1600;
/** サムネの長辺上限（px）。SPEC §13.3。 */
export const THUMB_MAX_LONG_EDGE = 400;
/** JPEG 圧縮品質（0.0〜1.0、1=無圧縮）。SPEC §13.3: 0.7。 */
export const JPEG_QUALITY = 0.7;

/**
 * アスペクト比を保ったまま、長辺が `maxLongEdge` を超えない目標寸法を返す。
 *
 * - 縮小のみ・拡大しない: 長辺 max(srcW,srcH) が maxLongEdge 以下なら入力寸法を整数化して返す。
 * - アスペクト比保持: scale = maxLongEdge / longEdge を両辺に掛ける。
 * - 丸め: Math.round。ただし長辺は丸め誤差で max を超えないよう Math.min(_, maxLongEdge) でクランプし、
 *   短辺は Math.max(1, ...) で最低1pxを保証（極端比でも 0px に潰さない）。
 * - フォールバック: srcW/srcH/maxLongEdge が 0・負・非有限（NaN/Infinity）のいずれかなら
 *   `{ width: 0, height: 0 }` を返す。寸法不明の安全値で、呼び出し側（ImageProcessor 実装）が
 *   「resize をスキップして原寸保存する」などのガード判断に使う。
 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  maxLongEdge: number,
): { width: number; height: number } {
  // 0・負・非有限はフォールバック（呼び出し側がスキップ判断できる安全値）。
  if (
    !Number.isFinite(srcW) ||
    !Number.isFinite(srcH) ||
    !Number.isFinite(maxLongEdge) ||
    srcW <= 0 ||
    srcH <= 0 ||
    maxLongEdge <= 0
  ) {
    return { width: 0, height: 0 };
  }

  const longEdge = Math.max(srcW, srcH);

  // 拡大しない: 長辺が上限以下なら入力寸法を整数化して返す。
  if (longEdge <= maxLongEdge) {
    return { width: Math.round(srcW), height: Math.round(srcH) };
  }

  const scale = maxLongEdge / longEdge;
  const isWidthLong = srcW >= srcH;

  // 長辺側は丸め誤差で max を超えないようクランプ、短辺側は最低1pxを保証。
  const width = isWidthLong
    ? Math.min(Math.round(srcW * scale), maxLongEdge)
    : Math.max(1, Math.round(srcW * scale));
  const height = isWidthLong
    ? Math.max(1, Math.round(srcH * scale))
    : Math.min(Math.round(srcH * scale), maxLongEdge);

  return { width, height };
}
