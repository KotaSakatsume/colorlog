import type { AuthService, AuthUser, ProfileUpdate, Unsubscribe } from '@/repositories/types';

/** この段階の Mock は固定の「自分」匿名ユーザーで始まる。Firebase 実装で匿名/Apple 認証に差し替える。 */
export const MOCK_CURRENT_USER: AuthUser = {
  uid: 'me',
  displayName: 'あなた',
  isAnonymous: true,
};

/**
 * Apple 連携時に当てる Mock の表示名。
 * 実 Apple 認証は名前を初回しか返さないため、Mock では固定文字列で代用する。
 * ユーザーが既に displayName を編集している場合は維持し、初期値のときだけこれに更新する。
 */
export const MOCK_APPLE_DISPLAY_NAME = 'Apple ユーザー';

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

  async linkWithApple(): Promise<AuthUser> {
    // 既に連携済みなら冪等。状態を変えず通知もしない（現ユーザーを返す）。
    if (!this.user.isAnonymous) {
      return this.user;
    }
    const next: AuthUser = { ...this.user, isAnonymous: false };
    // 表示名はユーザーが編集していなければ（初期値のままなら）Apple 名に更新、編集済みなら維持。
    if (next.displayName === MOCK_CURRENT_USER.displayName) {
      next.displayName = MOCK_APPLE_DISPLAY_NAME;
    }
    // 状態を1回確定してから1回だけ通知する（updateProfile と同じ経路・重複通知を避ける）。
    this.user = next;
    this.listeners.forEach((fn) => fn(this.user));
    return this.user;
  }

  subscribe(listener: (user: AuthUser) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.user); // 初期値を即時に流す
    return () => {
      this.listeners.delete(listener);
    };
  }
}
