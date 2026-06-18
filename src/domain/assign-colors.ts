/**
 * 色配布の核ロジック（SPEC セクション3・5-1・9-3）
 *
 * ここは「純粋関数」として実装し、Firebase / 乱数 / 時刻に依存しない。
 * リポジトリ実装側がこの関数をトランザクション（Firestore の runTransaction、
 * Mock では単一スレッドの原子的更新）の内側で呼ぶことで、二重配布を原理的に防ぐ。
 */

import { AssignedColor, COLOR_POOL, MAX_MEMBERS } from './colors';
import type { Trip } from './types';

/** 配布済みトリップに再度配布しようとした */
export class ColorsAlreadyAssignedError extends Error {
  constructor(public readonly tripId: string) {
    super(`Colors already assigned for trip ${tripId}`);
    this.name = 'ColorsAlreadyAssignedError';
  }
}

/** メンバーが色プール数（12）を超えた */
export class TooManyMembersError extends Error {
  constructor(
    public readonly memberCount: number,
    public readonly max: number = MAX_MEMBERS,
  ) {
    super(`Trip has ${memberCount} members, exceeding the limit of ${max}`);
    this.name = 'TooManyMembersError';
  }
}

/** 配布済みトリップに空き色が無く、途中参加できない */
export class TripIsFullError extends Error {
  constructor(public readonly tripId: string) {
    super(`No colors left to assign in trip ${tripId}`);
    this.name = 'TripIsFullError';
  }
}

/** 未配布トリップに対して途中参加の色付与を試みた */
export class ColorsNotAssignedError extends Error {
  constructor(public readonly tripId: string) {
    super(`Colors are not yet assigned for trip ${tripId}`);
    this.name = 'ColorsNotAssignedError';
  }
}

/** 配列をシャッフルして新しい配列を返す関数。テストでは決定的な実装を注入する。 */
export type Shuffle = <T>(items: readonly T[]) => T[];

/** 候補プールから1色を選ぶ関数。テストでは決定的な実装を注入する。 */
export type Pick = (pool: readonly AssignedColor[]) => AssignedColor;

const fisherYatesShuffle: Shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const randomPick: Pick = (pool) => pool[Math.floor(Math.random() * pool.length)];

/**
 * 全メンバーへランダムに色を割り当てた新しい Trip を返す（純粋関数・元の trip は変更しない）。
 *
 * 不変条件:
 *  - 未配布（colorsAssigned === false）のときだけ実行できる。再実行は例外。
 *  - メンバー数 <= 12。超えたら例外。
 *  - 各メンバーには互いに異なる色が付く（プールからシャッフルして先頭から配るため）。
 */
export function assignColorsToTrip(trip: Trip, shuffle: Shuffle = fisherYatesShuffle): Trip {
  if (trip.colorsAssigned) {
    throw new ColorsAlreadyAssignedError(trip.id);
  }
  if (trip.memberIds.length > MAX_MEMBERS) {
    throw new TooManyMembersError(trip.memberIds.length);
  }

  const palette = shuffle(COLOR_POOL);
  const members: Trip['members'] = { ...trip.members };

  trip.memberIds.forEach((uid, index) => {
    const existing = members[uid];
    members[uid] = {
      ...existing,
      color: palette[index],
      postCount: existing?.postCount ?? 0,
    };
  });

  return { ...trip, members, colorsAssigned: true };
}

/** すでに使われている色の hex 集合を返す。 */
export function usedColorHexes(trip: Trip): Set<string> {
  const used = new Set<string>();
  for (const member of Object.values(trip.members)) {
    if (member.color) {
      used.add(member.color.hex);
    }
  }
  return used;
}

/** まだ割り当てられていない残り色を返す。 */
export function availableColors(trip: Trip): AssignedColor[] {
  const used = usedColorHexes(trip);
  return COLOR_POOL.filter((color) => !used.has(color.hex));
}

/**
 * 配布済みトリップへの途中参加者に、残り色プールから1色を選んで返す（SPEC 5-6）。
 * 残りが無ければ TripIsFullError。
 */
export function pickColorForJoiner(trip: Trip, pick: Pick = randomPick): AssignedColor {
  if (!trip.colorsAssigned) {
    throw new ColorsNotAssignedError(trip.id);
  }
  const available = availableColors(trip);
  if (available.length === 0) {
    throw new TripIsFullError(trip.id);
  }
  return pick(available);
}
