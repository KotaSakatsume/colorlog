/**
 * Repository を画面へ注入する DI コンテキスト。
 *
 * 画面/フックは useRepositories() / useCurrentUser() 経由でのみデータ層に触れる。
 * ここで Mock 実装を差し込んでいる。Firebase 実装が出来たら、この1か所を差し替えるだけ。
 */

import Constants, { AppOwnership } from 'expo-constants';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';

import { createMockRepositories } from '@/repositories/mock';
import type { AuthUser, Repositories } from '@/repositories/types';

const RepositoriesContext = createContext<Repositories | null>(null);

/** Expo Go で動いているか（appOwnership === Expo）。Dev Build / 本番では false。 */
const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
/**
 * Firebase 実装を有効化するか。本Issue（§9-5）では既定 false（安全側・既定 Mock）。
 * Dev Build での有効化（true 化 / extra フラグ参照）と環境変数化はゲートC以降の別Issue。
 */
const FIREBASE_ENABLED = false;

/**
 * 起動時にどの Repositories 実装を使うか決める（Expo-Go-safe な差し替え機構・設計 §2）。
 *
 * Firebase は web / Expo Go では native 未リンクでクラッシュしうるため、
 * Platform.OS !== 'web' && !isExpoGo && FIREBASE_ENABLED のガード内でのみ
 * **動的 require**（静的 import しない）+ try/catch で解決する（glass-surface 前例）。
 * 解決失敗・ガード外は常に Mock にフォールバックする。
 */
function selectRepositories(): Repositories {
  if (Platform.OS !== 'web' && !isExpoGo && FIREBASE_ENABLED) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createFirebaseRepositories } = require('@/repositories/firebase');
      return createFirebaseRepositories();
    } catch (e) {
      console.warn('[repositories] Firebase init failed, falling back to Mock', e);
    }
  }
  return createMockRepositories();
}

export function RepositoryProvider({ children }: { children: ReactNode }) {
  // アプリ生存期間で1度だけ生成（シードと購読状態を保つ）。
  const repositories = useMemo(() => selectRepositories(), []);
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
