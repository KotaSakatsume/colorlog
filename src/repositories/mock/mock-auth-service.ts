import type { AuthService, AuthUser, ProfileUpdate, Unsubscribe } from '@/repositories/types';

/** この段階の Mock は固定の「自分」ユーザーで始まる。Firebase 実装で匿名/Apple 認証に差し替える。 */
export const MOCK_CURRENT_USER: AuthUser = {
  uid: 'me',
  displayName: 'あなた',
};

export class MockAuthService implements AuthService {
  private user: AuthUser;
  private readonly listeners = new Set<(user: AuthUser) => void>();

  constructor(user: AuthUser = MOCK_CURRENT_USER) {
    this.user = { ...user };
  }

  getCurrentUser(): AuthUser {
    return this.user;
  }

  updateProfile(patch: ProfileUpdate): void {
    const next: AuthUser = { ...this.user };
    const displayName = patch.displayName?.trim();
    if (displayName) {
      next.displayName = displayName;
    }
    // photoURL はキーが渡された時だけ反映。空文字/undefined はクリア扱い。
    if ('photoURL' in patch) {
      next.photoURL = patch.photoURL || undefined;
    }
    this.user = next;
    this.listeners.forEach((fn) => fn(this.user));
  }

  subscribe(listener: (user: AuthUser) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.user); // 初期値を即時に流す
    return () => {
      this.listeners.delete(listener);
    };
  }
}
