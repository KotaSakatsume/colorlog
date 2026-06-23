/**
 * Firestore Timestamp ⇄ ドメイン Date 変換と doc ⇄ domain マッピング（§9-5 / 設計 §4）。
 *
 * ここが Firebase 型（Timestamp / FieldValue）の唯一の出入口。domain/Mock/画面/node テストから
 * import してはいけない（firebase 隔離ディレクトリ内に閉じる）。doc→domain は必ず `*FromDoc` を経由し、
 * Firebase 型をこのファイル外に漏らさない（リスク R3 / R-C 対応）。
 *
 * 【書き込み時刻の R-B 厳守ルール（firestore.rules:114-119 serverTimestamped() 整合）】
 *   - `createdAt`（Post） / `members[uid].lastPostAt`（Member）は **serverTimestamp()**。
 *     クライアント時刻（Timestamp.fromDate）だと `== request.time` を満たせずルールで reject される。
 *   - `startDate` / `endDate`（Trip・ユーザー指定の Date） / `expiresAt`（InviteCode）は **Timestamp.fromDate**。
 *     ドメインの Date をそのまま固定値で書く（サーバ時刻ではない）。
 *   この書き分けはこのファイルの該当箇所にコメントで固定する。実挙動検証はゲートC後。
 */

import { FieldValue, Timestamp, serverTimestamp } from '@react-native-firebase/firestore';
import type {
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from '@react-native-firebase/firestore';

import type { AssignedColor } from '@/domain/colors';
import type { InviteCode, Member, Post, ReactionEmoji, Trip, TripStatus } from '@/domain/types';

/** Firestore Timestamp（または欠落）→ Date。null/undefined は安全に undefined。 */
export function tsToDate(ts: unknown): Date | undefined {
  if (ts instanceof Timestamp) {
    return ts.toDate();
  }
  return undefined;
}

/** Timestamp を要求する読み（必須フィールド用）。欠落時は暫定で new Date() を補完。 */
function tsToDateRequired(ts: unknown): Date {
  return tsToDate(ts) ?? new Date();
}

/* ------------------------------------------------------------------ *
 * 書き込みヘルパ（R-B 書き分け）
 * ------------------------------------------------------------------ */

/**
 * サーバ時刻で書くフィールド（createdAt / lastPostAt）。
 * ルール serverTimestamped() / rateOk() と整合させるため必ずこれを使う。
 */
export function serverTime(): FieldValue {
  return serverTimestamp();
}

/** ユーザー指定の Date を固定値で書く（startDate / endDate / expiresAt）。 */
export function dateToTs(d: Date): Timestamp {
  return Timestamp.fromDate(d);
}

/* ------------------------------------------------------------------ *
 * doc → domain
 * ------------------------------------------------------------------ */

function memberFromData(data: Record<string, unknown>): Member {
  const color = data.color as AssignedColor | undefined;
  const member: Member = {
    displayName: (data.displayName as string) ?? '',
    postCount: typeof data.postCount === 'number' ? data.postCount : 0,
  };
  if (typeof data.photoURL === 'string') member.photoURL = data.photoURL;
  if (color) member.color = color;
  // 欠落 lastPostAt は undefined のまま（types.ts:21 optional）。
  const lastPostAt = tsToDate(data.lastPostAt);
  if (lastPostAt) member.lastPostAt = lastPostAt;
  return member;
}

/** trips/{tripId} → Trip。存在しなければ null。 */
export function tripFromDoc(snap: DocumentSnapshot): Trip | null {
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return null;

  const rawMembers = (data.members as Record<string, Record<string, unknown>> | undefined) ?? {};
  const members: Record<string, Member> = {};
  for (const [uid, m] of Object.entries(rawMembers)) {
    members[uid] = memberFromData(m);
  }

  return {
    id: snap.id,
    name: (data.name as string) ?? '',
    startDate: tsToDateRequired(data.startDate),
    endDate: tsToDateRequired(data.endDate),
    hostUserId: (data.hostUserId as string) ?? '',
    status: (data.status as TripStatus) ?? 'planning',
    colorsAssigned: Boolean(data.colorsAssigned),
    memberIds: Array.isArray(data.memberIds) ? (data.memberIds as string[]) : [],
    members,
  };
}

/** trips/{tripId}/posts/{postId} → Post。 */
export function postFromDoc(snap: QueryDocumentSnapshot | DocumentSnapshot): Post {
  const data = (snap.data() as Record<string, unknown>) ?? {};
  return {
    id: snap.id,
    userId: (data.userId as string) ?? '',
    color: data.color as AssignedColor,
    caption: (data.caption as string) ?? '',
    thumbURL: (data.thumbURL as string) ?? '',
    imageURL: (data.imageURL as string) ?? '',
    // createdAt は serverTimestamp で書く。読み戻し未解決の瞬間は new Date() 暫定（onSnapshot 後追い確定）。
    createdAt: tsToDateRequired(data.createdAt),
    slotIndex: typeof data.slotIndex === 'number' ? data.slotIndex : 0,
  };
}

/** inviteCodes/{code} → InviteCode。存在しなければ null。 */
export function inviteFromDoc(snap: DocumentSnapshot): InviteCode | null {
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!data) return null;
  return {
    code: (data.code as string) ?? snap.id,
    tripId: (data.tripId as string) ?? '',
    expiresAt: tsToDateRequired(data.expiresAt),
  };
}

