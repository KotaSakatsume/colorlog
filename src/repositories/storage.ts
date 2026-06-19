/**
 * UploadQueue の永続化境界（KeyValueStore 抽象）。
 *
 * 実装差し替えのための薄い抽象。本番は AsyncStorage をラップし、テストは Map ベースの
 * in-memory 実装を注入する（DI）。これにより node テストは本番アダプタのコードパスを
 * 一切「呼ばず」に完結する（AsyncStorage の getItem は node では Promise が
 * `window is not defined` で reject するため、呼ばないことが隔離の本質。import 自体は無害）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** key-value 永続化の最小契約。AsyncStorage / in-memory mock の双方がこれを満たす。 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * 本番アダプタ。`@react-native-async-storage/async-storage` をそのままラップする。
 * テストからは「呼ばせない」（DI で createMemoryStore を注入）ことで node 実行の reject を避ける。
 */
export function createAsyncStorageStore(): KeyValueStore {
  return {
    getItem: (key) => AsyncStorage.getItem(key),
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  };
}

/**
 * テスト用の in-memory 実装。AsyncStorage の契約に合わせ、未設定キーは `null` を返す。
 * node 環境で完結し、本番アダプタのコードパスを評価しない。
 */
export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}
