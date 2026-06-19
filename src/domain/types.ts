/**
 * ドメインモデル（SPEC セクション4）
 *
 * 注: SPEC では Firestore の `Timestamp` を使うが、ドメイン層は Firebase 非依存に保つため
 * 時刻はすべて素の `Date` で表現する。Firebase 実装側で Timestamp <-> Date を変換する。
 */

import type { AssignedColor } from './colors';

export type TripStatus = 'planning' | 'active' | 'finished';

/** trips/{tripId}.members[uid] に内包されるメンバー情報 */
export type Member = {
  displayName: string;
  photoURL?: string;
  /** 配布後に入る。未配布なら undefined */
  color?: AssignedColor;
  /** 公開中の枚数（0〜9）。ルールで上限強制 */
  postCount?: number;
  /** 連投レート制限用 */
  lastPostAt?: Date;
};

/**
 * trips/{tripId}
 * メンバーはサブコレクションにせずドキュメント内に内包する
 * （配布をトランザクション1発にするため。上限12人なのでサイズ問題なし）。
 */
export type Trip = {
  /** Firestore のドキュメント ID。ドメインでも持ち回すと取り回しが楽。 */
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  hostUserId: string;
  status: TripStatus;
  colorsAssigned: boolean;
  /** セキュリティルール判定用の配列 */
  memberIds: string[];
  /** マップで内包 */
  members: Record<string, Member>;
};

/**
 * trips/{tripId}/posts/{postId}
 * 投稿は無制限に増えるのでサブコレクションが正解。
 * 1メンバーにつき最大9件（slotIndex 0〜8）。
 */
export type Post = {
  id: string;
  userId: string;
  color: AssignedColor;
  caption: string;
  /** 400px サムネ */
  thumbURL: string;
  /** 長辺1600px 本画像 */
  imageURL: string;
  createdAt: Date;
  /** 0〜8。ベスト9グリッド上の位置 */
  slotIndex: number;
};

/**
 * inviteCodes/{code}
 * 未参加者がトリップを引くためのルックアップ用。
 */
export type InviteCode = {
  code: string;
  tripId: string;
  expiresAt: Date;
};

/** ベスト9グリッドのスロット数（3×3） */
export const BEST_NINE_SLOTS = 9;

/**
 * オフライン送信キュー（UploadQueue）のジョブ状態。
 * - pending: 未処理（送信待ち）。プロセッサが順に拾う。
 * - uploading: 処理中（揮発。再起動 rehydrate で pending に戻す）。
 * - failed: promotePhoto 失敗。attempts を増やしてバックオフ後に再試行 or 手動 retry 待ち。
 */
export type UploadJobStatus = 'pending' | 'uploading' | 'failed';

/**
 * 撮影と昇格(promotePhoto)を分離する送信ジョブ。
 * AsyncStorage に JSON で永続化するため、すべて JSON シリアライズ可能な値で構成する
 * （`createdAt` は epoch ms、`Date`/関数/循環を含まない）。
 */
export type UploadJob = {
  id: string;
  tripId: string;
  /** 起票ユーザー。promotePhoto 再実行に必要な AuthUser 全体（displayName/photoURL 含む）。 */
  user: { uid: string; displayName: string; photoURL?: string };
  /** 0〜8。差し替え対象 or 追加先のスロット。 */
  slotIndex: number;
  /** ベスト9へ昇格させる端末内の写真。 */
  localImage: { uri: string; width?: number; height?: number };
  caption: string;
  status: UploadJobStatus;
  /** 失敗回数。バックオフ算出と上限判定に使う。 */
  attempts: number;
  /** epoch ms（JSON シリアライズ容易・順序保証）。 */
  createdAt: number;
  /** 直近の失敗理由（UI 表示用）。 */
  error?: string;
};

/** リアクションに使える絵文字の確定集合（UI の並び順もこの順）。 */
export const REACTION_EMOJIS = ['❤️', '😍', '👏', '🔥', '😂'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/**
 * 1 つの Post に対するリアクション集計。
 * - counts: 絵文字ごとの押下数（0 のキーは省略可）。
 * - mine: 自分が現在押している絵文字（未押下なら null）。1人1リアクション制。
 */
export type ReactionSummary = {
  postId: string;
  counts: Partial<Record<ReactionEmoji, number>>;
  mine: ReactionEmoji | null;
};
