/**
 * FirebasePostRepository（PostRepository 実装・§9-5 / 設計 §3-3）。
 *
 * - subscribeToTripPosts: posts を orderBy(createdAt,'desc') + limit(50) で購読（§13 コスト規律）。
 * - promotePhoto: runTransaction で trip 検証 → slot 差し替え/追加判定 → postCount<=9 強制 →
 *   post doc 書き込み + members[uid].postCount/lastPostAt 更新を同一 tx（R4）。
 *   画像は注入 ImageProcessor で 2サイズに整え、注入 PhotoUploader（FirebasePhotoUploader）で
 *   tx 外アップロード → 確定 URL を tx 内で書く（§5-7 順序・§9-7 継ぎ目）。
 * - reactions: reactions/{uid} に {emoji} を1人1ドキュメント、post 側に非正規化 reactionCounts。
 *   toggleReaction は runTransaction で increment + set/delete を原子的に（§13 / R4）。
 *
 * 【R-B 厳守】createdAt / members[uid].lastPostAt は serverTimestamp()（adapters.postToData /
 * 本ファイルの serverTime()）。Timestamp.fromDate は使わない（ルール serverTimestamped() で reject）。
 *
 * modular API 統一（R-A）。native は firebase 隔離内に閉じる。
 */

import {
  collection,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
} from '@react-native-firebase/firestore';

import { BEST_NINE_SLOTS, type Post, type ReactionSummary } from '@/domain/types';
import { isTripOver } from '@/domain/format';
import type {
  ImageProcessor,
  PostRepository,
  PromotePhotoInput,
  ToggleReactionInput,
  Unsubscribe,
} from '@/repositories/types';

import {
  postFromDoc,
  postToData,
  serverTime,
  tripFromDoc,
  type ReactionCounts,
} from './adapters';
import { db } from './firebase-app';
import type { PhotoUploader } from './photo-uploader';

/** posts フィードの購読上限（§13 コスト規律）。 */
const POSTS_LIMIT = 50;

export class FirebasePostRepository implements PostRepository {
  constructor(
    private readonly uploader: PhotoUploader,
    private readonly imageProcessor: ImageProcessor,
  ) {}

