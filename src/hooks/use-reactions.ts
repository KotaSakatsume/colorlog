import { useEffect, useState } from 'react';

import type { ReactionSummary } from '@/domain/types';
import { useCurrentUser, useRepositories } from '@/repositories/context';

/**
 * トリップ内の全 post のリアクション集計を購読する。
 * posts 本体とは独立した購読源（高頻度で変わる軽量データを分離）。
 * mine は現在ユーザー視点で解決されるため、依存配列に user.uid を含める。
 */
export function useTripReactions(tripId: string | undefined): Map<string, ReactionSummary> {
  const { posts: postRepo } = useRepositories();
  const user = useCurrentUser();
  const [byPost, setByPost] = useState<Map<string, ReactionSummary>>(new Map());

  useEffect(() => {
    if (!tripId) {
      setByPost(new Map());
      return;
    }
    const unsubscribe = postRepo.subscribeToTripReactions(tripId, user.uid, setByPost);
    return unsubscribe;
  }, [postRepo, tripId, user.uid]);

  return byPost;
}

/**
 * トリップ内のアルバム拍手（ownerUid → 押した人の uid 配列）を購読する。
 * viewer 非依存の生データなので、押した/押してないの判定は呼び出し側で行う。
 */
export function useAlbumClaps(tripId: string | undefined): Map<string, string[]> {
  const { posts: postRepo } = useRepositories();
  const [byOwner, setByOwner] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    if (!tripId) {
      setByOwner(new Map());
      return;
    }
    const unsubscribe = postRepo.subscribeToAlbumClaps(tripId, setByOwner);
    return unsubscribe;
  }, [postRepo, tripId]);

  return byOwner;
}
