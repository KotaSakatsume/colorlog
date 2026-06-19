import { describe, expect, it } from '@jest/globals';

import { COLOR_POOL, MAX_MEMBERS } from './colors';
import {
  ColorsAlreadyAssignedError,
  ColorsNotAssignedError,
  TooManyMembersError,
  TripIsFullError,
  assignColorsToTrip,
  availableColors,
  pickColorForJoiner,
  usedColorHexes,
} from './assign-colors';
import type { Trip } from './types';

/** テスト用に N 人のメンバーを持つ未配布トリップを作る。 */
function makeTrip(memberCount: number, overrides: Partial<Trip> = {}): Trip {
  const memberIds = Array.from({ length: memberCount }, (_, i) => `u${i}`);
  const members: Trip['members'] = {};
  memberIds.forEach((uid, i) => {
    members[uid] = { displayName: `メンバー${i}` };
  });
  return {
    id: 'trip1',
    name: 'テスト旅行',
    startDate: new Date('2026-06-01'),
    endDate: new Date('2026-06-05'),
    hostUserId: 'u0',
    status: 'planning',
    colorsAssigned: false,
    memberIds,
    members,
    ...overrides,
  };
}

/** 入力をそのまま返す決定的シャッフル（配布順を予測可能にする）。 */
const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

describe('COLOR_POOL (SPEC §6)', () => {
  it('ちょうど12色を持ち、MAX_MEMBERS と一致する', () => {
    expect(COLOR_POOL).toHaveLength(12);
    expect(MAX_MEMBERS).toBe(12);
  });

  it('hex も名前も重複しない', () => {
    const hexes = COLOR_POOL.map((c) => c.hex);
    const names = COLOR_POOL.map((c) => c.name);
    expect(new Set(hexes).size).toBe(12);
    expect(new Set(names).size).toBe(12);
  });
});

describe('assignColorsToTrip', () => {
  it('全メンバーに互いに異なる色を割り当てる', () => {
    const trip = makeTrip(4);
    const result = assignColorsToTrip(trip);

    const colors = trip.memberIds.map((uid) => result.members[uid].color);
    expect(colors.every((c) => c !== undefined)).toBe(true);

    const hexes = colors.map((c) => c!.hex);
    expect(new Set(hexes).size).toBe(4); // 重複なし
    expect(result.colorsAssigned).toBe(true);
  });

  it('決定的シャッフルではプール先頭から順に配られる', () => {
    const trip = makeTrip(3);
    const result = assignColorsToTrip(trip, identityShuffle);

    expect(result.members.u0.color).toEqual(COLOR_POOL[0]);
    expect(result.members.u1.color).toEqual(COLOR_POOL[1]);
    expect(result.members.u2.color).toEqual(COLOR_POOL[2]);
  });

  it('元の trip を変更しない（純粋関数）', () => {
    const trip = makeTrip(2);
    const snapshot = JSON.parse(JSON.stringify(trip));
    assignColorsToTrip(trip);

    expect(trip.colorsAssigned).toBe(false);
    expect(trip.members.u0.color).toBeUndefined();
    expect(JSON.parse(JSON.stringify(trip))).toEqual(snapshot);
  });

  it('二重配布は ColorsAlreadyAssignedError で防がれる', () => {
    const trip = makeTrip(3);
    const once = assignColorsToTrip(trip);

    expect(() => assignColorsToTrip(once)).toThrow(ColorsAlreadyAssignedError);
  });

  it('ちょうど12人なら全員に異なる色を配布できる', () => {
    const trip = makeTrip(MAX_MEMBERS);
    expect(trip.memberIds).toHaveLength(12); // MAX_MEMBERS = 12 の明示確認
    const result = assignColorsToTrip(trip);

    const hexes = trip.memberIds.map((uid) => result.members[uid].color!.hex);
    expect(new Set(hexes).size).toBe(12); // 12色すべてが重複なく配られる
    expect(new Set(hexes).size).toBe(MAX_MEMBERS);
  });

  it('13人目（12人超）で TooManyMembersError', () => {
    const trip = makeTrip(MAX_MEMBERS + 1);
    expect(trip.memberIds).toHaveLength(13);
    expect(() => assignColorsToTrip(trip)).toThrow(TooManyMembersError);
  });

  it('既存の postCount を保ったまま配布する', () => {
    const trip = makeTrip(2);
    trip.members.u0.postCount = 5;
    const result = assignColorsToTrip(trip);

    expect(result.members.u0.postCount).toBe(5);
    expect(result.members.u1.postCount).toBe(0);
  });
});

describe('途中参加の色付与', () => {
  /** 4人に配布済みのトリップ（残り色8つ）を作る。 */
  function assignedTrip(): Trip {
    return assignColorsToTrip(makeTrip(4), identityShuffle);
  }

  it('残り色から重複しない色を返す', () => {
    const trip = assignedTrip();
    const used = usedColorHexes(trip);
    const color = pickColorForJoiner(trip);

    expect(used.has(color.hex)).toBe(false);
    expect(availableColors(trip)).toHaveLength(MAX_MEMBERS - 4);
  });

  it('決定的 pick では残りプールの先頭が返る', () => {
    const trip = assignedTrip();
    const color = pickColorForJoiner(trip, (pool) => pool[0]);
    // 先頭4色が使用済みなので、残りの先頭 = COLOR_POOL[4]
    expect(color).toEqual(COLOR_POOL[4]);
  });

  it('未配布トリップでは ColorsNotAssignedError', () => {
    const trip = makeTrip(4);
    expect(() => pickColorForJoiner(trip)).toThrow(ColorsNotAssignedError);
  });

  it('満員（12色すべて使用済み）なら TripIsFullError', () => {
    const trip = assignColorsToTrip(makeTrip(MAX_MEMBERS), identityShuffle);
    expect(() => pickColorForJoiner(trip)).toThrow(TripIsFullError);
  });
});
