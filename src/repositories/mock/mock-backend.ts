/**
 * Mock のインメモリ・バックエンド。
 *
 * Firestore に相当する「単一の真実の置き場」。trips / posts / inviteCodes を保持し、
 * リスナー（= onSnapshot 相当）へ変更を流す。MockTripRepository と MockPostRepository が
 * この同じインスタンスを共有することで、配布や昇格の整合がリアルタイムに画面へ伝わる。
 *
 * 単一スレッドの JS なので、各 mutation メソッドはそれ自体が原子的（= トランザクション相当）。
 */

import { REACTION_EMOJIS } from '@/domain/types';
import type { InviteCode, Post, ReactionEmoji, ReactionSummary, Trip } from '@/domain/types';
import type { Unsubscribe } from '@/repositories/types';

type TripListener = (trip: Trip | null) => void;
type UserTripsListener = (trips: Trip[]) => void;
type PostsListener = (posts: Post[]) => void;
type ReactionsListener = (byPost: Map<string, ReactionSummary>) => void;
/**
 * リアクション再通知のトリガ。mine が viewer ごとに異なるため、ストアには viewerUid を
 * 束ねた引数なしトリガを登録し、発火時に各自が再集計する（emit 側は集計を持たない）。
 */
type ReactionsTrigger = () => void;
/** アルバム拍手のリスナー（ownerUid → 押した人の uid 配列）。 */
type AlbumClapsListener = (byOwner: Map<string, string[]>) => void;

export class MockBackend {
  private readonly trips = new Map<string, Trip>();
  private readonly postsByTrip = new Map<string, Post[]>();
  private readonly inviteCodes = new Map<string, InviteCode>();
  // postId -> (uid -> ReactionEmoji)。ユーザー1人1絵文字（Firestore の reactions/{uid} 相当）。
  private readonly reactionsByPost = new Map<string, Map<string, ReactionEmoji>>();
  // tripId -> (ownerUid -> 押した人の uid 集合)。アルバム（ベスト9一式）への拍手。
  private readonly albumClapsByTrip = new Map<string, Map<string, Set<string>>>();

  private readonly tripListeners = new Map<string, Set<TripListener>>();
  private readonly userTripsListeners = new Map<string, Set<UserTripsListener>>();
  private readonly postsListeners = new Map<string, Set<PostsListener>>();
  private readonly reactionListeners = new Map<string, Set<ReactionsTrigger>>();
  private readonly albumClapListeners = new Map<string, Set<AlbumClapsListener>>();

  // --- 初期データ投入（seed 用） -----------------------------------------

  seedTrip(trip: Trip): void {
    this.trips.set(trip.id, trip);
  }

  seedInviteCode(invite: InviteCode): void {
    this.inviteCodes.set(invite.code, invite);
  }

  seedPosts(tripId: string, posts: Post[]): void {
    this.postsByTrip.set(tripId, [...posts]);
  }

  /** ある post に初期リアクションを投入する（uid -> emoji）。手動確認/テスト用。 */
  seedReactions(postId: string, byUser: Map<string, ReactionEmoji>): void {
    this.reactionsByPost.set(postId, new Map(byUser));
  }

  // --- 読み取り -----------------------------------------------------------

  getTrip(tripId: string): Trip | null {
    return this.trips.get(tripId) ?? null;
  }

  getInviteCode(code: string): InviteCode | null {
    return this.inviteCodes.get(code) ?? null;
  }

  /** トリップに紐づく招待コードを返す（有効なものを優先）。無ければ null。 */
  getInviteCodeForTrip(tripId: string): InviteCode | null {
    const matches = [...this.inviteCodes.values()].filter((c) => c.tripId === tripId);
    const now = Date.now();
    return matches.find((c) => c.expiresAt.getTime() >= now) ?? matches[0] ?? null;
  }

  getPosts(tripId: string): Post[] {
    return this.postsByTrip.get(tripId) ?? [];
  }

