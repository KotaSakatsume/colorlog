/**
 * FirebasePhotoUploader（実 Storage アップロード・§9-7後半 / 設計 §3）。
 *
 * RNFirebase storage modular API（getStorage / ref / putFile / getDownloadURL）で、
 * 処理済み2サイズ（main/thumb・ローカル JPEG）を以下のパスへアップロードし URL を返す:
 *   - main  → trips/{tripId}/{uid}/{postId}/main.jpg
 *   - thumb → trips/{tripId}/{uid}/{postId}/thumb.jpg
 *
 * 【R3 厳守】putFile に { contentType: 'image/jpeg' } を明示する。
 *   storage.rules の request.resource.contentType == 'image/jpeg' を満たすため必須
 *   （拡張子推測に依存しない）。
 *
 * - アップロード元は ProcessedImage.uri ＝ 端末ローカルファイル URI（expo-image-manipulator
 *   saveAsync 出力・file://...）。base64 ではないので putString ではなく putFile を使う
 *   （putFile はローカルファイルパスを直接アップロードする RNFirebase 専用 API）。
 * - main/thumb は独立パスのため Promise.all で並列アップロード。
 * - サイズ制約（<1.5MiB）は ImageProcessor 側で担保（長辺1600/400 JPEG）。ここで再圧縮はしない。
 *
 * 【隔離の要】@react-native-firebase/storage はこの firebase/ 配下のみで使用。modular 統一
 *   （namespaced 名前空間 API は使わない）。本ファイルは context.tsx の動的 require 経由でのみ評価される。
 */

import { getDownloadURL, getStorage, putFile, ref } from '@react-native-firebase/storage';

import type { ProcessedImage } from '@/repositories/types';

import type { PhotoUploader, PhotoUploadTarget } from './photo-uploader';

/** image/jpeg を明示するメタデータ（storage.rules の contentType 条件を満たすため必須）。 */
const JPEG_METADATA = { contentType: 'image/jpeg' } as const;

export class FirebasePhotoUploader implements PhotoUploader {
  async upload(
    images: { main: ProcessedImage; thumb: ProcessedImage },
    target: PhotoUploadTarget,
  ): Promise<{ imageURL: string; thumbURL: string }> {
    const storage = getStorage();
    const basePath = `trips/${target.tripId}/${target.uid}/${target.postId}`;

    const [imageURL, thumbURL] = await Promise.all([
      this.uploadOne(storage, `${basePath}/main.jpg`, images.main),
      this.uploadOne(storage, `${basePath}/thumb.jpg`, images.thumb),
    ]);

    return { imageURL, thumbURL };
  }

  /** 単一ローカル JPEG を指定パスへアップロードし、ダウンロード URL を返す。 */
  private async uploadOne(
    storage: ReturnType<typeof getStorage>,
    path: string,
    image: ProcessedImage,
  ): Promise<string> {
    const r = ref(storage, path);
    await putFile(r, image.uri, JPEG_METADATA);
    return getDownloadURL(r);
  }
}
