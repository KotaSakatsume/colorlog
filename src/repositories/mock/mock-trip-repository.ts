import { assignColorsToTrip, pickColorForJoiner } from '@/domain/assign-colors';
import { MAX_MEMBERS } from '@/domain/colors';
import { generateId, generateInviteCode } from '@/domain/id';
import type { InviteCode, Trip } from '@/domain/types';
import type {
  CreateTripInput,
  CreateTripResult,
  JoinTripInput,
  TripRepository,
  Unsubscribe,
} from '@/repositories/types';

import type { MockBackend } from './mock-backend';

/** 招待コードの有効期限（日数）。 */
const INVITE_TTL_DAYS = 7;

export class MockTripRepository implements TripRepository {
  constructor(private readonly db: MockBackend) {}

  subscribeToUserTrips(userId: string, listener: (trips: Trip[]) => void): Unsubscribe {
    return this.db.subscribeUserTrips(userId, listener);
  }

  subscribeToTrip(tripId: string, listener: (trip: Trip | null) => void): Unsubscribe {
    return this.db.subscribeTrip(tripId, listener);
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return this.db.getTrip(tripId);
  }

  async getInviteCodeForTrip(tripId: string): Promise<InviteCode | null> {
    return this.db.getInviteCodeForTrip(tripId);
  }

  async resolveInviteCode(code: string): Promise<InviteCode | null> {
    const invite = this.db.getInviteCode(code.trim().toUpperCase());
    if (!invite) return null;
    // 期限切れは「読めない」扱い（SPEC 13-3）。
    if (invite.expiresAt.getTime() < Date.now()) return null;
    return invite;
  }

  async createTrip(input: CreateTripInput): Promise<CreateTripResult> {
    // UI の不変条件に依存せず、データ層でも入力を検証する。
    const name = input.name.trim();
    if (!name) {
      throw new Error('トリップ名を入力してください');
    }
    if (input.endDate.getTime() < input.startDate.getTime()) {
      throw new Error('終了日は開始日以降にしてください');
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    if (input.startDate.getTime() < startOfToday.getTime()) {
      throw new Error('開始日は今日以降にしてください');
    }

    const tripId = generateId('trip');
    const trip: Trip = {
      id: tripId,
      name,
      startDate: input.startDate,
      endDate: input.endDate,
      hostUserId: input.host.uid,
      status: 'planning',
      colorsAssigned: false,
      memberIds: [input.host.uid],
      members: {
        [input.host.uid]: {
          displayName: input.host.displayName,
          photoURL: input.host.photoURL,
          postCount: 0,
        },
      },
    };

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const inviteCode: InviteCode = { code: generateInviteCode(), tripId, expiresAt };

    this.db.putTrip(trip);
    this.db.putInviteCode(inviteCode);
    return { trip, inviteCode };
  }

  async deleteTrip(tripId: string): Promise<void> {
    // 存在しない tripId は no-op（二重削除でもエラーにしない＝冪等）。
    this.db.deleteTrip(tripId);
  }

  async joinTrip(input: JoinTripInput): Promise<Trip> {
    const invite = await this.resolveInviteCode(input.code);
    if (!invite) {
      throw new Error('招待コードが見つからないか、有効期限が切れています');
    }
    const trip = this.db.getTrip(invite.tripId);
    if (!trip) {
      throw new Error('トリップが見つかりません');
    }

    // すでに参加済みなら何もしない（冪等）。
    if (trip.memberIds.includes(input.user.uid)) {
      return trip;
    }

    // 配布前でも人数上限（= 色数）を入口で強制する。
    // 配布済みの場合は下の pickColorForJoiner が残り色枯渇で弾くが、メッセージを揃えるためここでも確認。
    if (trip.memberIds.length >= MAX_MEMBERS) {
      throw new Error(`このトリップは満員です（最大${MAX_MEMBERS}人）`);
    }

    // 配布済みトリップへの途中参加は残り色から1色付与（SPEC 5-6）。
    const color = trip.colorsAssigned ? pickColorForJoiner(trip) : undefined;

    const updated: Trip = {
      ...trip,
      memberIds: [...trip.memberIds, input.user.uid],
      members: {
        ...trip.members,
        [input.user.uid]: {
          displayName: input.user.displayName,
          photoURL: input.user.photoURL,
          color,
          postCount: 0,
        },
      },
    };

    this.db.putTrip(updated);
    return updated;
  }

  async assignColors(tripId: string): Promise<Trip> {
    // 取得 → 純粋関数で配布 → 書き戻し、までが単一スレッドで原子的に走るため
    // 二重配布は起きない（Firestore 実装では runTransaction でこれを保証する）。
    const trip = this.db.getTrip(tripId);
    if (!trip) {
      throw new Error('トリップが見つかりません');
    }
    const assigned = assignColorsToTrip(trip);
    // 配布したらトリップを開始状態にする。
    const updated: Trip = { ...assigned, status: 'active' };
    this.db.putTrip(updated);
    return updated;
  }
}
