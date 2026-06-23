/**
 * Firebase app / firestore / auth の取得窓口（modular API・§9-5）。
 *
 * 初期化は config plugin による自動初期化で足りる（調査 §8-2: app.json に
 * @react-native-firebase/app / auth 登録済み・GoogleService-Info.plist 設定済み・
 * useFrameworks static）。明示 initializeApp は不要 ＝ getApp() 参照のみ。
 *
 * このモジュールは起動経路から静的 import されない（context.tsx の動的 require のみが入口）。
 * Expo Go / node では評価されないため、getApp()/getAuth()/getFirestore() の native 解決は走らない。
 */

import { getApp } from '@react-native-firebase/app';
import { getAuth } from '@react-native-firebase/auth';
import { getFirestore } from '@react-native-firebase/firestore';

/** default app の Auth インスタンス（modular）。型は getAuth の戻り値から推論。 */
export function authInstance(): ReturnType<typeof getAuth> {
  return getAuth(getApp());
}

/** default app の Firestore インスタンス（modular）。型は getFirestore の戻り値から推論。 */
export function db(): ReturnType<typeof getFirestore> {
  return getFirestore(getApp());
}