/* ------------------------------------------------------------------ *
 * domain → doc（書き込みデータ生成）
 * ------------------------------------------------------------------ */

/** Member を doc 形へ。lastPostAt は呼び出し側で serverTime() を別途載せる（R-B）。 */
function memberToData(member: Member): Record<string, unknown> {
  const out: Record<string, unknown> = {
    displayName: member.displayName,
    postCount: member.postCount ?? 0,
  };
  if (member.photoURL !== undefined) out.photoURL = member.photoURL;
  if (member.color !== undefined) out.color = member.color;
  return out;
}

/**
 * Trip を doc 形へ（createTrip / assignColors / joinTrip の書き戻し用）。
 * startDate / endDate は Timestamp.fromDate（ユーザー指定の固定値・R-B）。
 * members 内の lastPostAt はここでは書かない（昇格時に serverTime() で別途載せる）。
 */
export function tripToData(trip: Trip): Record<string, unknown> {
  const members: Record<string, unknown> = {};
  for (const [uid, m] of Object.entries(trip.members)) {
    members[uid] = memberToData(m);
  }
  return {
    name: trip.name,
    startDate: dateToTs(trip.startDate),
    endDate: dateToTs(trip.endDate),
    hostUserId: trip.hostUserId,
    status: trip.status,
    colorsAssigned: trip.colorsAssigned,
    memberIds: trip.memberIds,
    members,
  };
}

/** InviteCode を doc 形へ。expiresAt は Timestamp.fromDate（固定値・R-B）。 */
export function inviteToData(invite: InviteCode): Record<string, unknown> {
  return {
    code: invite.code,
    tripId: invite.tripId,
    expiresAt: dateToTs(invite.expiresAt),
  };
}

/**
 * Post を doc 形へ（promotePhoto の書き込み用）。
 * createdAt は serverTimestamp()（R-B・ルール整合）。読み戻しは postFromDoc が new Date() 暫定補完。
 */
export function postToData(post: Omit<Post, 'id' | 'createdAt'>): Record<string, unknown> {
  return {
    userId: post.userId,
    color: post.color,
    caption: post.caption,
    thumbURL: post.thumbURL,
    imageURL: post.imageURL,
    slotIndex: post.slotIndex,
    // R-B: createdAt はサーバ時刻。Timestamp.fromDate(new Date()) は使わない。
    createdAt: serverTime(),
  };
}

/** リアクション非正規化集計の型（post doc 側に持つ reactionCounts）。 */
export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;