  /**
   * トリップ内の全 post のリアクション集計を viewer 視点で作る。
   * counts は絵文字ごとの押下数、mine は viewer 自身が押している絵文字（無ければ null）。
   */
  summarizeReactions(tripId: string, viewerUid: string): Map<string, ReactionSummary> {
    const byPost = new Map<string, ReactionSummary>();
    for (const post of this.getPosts(tripId)) {
      const byUser = this.reactionsByPost.get(post.id);
      const counts: Partial<Record<ReactionEmoji, number>> = {};
      if (byUser) {
        for (const emoji of byUser.values()) {
          counts[emoji] = (counts[emoji] ?? 0) + 1;
        }
      }
      byPost.set(post.id, {
        postId: post.id,
        counts,
        mine: byUser?.get(viewerUid) ?? null,
      });
    }
    return byPost;
  }

  tripsForUser(userId: string): Trip[] {
    return [...this.trips.values()]
      .filter((trip) => trip.memberIds.includes(userId))
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
  }

  // --- 書き込み（各メソッドが原子的） -------------------------------------

  putTrip(trip: Trip): void {
    this.trips.set(trip.id, trip);
    this.emitTrip(trip.id);
    this.emitAffectedUserTrips(trip);
  }

  putInviteCode(invite: InviteCode): void {
    this.inviteCodes.set(invite.code, invite);
  }

  /** トリップと、それに紐づく投稿・招待コードをまとめて削除する（原子的）。 */
  deleteTrip(tripId: string): void {
    const trip = this.trips.get(tripId);
    if (!trip) return;

    // 投稿を消す前に、各 post のリアクションも破棄する（孤児防止）。
    for (const post of this.getPosts(tripId)) {
      this.reactionsByPost.delete(post.id);
    }

    this.trips.delete(tripId);
    this.postsByTrip.delete(tripId);
    for (const [code, invite] of this.inviteCodes) {
      if (invite.tripId === tripId) this.inviteCodes.delete(code);
    }

    // 購読側へ反映：単一トリップは null、投稿は空、リアクションも空、元メンバーの一覧は再計算。
    this.emitTrip(tripId);
    this.emitPosts(tripId);
    this.emitReactions(tripId);
    this.emitAffectedUserTrips(trip);
  }

  putPosts(tripId: string, posts: Post[]): void {
    this.postsByTrip.set(tripId, posts);
    this.emitPosts(tripId);
  }

  /**
   * リアクションをトグルする（原子的）。
   * 未押下 → 押す / 同絵文字 → 解除 / 別絵文字 → 付け替え。
   * 1人1絵文字なので Map<uid,emoji> の単純な set/delete で集計が一意に決まる。
   */
  toggleReaction(tripId: string, postId: string, uid: string, emoji: ReactionEmoji): void {
    if (!REACTION_EMOJIS.includes(emoji)) {
      throw new Error('不正なリアクションです');
    }
    const byUser = this.reactionsByPost.get(postId) ?? new Map<string, ReactionEmoji>();
    if (byUser.get(uid) === emoji) {
      byUser.delete(uid); // 同じ絵文字をもう一度 → 解除
    } else {
      byUser.set(uid, emoji); // 未押下 or 別絵文字 → 付け替え（旧は上書きで消える）
    }
    this.reactionsByPost.set(postId, byUser);
    this.emitReactions(tripId);
  }

  /** 指定 post のリアクションを丸ごと破棄する（差し替えで postId が変わったときの孤児防止）。 */
  discardReactions(postId: string): void {
    this.reactionsByPost.delete(postId);
  }

  /** トリップ内のアルバム拍手を ownerUid → 押した人の uid 配列で返す。 */
  getAlbumClaps(tripId: string): Map<string, string[]> {
    const byOwner = new Map<string, string[]>();
    for (const [ownerUid, uids] of this.albumClapsByTrip.get(tripId) ?? []) {
      byOwner.set(ownerUid, [...uids]);
    }
    return byOwner;
  }

