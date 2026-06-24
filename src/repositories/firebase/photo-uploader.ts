/**
 * 画像アップロードの継ぎ目（§9-7・設計 §2）。
 *
 * FirebasePostRepository に DI する境界。処理済み2サイズ（main/thumb・ローカル JPEG）と
 * パス座標（tripId/uid/postId）を受け取り、本画像 / サムネのダウンロード URL を返す。
 *
 * - 実 Storage 実装は FirebasePhotoUploader（firebase-photo-uploader.ts）。
 * - passthrough スタブは uri をそのまま返す（Mock 同等・node 完結）。Mock/テスト用に残す。
 *
 * storage.rules の write 条件（パス {uid} == auth.uid・image/jpeg・<1.5MiB）を満たすため、
 * アップロード先パスを uploader が組めるよう座標を引数で受け取る（設計 §2）。
 */

import type { ProcessedImages } from '@/repositories/types';

/** アップロード先のパス座標。postId は promotePhoto 側が決定（`${uid}_${slotIndex}`）。 */
export interface PhotoUploadTarget {
  tripId: string;
  uid: string;
  postId: string;
}

/** 処理済み2サイズ（ローカル JPEG）+ パス座標を本画像 / サムネ URL に解決する境界。 */
export interface PhotoUploader {
  upload(
    images: ProcessedImages,
    target: PhotoUploadTarget,
  ): Promise<{ imageURL: string; thumbURL: string }>;
}

/**
 * passthrough スタブ。処理済み main/thumb の uri をそのまま imageURL / thumbURL に使う（Mock 同等）。
 * target は無視（パスを組まない）。実 Storage アップロードは FirebasePhotoUploader が担う。
 */
export function createPassthroughUploader(): PhotoUploader {
  return {
    async upload(images: ProcessedImages) {
      return { imageURL: images.main.uri, thumbURL: images.thumb.uri };
    },
  };
}
