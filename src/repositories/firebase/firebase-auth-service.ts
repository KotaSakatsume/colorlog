/**
 * FirebaseAuthService（AuthService 実装・§9-5 / 設計 §3-1）。
 *
 * - 起動時に onAuthStateChanged を購読し、既存ユーザーが無ければ匿名サインインを起動。
 * - getCurrentUser() は同期契約（types.ts:98）。匿名サインインは非同期なので、構築時は
 *   暫定匿名 AuthUser を即返し、onAuthStateChanged 解決後に subscribe リスナーへ確定値を流す
 *   （調査 §8-3 の整合解）。getCurrentUser の Promise 化は interface 変更＝禁止。
 * - linkWithApple() は expo-apple-authentication + expo-crypto で nonce 整合を取り（§8-6 / R-C）、
 *   AppleAuthProvider.credential(idToken, rawNonce) → linkWithCredential。
 *
 * modular API 統一（namespaced 禁止・R-A）。native（@react-native-firebase/auth /
 * expo-apple-authentication / expo-crypto）はこのファイル内に閉じ、起動経路から静的 import されない。
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import {
  AppleAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  signInAnonymously,
  updateProfile as fbUpdateProfile,
  type FirebaseAuthTypes,
} from '@react-native-firebase/auth';

import type { AuthService, AuthUser, ProfileUpdate, Unsubscribe } from '@/repositories/types';

import { authInstance } from './firebase-app';

/** Apple 連携で表示名が取れない場合のフォールバック（Mock と同契約）。 */
const APPLE_DISPLAY_NAME_FALLBACK = 'Apple ユーザー';
/** displayName 欠落時の汎用フォールバック（SPEC 表示名規約）。 */
const ANON_DISPLAY_NAME = 'あなた';

/** Firebase user → ドメイン AuthUser。displayName は非 null 化、photoURL は string|undefined。 */
function mapFirebaseUserToAuthUser(user: FirebaseAuthTypes.User): AuthUser {
  const mapped: AuthUser = {
    uid: user.uid,
    displayName: user.displayName?.trim() || ANON_DISPLAY_NAME,
    isAnonymous: user.isAnonymous,
  };
  if (user.photoURL) mapped.photoURL = user.photoURL;
  return mapped;
}

export class FirebaseAuthService implements AuthService {
  private user: AuthUser;
  private readonly listeners = new Set<(user: AuthUser) => void>();
  private readonly unsubscribeAuth: Unsubscribe;

  constructor() {
    const auth = authInstance();
    // 構築直後の同期窓を埋めるため、現在の currentUser があればそれ、無ければ暫定匿名 user を即返す。
    const current = auth.currentUser;
    this.user = current
      ? mapFirebaseUserToAuthUser(current)
      : { uid: '', displayName: ANON_DISPLAY_NAME, isAnonymous: true };

    // 認証状態を購読し、確定値で上書き通知。未サインインなら匿名サインインを起動。
    this.unsubscribeAuth = onAuthStateChanged(auth, (next) => {
      if (next) {
        this.setUser(mapFirebaseUserToAuthUser(next));
      } else {
        // fire-and-forget。解決後に onAuthStateChanged が再度発火して setUser する。
        void signInAnonymously(auth).catch((e) => {
          console.warn('[FirebaseAuthService] signInAnonymously failed', e);
        });
      }
    });
  }

  private setUser(next: AuthUser): void {
    this.user = next;
    this.listeners.forEach((fn) => fn(this.user));
  }

  getCurrentUser(): AuthUser {
    return this.user;
  }

  updateProfile(patch: ProfileUpdate): void {
    const auth = authInstance();
    const fbUser = auth.currentUser;
    const next: AuthUser = { ...this.user };
    const displayName = patch.displayName?.trim();
    if (displayName) next.displayName = displayName;
    if ('photoURL' in patch) next.photoURL = patch.photoURL || undefined;

    // interface は同期 void。Firebase への反映は fire-and-forget（Mock と同契約）。
    if (fbUser) {
      void fbUpdateProfile(fbUser, {
        displayName: next.displayName,
        photoURL: next.photoURL ?? null,
      }).catch((e) => console.warn('[FirebaseAuthService] updateProfile failed', e));
    }
    this.setUser(next);
  }

  async linkWithApple(): Promise<AuthUser> {
    // 既に連携済みなら冪等（状態を変えず通知もしない・Mock と同契約）。
    if (!this.user.isAnonymous) {
      return this.user;
    }

    // nonce 整合（§8-6 / R-C）: rawNonce を生成 → sha256(rawNonce) を Apple へ渡す →
    // 返った identityToken と rawNonce（ハッシュ前）を Firebase credential へ。
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rawNonce,
    );

    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });

    const idToken = credential.identityToken;
    if (!idToken) {
      throw new Error('Apple サインインに失敗しました（identityToken が空です）');
    }

    const auth = authInstance();
    const fbUser = auth.currentUser;
    if (!fbUser) {
      throw new Error('連携対象のユーザーがいません');
    }

    // 第1引数 token=idToken、第2引数 secret=rawNonce（ハッシュ前）。
    const fbCredential = AppleAuthProvider.credential(idToken, rawNonce);
    const result = await linkWithCredential(fbUser, fbCredential);

    // Apple は名前を初回しか返さない。fullName が取れれば表示名へ反映、無ければフォールバック。
    const linked = mapFirebaseUserToAuthUser(result.user);
    if (linked.displayName === ANON_DISPLAY_NAME) {
      const apple = credential.fullName;
      const name = [apple?.givenName, apple?.familyName].filter(Boolean).join(' ').trim();
      linked.displayName = name || APPLE_DISPLAY_NAME_FALLBACK;
    }
    this.setUser(linked);
    return this.user;
  }

  subscribe(listener: (user: AuthUser) => void): Unsubscribe {
    this.listeners.add(listener);
    listener(this.user); // 初期値を即時に流す（Mock と同契約）。
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Provider 破棄時に Firebase 購読を解除する（リーク防止・R5）。 */
  dispose(): void {
    this.unsubscribeAuth();
    this.listeners.clear();
  }
}