  /** アルバム拍手をトグルする。未押下 → 押す / 押下済み → 解除（1人1拍手）。 */
  toggleAlbumClap(tripId: string, ownerUid: string, uid: string): void {
    const byOwner = this.albumClapsByTrip.get(tripId) ?? new Map<string, Set<string>>();
    const uids = byOwner.get(ownerUid) ?? new Set<string>();
    if (uids.has(uid)) {
      uids.delete(uid);
    } else {
      uids.add(uid);
    }
    byOwner.set(ownerUid, uids);
    this.albumClapsByTrip.set(tripId, byOwner);
    this.emitAlbumClaps(tripId);
  }

  // --- 購読 ---------------------------------------------------------------

  subscribeTrip(tripId: string, listener: TripListener): Unsubscribe {
    const set = this.tripListeners.get(tripId) ?? new Set();
    set.add(listener);
    this.tripListeners.set(tripId, set);
    listener(this.getTrip(tripId)); // 初期値を即時に流す
    return () => set.delete(listener);
  }

  subscribeUserTrips(userId: string, listener: UserTripsListener): Unsubscribe {
    const set = this.userTripsListeners.get(userId) ?? new Set();
    set.add(listener);
    this.userTripsListeners.set(userId, set);
    listener(this.tripsForUser(userId));
    return () => set.delete(listener);
  }

  subscribePosts(tripId: string, listener: PostsListener): Unsubscribe {
    const set = this.postsListeners.get(tripId) ?? new Set();
    set.add(listener);
    this.postsListeners.set(tripId, set);
    listener(this.getPosts(tripId));
    return () => set.delete(listener);
  }

  /**
   * トリップ内の全 post のリアクション集計を viewer 視点で購読する。
   * mine は viewerUid ごとに異なるため、viewerUid を束ねた wrapper を登録し、
   * emit 時に viewer ごと再集計して流す（posts 購読とは独立の購読源）。
   */
  subscribeReactions(tripId: string, viewerUid: string, listener: ReactionsListener): Unsubscribe {
    // viewerUid を束ねた引数なしトリガを登録する。発火時に自分の視点で再集計して listener へ流す。
    const trigger: ReactionsTrigger = () => listener(this.summarizeReactions(tripId, viewerUid));
    const set = this.reactionListeners.get(tripId) ?? new Set();
    set.add(trigger);
    this.reactionListeners.set(tripId, set);
    listener(this.summarizeReactions(tripId, viewerUid)); // 初期値を即時に流す
    return () => set.delete(trigger);
  }

  /** トリップ内のアルバム拍手を購読する（viewer 非依存の生データなので wrapper 不要）。 */
  subscribeAlbumClaps(tripId: string, listener: AlbumClapsListener): Unsubscribe {
    const set = this.albumClapListeners.get(tripId) ?? new Set();
    set.add(listener);
    this.albumClapListeners.set(tripId, set);
    listener(this.getAlbumClaps(tripId)); // 初期値を即時に流す
    return () => set.delete(listener);
  }

  // --- 通知 ---------------------------------------------------------------

  private emitTrip(tripId: string): void {
    const trip = this.getTrip(tripId);
    this.tripListeners.get(tripId)?.forEach((fn) => fn(trip));
  }

  private emitPosts(tripId: string): void {
    const posts = this.getPosts(tripId);
    this.postsListeners.get(tripId)?.forEach((fn) => fn(posts));
  }

  /**
   * リアクション集計の再通知を発火する。各トリガが自身の viewerUid で再集計するため、
   * ここでは引数なしで呼ぶだけでよい（viewer ごと再集計・解除の挙動は subscribeReactions 側）。
   */
  private emitReactions(tripId: string): void {
    this.reactionListeners.get(tripId)?.forEach((trigger) => trigger());
  }

  private emitAlbumClaps(tripId: string): void {
    const byOwner = this.getAlbumClaps(tripId);
    this.albumClapListeners.get(tripId)?.forEach((fn) => fn(byOwner));
  }

  /** あるトリップの全メンバーの「自分のトリップ一覧」リスナーへ再通知する。 */
  private emitAffectedUserTrips(trip: Trip): void {
    for (const uid of trip.memberIds) {
      this.userTripsListeners.get(uid)?.forEach((fn) => fn(this.tripsForUser(uid)));
    }
  }
}
