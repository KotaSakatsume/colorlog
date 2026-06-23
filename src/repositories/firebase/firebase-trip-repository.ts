/**
 * FirebaseTripRepository（TripRepository 実装・§9-5 / 設計 §3-2）。
 *
 * - 核トランザクション（assignColors / joinTrip）は runTransaction + tx.get（getDoc ではない・調査 §8-1）。
 * - assignColors は既存純関数 assignColorsToTrip(trip) を tx 内で再利用（二重配布を原理的に防ぐ・R4）。
 * - joinTrip は pickColorForJoiner(trip) を再利用。書き込みは自 uid の追加のみ（ルール isJoiningSelf 整合・R6）。
 * - ID はドメイン ID 採用（generateId/generateInviteCode）で Mock と一致（Firestore 自動 ID は使わない）。
 * - 時刻書き分けは adapters に集約（startDate/endDate/expiresAt=Timestamp.fromDate・R-B）。
 *
 * modular API 統一（R-A）。native は firebase 隔離内に閉じる。
 */

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  where,
  writeBatch,
} from '@react-native-firebase/firestore';

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

import { inviteFromDoc, inviteToData, tripFromDoc, tripToData } from './adapters';
import { db } from './firebase-app';

/** 招待コードの有効期限（日数）。Mock と一致。 */
const INVITE_TTL_DAYS = 7;

export class FirebaseTripRepository implements TripRepository {
  subscribeToUserTrips(userId: string, listener: (trips: Trip[]) => void): Unsubscribe {
    const q = query(
      collection(db(), 'trips'),
      where('memberIds', 'array-contains', userId),
    );
    return onSnapshot(q, (snap) => {
      const trips: Trip[] = [];
      snap.forEach((d) => {
        const trip = tripFromDoc(d);
        if (trip) trips.push(trip);
      });
      listener(trips);
    });
  }

  subscribeToTrip(tripId: string, listener: (trip: Trip | null) => void): Unsubscribe {
    return onSnapshot(doc(db(), 'trips', tripId), (snap) => {
      listener(tripFromDoc(snap));
    });
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    const snap = await getDoc(doc(db(), 'trips', tripId));
    return tripFromDoc(snap);
  }

  async getInviteCodeForTrip(tripId: string): Promise<InviteCode | null> {
    const q = query(
      collection(db(), 'inviteCodes'),
      where('tripId', '==', tripId),
      limit(1),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const invite = inviteFromDoc(snap.docs[0]);
    if (!invite) return null;
    // 期限切れは「無い」扱い（Mock と同規約）。
    if (invite.expiresAt.getTime() < Date.now()) return null;
    return invite;
  }

  async resolveInviteCode(code: string): Promise<InviteCode | null> {
    const normalized = code.trim().toUpperCase();
    const snap = await getDoc(doc(db(), 'inviteCodes', normalized));
    const invite = inviteFromDoc(snap);
    if (!invite) return null;
    if (invite.expiresAt.getTime() < Date.now()) return null;
    return invite;
  }

  async createTrip(input: CreateTripInput): Promise<CreateTripResult> {
    // 入力検証は Mock と同一（データ層でも検証）。
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

    // trip doc と inviteCodes/{code} doc を batch write（Mock の2書き込みに対応）。
    const batch = writeBatch(db());
    batch.set(doc(db(), 'trips', tripId), tripToData(trip));
    batch.set(doc(db(), 'inviteCodes', inviteCode.code), inviteToData(inviteCode));
    await batch.commit();

    return { trip, inviteCode };
  }

  async deleteTrip(tripId: string): Promise<void> {
    const tripRef = doc(db(), 'trips', tripId);
    const snap = await getDoc(tripRef);
    // 存在しない tripId は no-op（冪等）。
    if (!snap.exists()) return;

    // サブコレクション posts はクライアントから一括削除できないため列挙して batch 削除
    // （最大 12人×9枚＝小さい）。inviteCodes も tripId 一致分を掃除。
    const batch = writeBatch(db());

    const postsSnap = await getDocs(collection(db(), 'trips', tripId, 'posts'));
    postsSnap.forEach((d) => batch.delete(d.ref));

    const invitesSnap = await getDocs(
      query(collection(db(), 'inviteCodes'), where('tripId', '==', tripId)),
    );
    invitesSnap.forEach((d) => batch.delete(d.ref));

    batch.delete(tripRef);
    await batch.commit();
  }

  async joinTrip(input: JoinTripInput): Promise<Trip> {
    const invite = await this.resolveInviteCode(input.code);
    if (!invite) {
      throw new Error('招待コードが見つからないか、有効期限が切れています');
    }

    // runTransaction で trip を tx.get → 冪等判定 → 上限 → 色付与 → 自 uid 追加。
    return runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'trips', invite.tripId);
      const snap = await tx.get(ref);
      const trip = tripFromDoc(snap);
      if (!trip) {
        throw new Error('トリップが見つかりません');
      }

      // すでに参加済みなら何もしない（冪等）。
      if (trip.memberIds.includes(input.user.uid)) {
        return trip;
      }
      if (trip.memberIds.length >= MAX_MEMBERS) {
        throw new Error(`このトリップは満員です（最大${MAX_MEMBERS}人）`);
      }

      // 配布済みなら残り色から1色付与（純関数を再利用）。
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

      // 書き込みは自 uid の追加のみ（ルール isJoiningSelf 整合・R6）。
      // memberIds は arrayUnion(自 uid)、members[uid] は新規エントリのみ merge で載せる。
      tx.set(
        ref,
        {
          memberIds: arrayUnion(input.user.uid),
          members: {
            [input.user.uid]: {
              displayName: input.user.displayName,
              ...(input.user.photoURL !== undefined ? { photoURL: input.user.photoURL } : {}),
              ...(color !== undefined ? { color } : {}),
              postCount: 0,
            },
          },
        },
        { merge: true },
      );
      return updated;
    });
  }

  async assignColors(tripId: string): Promise<Trip> {
    // runTransaction で tx.get → 既存純関数 assignColorsToTrip → status:'active' 付与で書き戻し。
    // 配布済みなら assignColorsToTrip が ColorsAlreadyAssignedError を投げる＝二重配布が起きない（R4）。
    return runTransaction(db(), async (tx) => {
      const ref = doc(db(), 'trips', tripId);
      const snap = await tx.get(ref);
      const trip = tripFromDoc(snap);
      if (!trip) {
        throw new Error('トリップが見つかりません');
      }
      const assigned = assignColorsToTrip(trip);
      const updated: Trip = { ...assigned, status: 'active' };
      // members / colorsAssigned / status を書き戻す。startDate 等は不変なので merge。
      tx.set(
        ref,
        {
          members: tripToData(updated).members,
          colorsAssigned: true,
          status: 'active',
        },
        { merge: true },
      );
      return updated;
    });
  }
}
