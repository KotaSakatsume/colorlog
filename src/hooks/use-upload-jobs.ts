import { useEffect, useState } from 'react';

import type { UploadJob } from '@/domain/types';
import { useRepositories } from '@/repositories/context';

/**
 * トリップの送信中ジョブ（UploadQueue）をリアルタイム購読する。
 * useTripPosts と同形（subscribe→setState, return unsubscribe）。
 */
export function useTripUploadJobs(tripId: string | undefined): UploadJob[] {
  const { uploadQueue } = useRepositories();
  const [jobs, setJobs] = useState<UploadJob[]>([]);

  useEffect(() => {
    if (!tripId) {
      setJobs([]);
      return;
    }
    const unsubscribe = uploadQueue.subscribe(tripId, setJobs);
    return unsubscribe;
  }, [uploadQueue, tripId]);

  return jobs;
}
