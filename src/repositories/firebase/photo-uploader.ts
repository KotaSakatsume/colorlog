/**
 * 画像アップロードの継ぎ目（§9-7 へのフック・§9-5 では passthrough スタブのみ）。
 *
 * FirebasePostRepository に DI する境界。本Issueでは実 Storage（@react-native-firebase/storage）は
 * 書かない（設計 §6 やらないこと-1）。passthrough スタブが端末内 uri をそのまま返す＝Mock と同じ挙動。
 * 実 Storage 実装は別Issueでこの interface を満たす実装に差し替えるだけ。
 */

import type { LocalImage } from '@/repositories/types';

/** 昇格対象画像を本画像 / サムネ URL に解決する境界。 */
export interface PhotoUploader {
  upload(input: LocalImage): Promise<{ imageURL: string; thumbURL: string }>;
}

/**
 * passthrough スタブ。端末内 uri をそのまま imageURL / thumbURL に使う（Mock 同等）。
 * 実 Storage アップロードは §9-7 で本 interface の別実装に差し替える。
 */
export function createPassthroughUploader(): PhotoUploader {
  return {
    async upload(input: LocalImage) {
      return { imageURL: input.uri, thumbURL: input.uri };
    },
  };
}
