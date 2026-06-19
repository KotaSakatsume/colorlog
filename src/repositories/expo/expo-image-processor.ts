/**
 * Expo の ImageProcessor 実装（expo-image-manipulator v14 / SDK54）。
 *
 * 本画像（長辺1600）・サムネ（長辺400）を JPEG 0.7 で生成する。
 * 寸法決定は domain の computeTargetSize に委譲し、リサイズは長辺のみ指定して比率は SDK 自動算出に任せる
 * （両辺指定の丸め歪み回避・research リスク3）。申告寸法は saveAsync の実測値を採用する。
 *
 * 注意:
 * - 旧 manipulateAsync は @deprecated。新 Context API（manipulate→resize→renderAsync→saveAsync）を使う。
 * - renderAsync() の await を忘れると ImageRef でなく Promise を saveAsync しようとして落ちる（research リスク1）。
 * - このファイルは native モジュール解決が要るため node の jest 対象外（.test.ts を作らない）。型のみ通す。
 * - 実 Storage へのアップロードはしない（別Issue）。返す uri は manipulate 出力のローカル URI。
 */

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import {
  JPEG_QUALITY,
  MAIN_MAX_LONG_EDGE,
  THUMB_MAX_LONG_EDGE,
  computeTargetSize,
} from '@/domain/image-sizing';
import type {
  ImageProcessor,
  LocalImage,
  ProcessedImage,
  ProcessedImages,
} from '@/repositories/types';

export class ExpoImageProcessor implements ImageProcessor {
  async process(input: LocalImage): Promise<ProcessedImages> {
    // 元寸法は picker 結果（width/height）を起点に。欠落時は原寸保存（リサイズ省略）にフォールバック。
    const srcW = input.width;
    const srcH = input.height;
    const main = await this.resizeTo(input.uri, srcW, srcH, MAIN_MAX_LONG_EDGE);
    const thumb = await this.resizeTo(input.uri, srcW, srcH, THUMB_MAX_LONG_EDGE);
    return { main, thumb };
  }

  /**
   * 単一サイズへ縮小して JPEG 保存する。
   * 長辺のみを resize に渡し、比率は SDK 自動算出に委ねる（両辺指定の歪み回避）。
   * 寸法不明（target が {0,0}）の場合はリサイズせず原寸のまま保存する。
   */
  private async resizeTo(
    uri: string,
    srcW: number | undefined,
    srcH: number | undefined,
    maxLongEdge: number,
  ): Promise<ProcessedImage> {
    const target =
      srcW != null && srcH != null ? computeTargetSize(srcW, srcH, maxLongEdge) : { width: 0, height: 0 };

    let context = ImageManipulator.manipulate(uri);
    if (target.width > 0 && target.height > 0) {
      // 長辺のみ指定（他方は SDK が比率保持で算出）。
      context =
        target.width >= target.height
          ? context.resize({ width: target.width })
          : context.resize({ height: target.height });
    }

    const ref = await context.renderAsync();
    const result = await ref.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });

    // 申告寸法は実測値（saveAsync の戻り）を採用し、ファイル実体と一致させる。
    return { uri: result.uri, width: result.width, height: result.height };
  }
}
