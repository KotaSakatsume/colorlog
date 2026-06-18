/**
 * Mock 用のシードデータ。
 * 配布済み / 未配布 / 終了済み の3トリップを用意し、各画面がリッチに見えるようにする。
 * 画像は picsum.photos のシード URL（開発時はオンライン前提）。
 */

import { COLOR_POOL } from '@/domain/colors';
import type { Post, ReactionEmoji, Trip } from '@/domain/types';
import type { AssignedColor } from '@/domain/colors';

import { MOCK_CURRENT_USER } from './mock-auth-service';
import type { MockBackend } from './mock-backend';

const ME = MOCK_CURRENT_USER.uid;

const color = (name: string): AssignedColor => {
  const found = COLOR_POOL.find((c) => c.name === name);
  if (!found) throw new Error(`seed: 未知の色 ${name}`);
  return found;
};

function img(seed: string): { thumbURL: string; imageURL: string } {
  return {
    thumbURL: `https://picsum.photos/seed/${seed}/400/400`,
    imageURL: `https://picsum.photos/seed/${seed}/1200/1200`,
  };
}

/** userId の色で count 枚（slotIndex 0..count-1）の投稿を作る。 */
function makePosts(
  tripId: string,
  userId: string,
  c: AssignedColor,
  count: number,
  captions: string[],
): Post[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${tripId}_${userId}_${i}`,
    userId,
    color: c,
    caption: captions[i % captions.length],
    ...img(`${tripId}-${userId}-${i}`),
    createdAt: new Date(2026, 5, 2 + i, 9 + i),
    slotIndex: i,
  }));
}

const CAPTIONS = [
  'いい色みつけた',
  '海の色',
  '空がきれい',
  '思わずパチリ',
  '完璧な一枚',
  '光がよかった',
  'お気に入り',
  '今日のベスト',
  '偶然の出会い',
];

export function seedMockData(db: MockBackend): void {
  // --- トリップ1: 配布済み・開催中（メイン動線の確認用） --------------------
  const trip1: Trip = {
    id: 'trip-okinawa',
    name: 'おきなわ2026',
    startDate: new Date(2026, 5, 1),
    endDate: new Date(2026, 5, 5),
    hostUserId: ME,
    status: 'active',
    colorsAssigned: true,
    memberIds: [ME, 'yuki', 'ren', 'sora'],
    members: {
      [ME]: { displayName: 'あなた', color: color('あお'), postCount: 5 },
      yuki: { displayName: 'ゆき', color: color('あか'), postCount: 9 },
      ren: { displayName: 'れん', color: color('みどり'), postCount: 3 },
      sora: { displayName: 'そら', color: color('きいろ'), postCount: 6 },
    },
  };
  db.seedTrip(trip1);
  db.seedPosts(trip1.id, [
    ...makePosts(trip1.id, ME, color('あお'), 5, CAPTIONS),
    ...makePosts(trip1.id, 'yuki', color('あか'), 9, CAPTIONS),
    ...makePosts(trip1.id, 'ren', color('みどり'), 3, CAPTIONS),
    ...makePosts(trip1.id, 'sora', color('きいろ'), 6, CAPTIONS),
  ]);
  // 既存メンバーが付けた初期リアクション（UI を賑やかに・手動確認用）。postId は makePosts の決定的 id。
  db.seedReactions(
    `${trip1.id}_yuki_0`,
    new Map<string, ReactionEmoji>([
      [ME, '❤️'],
      ['ren', '🔥'],
    ]),
  );
  db.seedReactions(`${trip1.id}_yuki_1`, new Map<string, ReactionEmoji>([['sora', '😍']]));
  db.seedReactions(`${trip1.id}_${ME}_0`, new Map<string, ReactionEmoji>([['yuki', '👏']]));

  // --- トリップ2: 未配布・計画中（色配布ボタンの確認用。自分がホスト） --------
  const trip2: Trip = {
    id: 'trip-hakone',
    name: 'はこね温泉旅行',
    startDate: new Date(2026, 6, 12),
    endDate: new Date(2026, 6, 14),
    hostUserId: ME,
    status: 'planning',
    colorsAssigned: false,
    memberIds: [ME, 'aoi'],
    members: {
      [ME]: { displayName: 'あなた', postCount: 0 },
      aoi: { displayName: 'あおい', postCount: 0 },
    },
  };
  db.seedTrip(trip2);
  db.seedInviteCode({
    code: '111111',
    tripId: trip2.id,
    expiresAt: new Date(2026, 11, 31),
  });

  // --- トリップ3: 終了済み（アルバム＝思い出の確認用） ------------------------
  const trip3: Trip = {
    id: 'trip-kyoto',
    name: 'きょうと紅葉めぐり',
    startDate: new Date(2025, 10, 20),
    endDate: new Date(2025, 10, 23),
    hostUserId: 'haru',
    status: 'finished',
    colorsAssigned: true,
    memberIds: [ME, 'haru', 'nao'],
    members: {
      [ME]: { displayName: 'あなた', color: color('もも'), postCount: 9 },
      haru: { displayName: 'はる', color: color('あか'), postCount: 9 },
      nao: { displayName: 'なお', color: color('きいろ'), postCount: 8 },
    },
  };
  db.seedTrip(trip3);
  db.seedPosts(trip3.id, [
    ...makePosts(trip3.id, ME, color('もも'), 9, CAPTIONS),
    ...makePosts(trip3.id, 'haru', color('あか'), 9, CAPTIONS),
    ...makePosts(trip3.id, 'nao', color('きいろ'), 8, CAPTIONS),
  ]);

  // 参加画面の動作確認用に、配布済みトリップへ途中参加できるコードも用意する。
  db.seedInviteCode({
    code: '222222',
    tripId: trip1.id,
    expiresAt: new Date(2026, 11, 31),
  });

  // --- トリップ4: 自分が未参加・開催中（コード入力→新規参加のテスト用） -----------
  // ME を memberIds に含めないので、コード 123456 で本当に新規参加できる。
  // 配布済み(active)なので参加時に残り色が1色付与され、すぐベスト9に追加して試せる。
  const trip4: Trip = {
    id: 'trip-sapporo',
    name: 'さっぽろ食べ歩き',
    startDate: new Date(2026, 5, 16),
    endDate: new Date(2026, 5, 30),
    hostUserId: 'mako',
    status: 'active',
    colorsAssigned: true,
    memberIds: ['mako'],
    members: {
      mako: { displayName: 'まこ', color: color('あか'), postCount: 4 },
    },
  };
  db.seedTrip(trip4);
  db.seedPosts(trip4.id, makePosts(trip4.id, 'mako', color('あか'), 4, CAPTIONS));
  db.seedInviteCode({
    code: '123456',
    tripId: trip4.id,
    expiresAt: new Date(2027, 11, 31),
  });
}
