import { BEST_NINE_SLOTS, type Post, type ReactionSummary, type Trip } from '@/domain/types';
import { isTripOver } from '@/domain/format';
import { generateId } from '@/domain/id';
import type {
  PostRepository,
  PromotePhotoInput,
  ToggleAlbumClapInput,
  ToggleReactionInput,
  Unsubscribe,
} from '@/repositories/types';

import type { MockBackend } from './mock-backend';

export class MockPostRepository implements PostRepository {
  constructor(private readonly db: MockBackend) {}

  subscribeToTripPosts(tripId: string, listener: (posts: Post[]) => void): Unsubscribe {
    return this.db.subscribePosts(tripId, listener);
  }

  subscribeToTripReactions(
    tripId: string,
    userId: string,
    listener: (byPost: Map<string, ReactionSummary>) => void,
  ): Unsubscribe {
    return this.db.subscribeReactions(tripId, userId, listener);
  }

  async toggleReaction(input: ToggleReactionInput): Promise<ReactionSummary> {
    const { tripId, postId, user, emoji } = input;
    this.db.toggleReaction(tripId, postId, user.uid, emoji);
    // 更新後の当該 post の集計を viewer 視点で返す。
    const summary = this.db.summarizeReactions(tripId, user.uid).get(postId);
    return summary ?? { postId, counts: {}, mine: null };
  }

  subscribeToAlbumClaps(
    tripId: string,
    listener: (byOwner: Map<string, string[]>) => void,
  ): Unsubscribe {
    return this.db.subscribeAlbumClaps(tripId, listener);
  }

  async toggleAlbumClap(input: ToggleAlbumClapInput): Promise<void> {
    this.db.toggleAlbumClap(input.tripId, input.ownerUid, input.user.uid);
  }

  async promotePhoto(input: PromotePhotoInput): Promise<Post> {
    const { tripId, user, slotIndex, localImage, caption } = input;

    if (slotIndex < 0 || slotIndex >= BEST_NINE_SLOTS) {
      throw new Error(`slotIndex は 0〜${BEST_NINE_SLOTS - 1} の範囲で指定してください`);
    }

    const trip = this.db.getTrip(tripId);
    if (!trip) {
      throw new Error('トリップが見つかりません');
    }
    // 旅行期間が終了したトリップには追加・差し替えできない。
    if (isTripOver(trip)) {
      throw new Error('旅行期間が終了したため、追加できません');
    }
    const member = trip.members[user.uid];
    if (!member?.color) {
      throw new Error('色が未配布のため公開できません');
    }

    const posts = this.db.getPosts(tripId);
    const existingIndex = posts.findIndex(
      (p) => p.userId === user.uid && p.slotIndex === slotIndex,
    );

    const newPost: Post = {
      id: generateId('post'),
      userId: user.uid,
      color: member.color,
      caption: caption.trim(),
      // この段階では2サイズ生成・Storage アップロードは未実装なので端末内 URI をそのまま使う。
      thumbURL: localImage.uri,
      imageURL: localImage.uri,
      createdAt: new Date(),
      slotIndex,
    };

    let nextPosts: Post[];
    let nextPostCount = member.postCount ?? 0;

    if (existingIndex >= 0) {
      // 差し替え: 旧 Post を新 Post に置換（実画像の削除はここでは概念上のみ）。枚数は変わらない。
      // 差し替えは別写真なのでリアクションは引き継がない。旧 postId の集計を破棄して孤児を防ぐ。
      this.db.discardReactions(posts[existingIndex].id);
      nextPosts = posts.map((p, i) => (i === existingIndex ? newPost : p));
    } else {
      // 空き枠への追加: postCount を +1。9枚を超えないことを不変条件として守る。
      if (nextPostCount >= BEST_NINE_SLOTS) {
        throw new Error('ベスト9が埋まっています。差し替えるスロットを選んでください');
      }
      nextPosts = [...posts, newPost];
      nextPostCount += 1;
    }

    // メンバーの postCount / lastPostAt を更新（Firestore 実装ではこの更新と post 書き込みを
    // 単一トランザクションで行う。Mock では単一スレッドなので原子的）。
    const updatedTrip: Trip = {
      ...trip,
      members: {
        ...trip.members,
        [user.uid]: { ...member, postCount: nextPostCount, lastPostAt: newPost.createdAt },
      },
    };

    this.db.putPosts(tripId, nextPosts);
    this.db.putTrip(updatedTrip);
    return newPost;
  }
}
