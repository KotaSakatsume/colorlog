/**
 * Storage セキュリティルールの rules-unit-testing。
 *
 * 実行はエミュレータ前提（`npm run test:rules` = firebase emulators:exec 経由）。
 * 当環境には firebase-tools / Java が無いためここでの緑確認は不可。エミュレータ起動下で
 * 緑になるよう「エミュレータ前提」で正しく書く。デフォルト jest（npm test）からは
 * jest.config.js の testPathIgnorePatterns で除外される。
 *
 * パス対応: trips/{tripId}/{uid}/{postId}/{fileName} に投稿画像を置く（main.jpg / thumb.jpg）。
 * write 条件: {uid} == auth.uid・1.5MiB 未満・contentType == 'image/jpeg'。
 * read 条件: 認証済みなら可（Storage は Firestore を読めないため。詳細は storage.rules）。
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import path from 'path';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-colorlog';
const RULES_PATH = path.resolve(__dirname, '../../storage.rules');

const JPEG = { contentType: 'image/jpeg' };

/** 指定バイト数のダミー画像データを生成する。 */
function bytes(size: number): Uint8Array {
  return new Uint8Array(size);
}

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync(RULES_PATH, 'utf8') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

// 実アップロード先は trips/{tripId}/{uid}/{postId}/main.jpg（5セグメント）。
// postId は決定的（${uid}_${slotIndex}）なので alice の例では `alice_0` を使う。
const MAIN_PATH = 'trips/t1/alice/alice_0/main.jpg';
const THUMB_PATH = 'trips/t1/alice/alice_0/thumb.jpg';

describe('storage write (trips/{tripId}/{uid}/{postId}/{fileName})', () => {
  // ケース15: 正常（jpeg・1.5MiB 未満・自分の uid パス・5セグメント main.jpg）は許可
  it('jpeg・1.5MiB 未満・自分の uid パスの main.jpg への write は許可', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), MAIN_PATH);
    await assertSucceeds(uploadBytes(r, bytes(100 * 1024), JPEG));
  });

  // thumb.jpg（同 postId 配下の別ファイル名）も許可
  it('同 postId 配下の thumb.jpg への write も許可', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), THUMB_PATH);
    await assertSucceeds(uploadBytes(r, bytes(25 * 1024), JPEG));
  });

  // ケース12: 1.5MiB 超は拒否
  it('1.5MiB を超える write は拒否', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), MAIN_PATH);
    await assertFails(uploadBytes(r, bytes(1.5 * 1024 * 1024 + 1), JPEG));
  });

  // 境界値: ちょうど 1.5MiB（1572864 バイト）は `< 1.5*1024*1024` が偽で拒否
  it('ちょうど 1.5MiB の write は拒否（境界・未満のみ許可）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), MAIN_PATH);
    await assertFails(uploadBytes(r, bytes(1.5 * 1024 * 1024), JPEG));
  });

  // 境界値: 1.5MiB ちょうど未満（1572863 バイト）は許可
  it('1.5MiB ちょうど未満の write は許可（境界）', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), MAIN_PATH);
    await assertSucceeds(uploadBytes(r, bytes(1.5 * 1024 * 1024 - 1), JPEG));
  });

  // ケース13: 非 jpeg は拒否
  it('非 jpeg（png）の write は拒否', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), MAIN_PATH);
    await assertFails(uploadBytes(r, bytes(100 * 1024), { contentType: 'image/png' }));
  });

  // ケース14: 他人の uid パスへの write は拒否
  it('他人の uid パスへの write は拒否', async () => {
    const alice = testEnv.authenticatedContext('alice');
    const r = ref(alice.storage(), 'trips/t1/bob/bob_0/main.jpg');
    await assertFails(uploadBytes(r, bytes(100 * 1024), JPEG));
  });

  // 未認証は write 拒否
  it('未認証ユーザーの write は拒否', async () => {
    const anon = testEnv.unauthenticatedContext();
    const r = ref(anon.storage(), MAIN_PATH);
    await assertFails(uploadBytes(r, bytes(100 * 1024), JPEG));
  });
});

describe('storage read (trips/{tripId}/{uid}/{postId}/{fileName})', () => {
  // 認証済みなら read 可（メンバー限定 read は別Issue）
  it('認証済みユーザーは read 可（ルール上 allow）', async () => {
    // seed: ルール無効化コンテキストで画像を投入
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), MAIN_PATH), bytes(100 * 1024), JPEG);
    });
    const alice = testEnv.authenticatedContext('alice');
    await assertSucceeds(getBytes(ref(alice.storage(), MAIN_PATH)));
  });
});
