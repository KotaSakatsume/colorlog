import { describe, expect, it } from '@jest/globals';

import { COLOR_POOL } from '@/domain/colors';
import type { Post, ReactionSummary, Trip } from '@/domain/types';
import type { AuthUser } from '@/repositories/types';

import { MockBackend } from './mock-backend';
import { MockPostRepository } from './mock-post-repository';

const BLUE = COLOR_POOL[0];

function makeUser(uid: string): AuthUser {
  return { uid, displayName: uid, isAnonymous: false };
}

/** 期間内（差し替え可能）の配布済みトリップを作る。 */
function makeTrip(uid: string): Trip {
  return {
    id: 'trip1',
    name: 'テスト旅行',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2999-12-31'),
    hostUserId: uid,
    status: 'active',
    colorsAssigned: true,
    memberIds: [uid],
    members: { [uid]: { displayName: uid, color: BLUE, postCount: 1 } },
  };
}

function makePost(id: string, userId: string, slotIndex: number): Post {
  return {
    id,
    userId,
    color: BLUE,
    caption: 'c',
    thumbURL: 'thumb',
    imageURL: 'image',
    createdAt: new Date('2026-06-02'),
    slotIndex,
  };
}

/** backend + repo + 1トリップ1ポスト の最小セットを用意する。 */
function setup() {
  const db = new MockBackend();
  const owner = makeUser('owner');
  db.seedTrip(makeTrip(owner.uid));
  db.seedPosts('trip1', [makePost('post1', owner.uid, 0)]);
  const repo = new MockPostRepository(db);
  return { db, repo, owner };
}

describe('MockPostRepository toggleReaction', () => {
  it('① 初回トグルで count+1・mine がセットされる', async () => {
    const { repo } = setup();
    const summary = await repo.toggleReaction({
      tripId: 'trip1',
      postId: 'post1',
      user: makeUser('alice'),
      emoji: '❤️',
    });
    expect(summary.counts['❤️']).toBe(1);
    expect(summary.mine).toBe('❤️');
  });

  it('② 同じ絵文字を再トグルすると解除される（count-1・mine=null）', async () => {
    const { repo } = setup();
    const alice = makeUser('alice');
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: alice, emoji: '❤️' });
    const summary = await repo.toggleReaction({
      tripId: 'trip1',
      postId: 'post1',
      user: alice,
      emoji: '❤️',
    });
    expect(summary.counts['❤️'] ?? 0).toBe(0);
    expect(summary.mine).toBeNull();
  });

  it('③ 別の絵文字で付け替え（旧 -1, 新 +1、合計は不変）', async () => {
    const { repo } = setup();
    const alice = makeUser('alice');
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: alice, emoji: '❤️' });
    const summary = await repo.toggleReaction({
      tripId: 'trip1',
      postId: 'post1',
      user: alice,
      emoji: '🔥',
    });
    expect(summary.counts['❤️'] ?? 0).toBe(0);
    expect(summary.counts['🔥']).toBe(1);
    expect(summary.mine).toBe('🔥');
  });

  it('④ 別ユーザー視点で mine が独立して解決される', async () => {
    const { db, repo } = setup();
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('alice'), emoji: '❤️' });

    const fromAlice = db.summarizeReactions('trip1', 'alice').get('post1');
    const fromBob = db.summarizeReactions('trip1', 'bob').get('post1');
    expect(fromAlice?.mine).toBe('❤️');
    expect(fromBob?.mine).toBeNull();
    // count は viewer に依らず同じ。
    expect(fromAlice?.counts['❤️']).toBe(1);
    expect(fromBob?.counts['❤️']).toBe(1);
  });

  it('⑤ 購読は登録直後に初期集計を即時に流す', async () => {
    const { db, repo } = setup();
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('alice'), emoji: '😍' });

    const received: Map<string, ReactionSummary>[] = [];
    const unsub = repo.subscribeToTripReactions('trip1', 'alice', (m) => received.push(m));
    expect(received).toHaveLength(1); // 即時 emit
    expect(received[0].get('post1')?.counts['😍']).toBe(1);
    expect(received[0].get('post1')?.mine).toBe('😍');
    unsub();
  });

  it('⑤b トグルで購読者へ再通知される', async () => {
    const { repo } = setup();
    const received: Map<string, ReactionSummary>[] = [];
    const unsub = repo.subscribeToTripReactions('trip1', 'alice', (m) => received.push(m));
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('alice'), emoji: '👏' });
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received[received.length - 1].get('post1')?.counts['👏']).toBe(1);
    unsub();
  });

  it('⑤c Unsubscribe 後はトグルしても通知されない（解除の回帰）', async () => {
    const { repo } = setup();
    const received: Map<string, ReactionSummary>[] = [];
    const unsub = repo.subscribeToTripReactions('trip1', 'alice', (m) => received.push(m));
    expect(received).toHaveLength(1); // 即時 emit の1回のみ

    unsub();

    // 解除後のトグルは購読者へ届かない。
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('alice'), emoji: '❤️' });
    expect(received).toHaveLength(1);
  });

  it('⑧ 複数ユーザーが同一 post に異なる絵文字を押すと counts が両方加算される', async () => {
    const { db, repo } = setup();
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('alice'), emoji: '❤️' });
    await repo.toggleReaction({ tripId: 'trip1', postId: 'post1', user: makeUser('bob'), emoji: '🔥' });

    const summary = db.summarizeReactions('trip1', 'alice').get('post1');
    expect(summary?.counts['❤️']).toBe(1);
    expect(summary?.counts['🔥']).toBe(1);
    // viewer(alice) 視点では自分の押した ❤️ が mine。
    expect(summary?.mine).toBe('❤️');
  });

  it('⑦ 不正な絵文字はランタイムで弾く', async () => {
    const { repo } = setup();
    await expect(
      repo.toggleReaction({
        tripId: 'trip1',
        postId: 'post1',
        user: makeUser('alice'),
        // 確定集合外。型を迂回してランタイムガードを検証する。
        emoji: '🙈' as never,
      }),
    ).rejects.toThrow('不正なリアクションです');
  });
});

