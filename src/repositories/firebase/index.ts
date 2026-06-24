/**
 * Firebase リポジトリ一式のファクトリ（§9-5 / 設計 §5）。
 *
 * createFirebaseRepositories() が Repositories 型の5フィールド全てを返す
 *（auth / trips / posts / uploadQueue / imageProcessor）。型が閉じるのは5実装が揃ったときだけ
 *（設計 §1）。
 *
 * 【隔離の要】このモジュールは起動経路から静的 import されない。context.tsx が
 * Platform/appOwnership/FIREBASE_ENABLED ガード内で **動的 require** したときだけ評価される。
 * Expo Go / node では評価されず、@react-native-firebase / expo-apple-authentication /
 * expo-crypto / expo-image-manipulator の native 解決は走らない（リスク R1/R2）。
 *
 * - imageProcessor は既存 Expo 実装（ExpoImageProcessor）を流用。
 * - uploadQueue は既存 MockUploadQueue に posts.promotePhoto を注入して流用
 *   （オフライン送信キューのロジックは Firebase 化対象外＝設計の継ぎ目維持）。
 *   store は createAsyncStorageStore()（native だが「呼ぶのは Dev Build のみ」・storage.ts 前例）。
 */

import { ExpoImageProcessor } from '@/repositories/expo/expo-image-processor';
import { MockUploadQueue } from '@/repositories/mock/mock-upload-queue';
import { createAsyncStorageStore } from '@/repositories/storage';
import type { Repositories } from '@/repositories/types';

import { FirebaseAuthService } from './firebase-auth-service';
import { FirebasePhotoUploader } from './firebase-photo-uploader';
import { FirebasePostRepository } from './firebase-post-repository';
import { FirebaseTripRepository } from './firebase-trip-repository';

/** Firebase 実装一式を組み立てて返す。Dev Build でのみ呼ばれる（context.tsx の動的 require 経由）。 */
export function createFirebaseRepositories(): Repositories {
  // ImageProcessor は posts（promotePhoto で process を呼ぶ）と束フィールド（UI 用）の両方で同一インスタンスを共有。
  const imageProcessor = new ExpoImageProcessor();
  // posts は uploadQueue へ注入するため先に const 化（mock/index.ts と同手順）。
  // uploader を実 Storage 実装（FirebasePhotoUploader）に差し替え、ImageProcessor を constructor 注入（設計 §5）。
  const posts = new FirebasePostRepository(new FirebasePhotoUploader(), imageProcessor);
  const uploadQueue = new MockUploadQueue({
    promotePhoto: (input) => posts.promotePhoto(input),
    store: createAsyncStorageStore(),
  });
  return {
    auth: new FirebaseAuthService(),
    trips: new FirebaseTripRepository(),
    posts,
    uploadQueue,
    imageProcessor,
  };
}
