import type { Trip, TripStatus } from './types';

const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

/** 「6/1 - 6/5」のような期間表記。 */
export function formatDateRange(start: Date, end: Date): string {
  return `${f(start)} - ${f(end)}`;
}

export const STATUS_LABEL: Record<TripStatus, string> = {
  planning: '計画中',
  active: '開催中',
  finished: '終了',
};

/** メンバー数（自分を含む）。 */
export function memberCount(trip: Trip): number {
  return trip.memberIds.length;
}

/**
 * 旅行期間が終了しているか（endDate 当日の終わりを過ぎたら true）。
 * 終了後はベスト9への追加・差し替えを禁止する判定に使う。
 */
export function isTripOver(trip: Trip, now: Date = new Date()): boolean {
  const end = new Date(trip.endDate);
  end.setHours(23, 59, 59, 999);
  return now.getTime() > end.getTime();
}
