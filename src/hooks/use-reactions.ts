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
