import type { Repositories } from '@/repositories/types';

import { MockAuthService } from './mock-auth-service';
import { MockBackend } from './mock-backend';
import { MockPostRepository } from './mock-post-repository';
import { MockTripRepository } from './mock-trip-repository';
import { seedMockData } from './seed';

/**
 * シード済みの Mock リポジトリ一式を生成する。
 * 1つの MockBackend を全リポジトリで共有し、Firebase の単一バックエンドを模す。
 */
export function createMockRepositories(): Repositories {
  const db = new MockBackend();
  seedMockData(db);
  return {
    auth: new MockAuthService(),
    trips: new MockTripRepository(db),
    posts: new MockPostRepository(db),
  };
}

export { MockBackend } from './mock-backend';
export { MOCK_CURRENT_USER } from './mock-auth-service';