  subscribeToTripPosts(tripId: string, listener: (posts: Post[]) => void): Unsubscribe {
    const q = query(
      collection(db(), 'trips', tripId, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(POSTS_LIMIT),
    );
    return onSnapshot(q, (snap) => {
      const posts: Post[] = [];
      snap.forEach((d) => posts.push(postFromDoc(d)));
      listener(posts);
    });
  }

  subscribeToTripReactions(
    tripId: string,
    userId: string,
    listener: (byPost: Map<string, ReactionSummary>) => void,
  ): Unsubscribe {
    // posts 購読から非正規化 reactionCounts を読み、自分の reactions/{uid} で mine を補完する。
    // 自分のリアクションは collectionGroup を使わず、posts 購読のたびに自 doc を引いて解決。
    //
    // TODO(ゲートC): 現状は posts 件数ぶん getDoc を毎回走らせる（§13 コスト規律）。
    //   post 単位の reactions/{userId} を onSnapshot 分割購読する／collectionGroup で1購読に寄せる等の
    //   読み取り最小化は実機での挙動・コスト計測（ゲートC）が要るため本Issueでは深追いしない。
    const q = query(
      collection(db(), 'trips', tripId, 'posts'),
      orderBy('createdAt', 'desc'),
      limit(POSTS_LIMIT),
    );
    // 前回解決した mine をスナップショット跨ぎで保持し、UI のちらつき（mine 未解決の一瞬 null）を抑える。
    const mineCache = new Map<string, ReactionSummary['mine']>();
    return onSnapshot(q, (snap) => {
      const byPost = new Map<string, ReactionSummary>();
      const postIds: string[] = [];
      snap.forEach((d) => {
        postIds.push(d.id);
        const data = d.data() as Record<string, unknown>;
        const counts = (data.reactionCounts as ReactionCounts | undefined) ?? {};
        // counts は最新・mine は前回値で暫定埋め（後追い getDoc 解決後に確定）。
        byPost.set(d.id, { postId: d.id, counts, mine: mineCache.get(d.id) ?? null });
      });
      // 自分の mine を後追いで解決（各 post の reactions/{userId}）。
      // 二重通知を避けるため、即時通知はせず mine 解決後の1回だけ listener へ流す
      //（counts は前回 mine と一緒に確定値で届く・should #6）。
      void Promise.all(
        postIds.map(async (postId) => {
          const mineSnap = await getDoc(
            doc(db(), 'trips', tripId, 'posts', postId, 'reactions', userId),
          );
          const emoji =
            mineSnap.exists() && typeof (mineSnap.data() as Record<string, unknown>).emoji === 'string'
              ? ((mineSnap.data() as Record<string, unknown>).emoji as ReactionSummary['mine'])
              : null;
          mineCache.set(postId, emoji);
          const summary = byPost.get(postId);
          if (summary) {
            byPost.set(postId, { ...summary, mine: emoji });
          }
        }),
      ).then(() => listener(byPost));
    });
  }

  async toggleReaction(input: ToggleReactionInput): Promise<ReactionSummary> {
    const { tripId, postId, user, emoji } = input;
    const postRef = doc(db(), 'trips', tripId, 'posts', postId);
    const reactionRef = doc(db(), 'trips', tripId, 'posts', postId, 'reactions', user.uid);

    return runTransaction(db(), async (tx) => {
      const postSnap = await tx.get(postRef);
      const reactionSnap = await tx.get(reactionRef);
      if (!postSnap.exists()) {
        throw new Error('投稿が見つかりません');
      }

      const postData = postSnap.data() as Record<string, unknown>;
      const counts: ReactionCounts = { ...((postData.reactionCounts as ReactionCounts) ?? {}) };
      const prevEmoji = reactionSnap.exists()
        ? ((reactionSnap.data() as Record<string, unknown>).emoji as
            | ReactionSummary['mine']
            | undefined)
        : undefined;

      let mine: ReactionSummary['mine'] = null;
      const countUpdate: Record<string, ReturnType<typeof increment>> = {};

      if (prevEmoji === emoji) {
        // 同絵文字 → 解除（-1, doc 削除）。
        countUpdate[`reactionCounts.${emoji}`] = increment(-1);
        tx.delete(reactionRef);
        counts[emoji] = Math.max(0, (counts[emoji] ?? 0) - 1);
        mine = null;
      } else {
        // 別絵文字 → 付け替え（旧 -1 / 新 +1）。未押下 → 押す（新 +1）。
        if (prevEmoji) {
          countUpdate[`reactionCounts.${prevEmoji}`] = increment(-1);
          counts[prevEmoji] = Math.max(0, (counts[prevEmoji] ?? 0) - 1);
        }
        countUpdate[`reactionCounts.${emoji}`] = increment(1);
        counts[emoji] = (counts[emoji] ?? 0) + 1;
        tx.set(reactionRef, { emoji });
        mine = emoji;
      }

      tx.update(postRef, countUpdate);
      return { postId, counts, mine } satisfies ReactionSummary;
    });
  }

  async promotePhoto(input: PromotePhotoInput): Promise<Post> {
    const { tripId, user, slotIndex, localImage, caption } = input;

    if (slotIndex < 0 || slotIndex >= BEST_NINE_SLOTS) {
      throw new Error(`slotIndex は 0〜${BEST_NINE_SLOTS - 1} の範囲で指定してください`);
    }
    // caption はルール（firestore.rules posts create: caption.size() <= 200）と一致させ、
    // 書き込み前にここで弾く（超過したまま書くと実機で無言 reject されるため・should #5）。
    const trimmedCaption = caption.trim();
    if (trimmedCaption.length > 200) {
      throw new Error('キャプションは200字以内にしてください');
    }

    // slot を決定的 post ID（${uid}_${slotIndex}）に寄せる。同 user・同 slot は必ず同一 doc に
    // 落ちるため、非トランザクショナルな getDocs(query) を使わず tx.get 1回で差し替え判定できる
    // （並行昇格でも両者が同 doc を get → 一方が後勝ちになり postCount の二重加算が起きない・should #4）。
    // postId は Storage パス（trips/{tripId}/{uid}/{postId}/main.jpg）にも使うため、ここで先に確定する。
    const postId = `${user.uid}_${slotIndex}`;

    // §5-7 順序: 画像を 2サイズに整え → tx 外で Storage へアップロード → URL 確定 → tx で書き込む。
    // tx 内では Storage に一切触れない（tx は Firestore read→write のみ・R4）。
    const processed = await this.imageProcessor.process(localImage);
    // tx 失敗（旅行終了 / postCount=9 等）で Storage にファイルが残り孤児になりうるが、postId・パスとも
    // 決定的なので同スロット再昇格時に同一パスを上書き＝次回の正常昇格で自然回収される。tx 失敗時の即時
    // Storage 削除（ロールバック）は本Issueでは行わない（定期クリーンは §13.5 別Issue）。
    const { imageURL, thumbURL } = await this.uploader.upload(processed, {
      tripId,
      uid: user.uid,
      postId,
    });

    const tripRef = doc(db(), 'trips', tripId);
    const postRef = doc(db(), 'trips', tripId, 'posts', postId);

    const created = await runTransaction(db(), async (tx) => {
      // tx.get は全て write より前に実行（read→write 順守・R4）。
      const tripSnap = await tx.get(tripRef);
      const existingPostSnap = await tx.get(postRef);
      const trip = tripFromDoc(tripSnap);
      if (!trip) {
        throw new Error('トリップが見つかりません');
      }
      if (isTripOver(trip)) {
        throw new Error('旅行期間が終了したため、追加できません');
      }
      const member = trip.members[user.uid];
      if (!member?.color) {
        throw new Error('色が未配布のため公開できません');
      }

      const isReplace = existingPostSnap.exists();
      const currentPostCount = member.postCount ?? 0;

      if (!isReplace) {
        // 新規: postCount<9 を強制（ルール §7 と整合・R4）。
        if (currentPostCount >= BEST_NINE_SLOTS) {
          throw new Error('ベスト9が埋まっています。差し替えるスロットを選んでください');
        }
      }
      // 差し替えは同一 postId に上書き（postCount 不変＝增分なし）。
      // 旧 post の reactions サブコレクション掃除は tx 内列挙不可のためここでは行わない（ゲートCで方針確定）。

      // R-B: createdAt は serverTimestamp（postToData が serverTime() を載せる）。
      tx.set(
        postRef,
        postToData({
          userId: user.uid,
          color: member.color,
          caption: trimmedCaption,
          thumbURL,
          imageURL,
          slotIndex,
        }),
      );

      // 親 trip の members[uid].postCount/lastPostAt を同一 tx で更新。
      // 新規時のみ increment(1) で原子加算（並行昇格でのカウント競合を避ける・should #4）。差し替えは据え置き。
      const tripUpdate: Record<string, unknown> = {
        [`members.${user.uid}.lastPostAt`]: serverTime(),
      };
      if (!isReplace) {
        tripUpdate[`members.${user.uid}.postCount`] = increment(1);
      }
      tx.update(tripRef, tripUpdate);

      // ドメインへ返す Post。createdAt は serverTimestamp 未解決なので new Date() 暫定補完
      //（onSnapshot で後追い確定値が流れる・R-B/R3）。
      const post: Post = {
        id: postId,
        userId: user.uid,
        color: member.color,
        caption: trimmedCaption,
        thumbURL,
        imageURL,
        createdAt: new Date(),
        slotIndex,
      };
      return post;
    });

    return created;
  }
}
