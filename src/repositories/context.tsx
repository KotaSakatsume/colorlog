/**
 * Repository を画面へ注入する DI コンテキスト。
 *
 * 画面/フックは useRepositories() / useCurrentUser() 経由でのみデータ層に触れる。
 * ここで Mock 実装を差し込んでいる。Firebase 実装が出来たら、この1か所を差し替えるだけ。
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createMockRepositories } from '@/repositories/mock';
import type { AuthUser, Repositories } from '@/repositories/types';

const RepositoriesContext = createContext<Repositories | null>(null);

export function RepositoryProvider({ children }: { children: ReactNode }) {
  // アプリ生存期間で1度だけ生成（シードと購読状態を保つ）。
  const repositories = useMemo(() => createMockRepositories(), []);
  // 送信キューの復元と処理ループを起動する（start は冪等）。
  // テストでは start() を明示 await して fake timer を制御するため、生成側でなくここで呼ぶ。
  useEffect(() => {
    void repositories.uploadQueue.start();
  }, [repositories]);
  return (
    <RepositoriesContext.Provider value={repositories}>{children}</RepositoriesContext.Provider>
  );
}

export function useRepositories(): Repositories {
  const repositories = useContext(RepositoriesContext);
  if (!repositories) {
    throw new Error('useRepositories must be used within a RepositoryProvider');
  }
  return repositories;
}

export function useCurrentUser(): AuthUser {
  const { auth } = useRepositories();
  // プロフィール更新を画面へ反映させるため認証状態を購読する。
  const [user, setUser] = useState<AuthUser>(() => auth.getCurrentUser());
  useEffect(() => auth.subscribe(setUser), [auth]);
  return user;
}
