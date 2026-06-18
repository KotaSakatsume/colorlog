import { useEffect, useState } from 'react';

import type { InviteCode, Post, Trip } from '@/domain/types';
import { useCurrentUser, useRepositories } from '@/repositories/context';

/** 自分が参加中のトリップ一覧をリアルタイム購読する。 */
export function useUserTrips(): { trips: Trip[]; loading: boolean } {
  const { trips: tripRepo } = useRepositories();
  const user = useCurrentUser();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = tripRepo.subscribeToUserTrips(user.uid, (next) => {
      setTrips(next);
      setLoading(false);
    });
    return unsubscribe;
  }, [tripRepo, user.uid]);

  return { trips, loading };
}

/** 単一トリップをリアルタイム購読する。 */
export function useTrip(tripId: string | undefined): { trip: Trip | null; loading: boolean } {
  const { trips: tripRepo } = useRepositories();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) {
      setTrip(null);
      setLoading(false);
      return;
    }
    const unsubscribe = tripRepo.subscribeToTrip(tripId, (next) => {
      setTrip(next);
      setLoading(false);
    });
    return unsubscribe;
  }, [tripRepo, tripId]);

  return { trip, loading };
}

/**
 * トリップに紐づく招待コードを取得する。
 * トリップの生成/削除に追従するため subscribeToTrip に乗せ、トリップが消えたら null に戻す。
 */
export function useTripInviteCode(tripId: string | undefined): InviteCode | null {
  const { trips: tripRepo } = useRepositories();
  const [invite, setInvite] = useState<InviteCode | null>(null);

  useEffect(() => {
    if (!tripId) {
      setInvite(null);
      return;
    }
    let active = true;
    const unsubscribe = tripRepo.subscribeToTrip(tripId, (trip) => {
      if (!active) return;
      if (!trip) {
        setInvite(null);
        return;
      }
      tripRepo.getInviteCodeForTrip(tripId).then((next) => {
        if (active) setInvite(next);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [tripRepo, tripId]);

  return invite;
}

/** トリップ内の全投稿をリアルタイム購読する。 */
export function useTripPosts(tripId: string | undefined): { posts: Post[]; loading: boolean } {
  const { posts: postRepo } = useRepositories();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    const unsubscribe = postRepo.subscribeToTripPosts(tripId, (next) => {
      setPosts(next);
      setLoading(false);
    });
    return unsubscribe;
  }, [postRepo, tripId]);

  return { posts, loading };
}