describe('MockBackend リアクションの孤児破棄（リスク3）', () => {
  it('⑥a deleteTrip で配下 post のリアクションも破棄される', () => {
    const { db } = setup();
    db.toggleReaction('trip1', 'post1', 'alice', '❤️');
    expect(db.summarizeReactions('trip1', 'alice').get('post1')?.counts['❤️']).toBe(1);

    db.deleteTrip('trip1');

    // トリップごと消えたので集計対象も無い。再 seed しても古いリアクションは混入しない。
    db.seedTrip(makeTrip('owner'));
    db.seedPosts('trip1', [makePost('post1', 'owner', 0)]);
    const summary = db.summarizeReactions('trip1', 'alice').get('post1');
    expect(summary?.counts['❤️'] ?? 0).toBe(0);
    expect(summary?.mine).toBeNull();
  });

  it('⑥b promotePhoto の差し替えで旧 postId のリアクションが破棄される', async () => {
    const { db, repo } = setup();
    // 旧 post1 にリアクションを付けておく。
    db.toggleReaction('trip1', 'post1', 'alice', '🔥');
    expect(db.summarizeReactions('trip1', 'alice').get('post1')?.counts['🔥']).toBe(1);

    // 同じスロット(0)へ差し替え → 新 id の post に置換される。
    await repo.promotePhoto({
      tripId: 'trip1',
      user: makeUser('owner'),
      slotIndex: 0,
      localImage: { uri: 'new-uri' },
      caption: '差し替え',
    });

    const posts = db.getPosts('trip1');
    expect(posts).toHaveLength(1);
    const newPostId = posts[0].id;
    expect(newPostId).not.toBe('post1'); // id が変わっている

    // 旧 postId のリアクションは破棄され、新 post には引き継がれない。
    const summary = db.summarizeReactions('trip1', 'alice').get(newPostId);
    expect(summary?.counts['🔥'] ?? 0).toBe(0);
    expect(summary?.mine).toBeNull();
  });
});
