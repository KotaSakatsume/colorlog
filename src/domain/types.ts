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
