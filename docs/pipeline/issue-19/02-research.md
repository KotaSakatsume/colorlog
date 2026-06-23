# 02-research.md — Firebase 実装層（§9-5）調査

- **Issue: #19**
- **Stage: 2/5 Investigator**
- 入力: `docs/pipeline/issue-19/01-design.md`（設計のみ）
- 検証境界: tsc 0 / jest 79 不変 / Expo Go・node に native を漏らさない隔離。実挙動はゲートC後。本書は **型・API 正しさ・隔離** に集中（実機検証不可）。

---

## 0. 環境の確定事実（バージョン）

| パッケージ | バージョン | 出典 |
|---|---|---|
| `@react-native-firebase/{app,auth,firestore,storage}` | **24.1.1** | 各 `node_modules/@react-native-firebase/*/package.json` |
| `expo-apple-authentication` | 8.0.8 | `node_modules/expo-apple-authentication/package.json` |
| `expo-constants` | 18.0.13 | `node_modules/expo-constants/package.json` |
| `expo` | 54.0.35 | `node_modules/expo/package.json` |
| `expo-crypto` | **未インストール（依存に無い）** | `package.json` に記載なし / `node_modules/expo-crypto` 不在 |

- jest テストファイル数 = **8 ファイル**（`npx jest --listTests` → 8）。これが既存 79 テストの母体。`firebase/**` に `.test.ts` を作らなければ 79 不変。
- 既存テスト・src いずれも `@/repositories/context` / `@/repositories/firebase` / `@react-native-firebase/*` / `expo-apple-authentication` を **import していない**（`grep -rn ... tests/ src/ --include=*.test.*` → ヒット0）。隔離の前提は現時点成立。

---

## §8-1. RNFirebase v24 の正しい API スタイル → **modular API 確定（namespaced は非推奨・警告/strict で例外）**

### 事実: v24.1.1 は modular API を正式提供し、namespaced は実行時 deprecation warning を出す
- 各パッケージに **modular エントリが存在**:
  - auth: `node_modules/@react-native-firebase/auth/lib/modular/index.d.ts`
  - firestore: `node_modules/@react-native-firebase/firestore/dist/typescript/lib/modular.d.ts`
  - app: `node_modules/@react-native-firebase/app/dist/module/modular.js`
- namespaced 呼び出しは `warnIfNotModularCall` を通り `console.warn` + strict mode で throw する:
  `node_modules/@react-native-firebase/app/dist/module/common/index.js:683-708`
  （`globalThis.RNFB_MODULAR_DEPRECATION_STRICT_MODE === true` で `throw new Error('Deprecated API usage detected while in strict mode.')`）。
- **結論**: 本実装は **modular API で統一する**（namespaced `firestore().collection()...` は使わない）。

### auth modular（実引用・`auth/lib/modular/index.d.ts`）
```ts
export function getApp(name?: string): FirebaseApp;                              // app/modular.js:85
export function getAuth(app?: FirebaseApp): Auth;                               // :30
export function onAuthStateChanged(auth: Auth, cb): () => void;                 // :183  ← unsubscribe を返す
export function signInAnonymously(auth: Auth): Promise<UserCredential>;          // :260
export function signInWithCredential(auth: Auth, credential): Promise<UserCredential>;  // :269
export function linkWithCredential(user: User, credential): Promise<UserCredential>;    // :492  ← user 第1引数
export function updateProfile(user: User,
  { displayName, photoURL }: { displayName?: string|null; photoURL?: string|null }): Promise<void>;  // :670
// AppleAuthProvider は modular index から re-export される（:787）
export { AppleAuthProvider, OAuthProvider, ... } from '../index';
```

### firestore modular（実引用・`firestore/dist/typescript/lib/modular.d.ts` ＋ サブモジュール）
```ts
export function getFirestore(app?: FirebaseApp): Firestore;                      // modular.d.ts:9-11
export function collection(parent: Firestore, path, ...seg): CollectionReference; // :15
export function doc(parent: Firestore, path, ...seg): DocumentReference;         // :12
export function setDoc(ref, data): Promise<void>;                               // :26
export function updateDoc(ref, data): Promise<void>;                            // :28
export function runTransaction<T>(firestore: Firestore, fn: (tx: Transaction)=>Promise<T>): Promise<T>;  // :42
export function writeBatch(firestore: Firestore): WriteBatch;                    // :52
// query / snapshot は再 export（modular.d.ts:57-58 "export * from './modular/query'|'./modular/snapshot'"）
export function query(q, ...constraints): Query;                                 // modular/query.d.ts:68
export function where(field, opStr, value): QueryFieldFilterConstraint;          // :70
export function orderBy(field, dir?): QueryOrderByConstraint;                    // :73
export function limit(n: number): QueryLimitConstraint;                          // :82
export function getDoc(ref): Promise<DocumentSnapshot>;                          // :84
export function getDocs(q): Promise<QuerySnapshot>;                              // modular/query.d.ts:87
export function onSnapshot(refOrQuery, onNext, onError?, onComplete?): Unsubscribe; // modular/snapshot.d.ts:5-28（doc/query両対応・複数 overload）
// FieldValue 系（modular/FieldValue.d.ts）
export function serverTimestamp(): FieldValue;                                   // :4
export function arrayUnion(...elements): FieldValue;                             // :5
export function arrayRemove(...elements): FieldValue;                           // :6
export function increment(n: number): FieldValue;                              // :7
export function deleteField(): FieldValue;                                      // :3
// Timestamp は class re-export（modular/Timestamp.d.ts → ../FirestoreTimestamp）
```

### トランザクション内の読み書き（modular の正しい形）
`runTransaction(getFirestore(), async (tx) => {...})`。tx 内では `getDoc` ではなく **`tx.get(ref)` を使う**（`FirestoreTransaction.d.ts:17-39`）:
```ts
class Transaction {
  get(documentRef): Promise<DocumentSnapshot>;   // :32
  set(documentRef, data, options?): this;        // :36-37
  update(documentRef, ...args): this;            // :38
  delete(documentRef): this;                     // :39
}
```
**写経例（assignColors の核）**:
```ts
import { getFirestore, doc, runTransaction } from '@react-native-firebase/firestore';
await runTransaction(getFirestore(), async (tx) => {
  const ref = doc(getFirestore(), 'trips', tripId);
  const snap = await tx.get(ref);                 // ← 読みは tx.get（getDoc ではない）
  const trip = tripFromDoc(snap);                 // adapters で Timestamp→Date
  const assigned = assignColorsToTrip(trip);      // 既存純関数を再利用（§8-5）
  tx.set(ref, tripToDoc({ ...assigned, status: 'active' }), { merge: true });
});
```

---

## §8-2. `@react-native-firebase/app` の初期化要否 / import 副作用

### 事実: import 自体では native を即時解決しない（lazy）が、メソッド呼び出しで native に触れる
- `app` の main は `dist/module/index.js` で、top-level は `export ... from './namespaced.js'` と `export * from './modular.js'` のみ（`index.js:20-21`）。
- native module の取得は **関数内で lazy 実行**: `internal/nativeModuleAndroidIos.js:12-14` の `getReactNativeModule(moduleName)` 内 `const nativeModule = NativeModules[moduleName]`。module top-level での `getEnforcing`/native 解決は無い（`internal/NativeModules.js` は `export {}` のみ）。
- **推測（別欄）**: 「import だけなら落ちない」可能性は高いが、Expo Go では `getApp()`/`getAuth()` 等を**呼んだ瞬間** native 不在で throw する。設計の「import すらしない（require をガード内に閉じる）」方針は、この lazy 性に依存せず安全側に倒す正しい判断。**裏取りできたのは「native 解決は関数内 lazy」までで、Expo Go 実機での import 挙動は実機検証不可**。→ 設計どおり import しない方針を維持すべき（事実で覆せない以上、安全側）。

### 初期化（config plugin 自動初期化で足りる）
- `app.json` plugins に `@react-native-firebase/app` / `@react-native-firebase/auth` 登録済み、iOS は `googleServicesFile: ./GoogleService-Info.plist`、`expo-build-properties` で `useFrameworks: static` 済み（`app.json:13,41-42,51-54`）。
- これは **config plugin による自動初期化**（`GoogleService-Info.plist` から default app 生成）の構成。明示 `initializeApp(options)` は不要。`firebase-app.ts` は **`getApp()` 参照のみ**で良い。
- **注意（事実）**: plugins に **`@react-native-firebase/firestore` / `storage` は未登録**（`app.json:38-58`）。firestore は config plugin が原則不要（app/auth で十分）だが、Implementer は「firestore plugin 追加が必要か」を本Issueでは判断不要（実挙動はゲートC）。本Issueは型のみ。storage は本Issue対象外。

---

## §8-3. `context.tsx` / `createMockRepositories` の現状と匿名サインインの窓

### 現状（`src/repositories/context.tsx`）
- `RepositoryProvider`（:15-26）: `const repositories = useMemo(() => createMockRepositories(), [])`（:17）。`useEffect` で `repositories.uploadQueue.start()`（:20-22）。
- `useCurrentUser`（:36-42）: `useState<AuthUser>(() => auth.getCurrentUser())`（:39）で **構築直後に同期で初期 user を要求**、`useEffect(() => auth.subscribe(setUser), [auth])`（:40）で購読。
- `AuthService.getCurrentUser(): AuthUser`（**同期・非 Promise**）／`subscribe` は登録直後に現在値を即時通知する契約（`types.ts:97-108`、Mock 実装 `mock-auth-service.ts:60-67` が初期値即流し）。

### 匿名サインインの非同期窓（設計方針「暫定 user 即返し」が妥当）
- Firebase の `signInAnonymously` は非同期。`getCurrentUser()` が同期 `AuthUser` を要求するため、構築直後は実 user 未確定。
- **事実**: 既存 Mock は `getCurrentUser()` で常に非 null の `AuthUser`（`MOCK_CURRENT_USER`, `mock-auth-service.ts:4-8`）を即返す。`useCurrentUser` はこの非 null 前提で書かれている（`useState(() => auth.getCurrentUser())`）。
- **結論**: FirebaseAuthService は構築時に **暫定匿名 `AuthUser`（uid 未確定のプレースホルダ or `getAuth().currentUser` があればそれ）を即返し**、`onAuthStateChanged` 解決後に `subscribe` リスナーへ確定値を流す方針が、既存 `useCurrentUser` の同期契約を壊さない唯一の整合解。`getCurrentUser` を Promise 化する選択は **interface 変更＝禁止**（`types.ts:98` は同期 `AuthUser`）。

### FirebaseAuthTypes.User → AuthUser マッピング（`auth/lib/index.d.ts`）
- `uid: string`（:1296）, `displayName: string | null`（:1245）, `photoURL: string | null`（:1280）, `isAnonymous: boolean`（:1259）。
- `AuthUser` は `displayName: string`（非 null・`types.ts:23`）。Firebase は null 可 → **`mapFirebaseUserToAuthUser` で null フォールバック必須**（SPEC 表示名規約。Mock の `MOCK_APPLE_DISPLAY_NAME`='Apple ユーザー' 等を参考、`mock-auth-service.ts:15`）。`photoURL` は `string|null`→`string|undefined` 変換（`types.ts:24` は optional）。

---

## §8-4. node テスト / Expo Go が context / firebase を import しないことの再確認

### 事実
- `tests/` `src/` の `.test.ts(x)` は context / firebase / RNFirebase / apple-authentication を一切 import しない（grep ヒット0、上記 §0）。
- `jest.config.js`: `testMatch: ['**/*.test.ts','**/*.test.tsx']`、`testEnvironment:'node'`、`testPathIgnorePatterns:['/node_modules/','/tests/rules/']`。→ **`firebase/**` 配下に `.test.ts` を置かなければ jest は拾わない**。
- 差し替え前例の確実性（`src/components/glass-surface.tsx:30-42`）: `if (Platform.OS === 'ios') { try { const mod = require('expo-glass-effect'); ... } catch {} }` の **動的 require + try/catch** が既存パターン。設計の `selectRepositories()`（function スコープ内 require）は更に安全（module 評価時にすら require しない）。
- もう1つの前例（`src/repositories/storage.ts:1-28`）: native（AsyncStorage）を **import はするが node で呼ばない** DI 隔離。コメント（:6-8）が「import 自体は無害／呼ばないことが隔離の本質」と明記。**ただし RNFirebase app は import 自体のリスクが残る**ため storage.ts 流ではなく glass-surface 流（require をガード内）を採るべき、という設計の使い分けは正しい。

### `FIREBASE_ENABLED` フラグの置き場所（選択肢の妥当性）
- 設計の「`const FIREBASE_ENABLED = false` 定数固定」が本Issugには最も安全（型・隔離だけがゲート）。
- 将来の `Constants.expoConfig.extra` 参照も型上可能（`expo-constants` の `expoConfig.extra` は `Record<string, any> | null`、`Constants.types.d.ts:158`）。ただし環境変数化はゲートC以降の別Issue（設計 §6 補足どおり）。本Issueは定数固定で良い。

---

## §8-5. ドメイン純関数の再利用（写経元）

### シグネチャ（`src/domain/assign-colors.ts`）
```ts
export type Shuffle = <T>(items: readonly T[]) => T[];                 // :48
export type Pick = (pool: readonly AssignedColor[]) => AssignedColor;  // :51
export function assignColorsToTrip(trip: Trip, shuffle: Shuffle = fisherYatesShuffle): Trip;  // :72（配布済みは :74 で ColorsAlreadyAssignedError throw）
export function pickColorForJoiner(trip: Trip, pick: Pick = randomPick): AssignedColor;        // :116
export class ColorsAlreadyAssignedError extends Error { ... }          // :13
```
- 第2引数（shuffle/pick）は **省略可能**。Firebase 版も Mock 同様デフォルトで呼ぶ。

### 写経元（`src/repositories/mock/mock-trip-repository.ts`）
- `assignColors`（:134-146）: get → `assignColorsToTrip(trip)`（:141）→ `{ ...assigned, status:'active' }`（:143）→ put。**`status:'active'` 付与は呼び出し側責務**（純関数は status を触らない）。Firebase 版は `tx.get`→純関数→`tx.set(merge)` に置換するだけ。
- `joinTrip`（:92-132）: `resolveInviteCode`→get→参加済み冪等（:103-105）→ `MAX_MEMBERS` 上限（:109-111、`@/domain/colors`）→ `colorsAssigned ? pickColorForJoiner(trip) : undefined`（:114）→ members 追加。Firebase 版は runTransaction 内で同手順 + `memberIds` は `arrayUnion(uid)`、`members[uid]` 追加。
- `createTrip`（:45-85）: 入力検証（名前必須:48 / 終了≥開始:51 / 開始≥今日:56）→ `generateId('trip')`（:60, `@/domain/id`）・`generateInviteCode()`（:80）→ trip + inviteCode。Firebase 版は **batch write**（`writeBatch`）。ID はドメイン ID 採用（Firestore 自動 ID は使わない＝Mock と一致）。
- `resolveInviteCode`（:37-43）: `code.trim().toUpperCase()` 正規化（:38）＋ `expiresAt.getTime() < Date.now()` は null（:41）。

---

## §8-6. Apple credential の nonce 整合（最重要の落とし穴）

### 型（実引用）
- `expo-apple-authentication` `signInAsync(options?)`（`AppleAuthentication.d.ts:27`）の options に **`nonce?: string`**（`AppleAuthentication.types.d.ts:55`）。
- 返り値 `AppleAuthenticationCredential` は `identityToken: string | null`（:145）, `authorizationCode: string|null`（:150）, `fullName`/`email`/`user`/`state`。**`nonce` フィールドは返さない**（credential 型に nonce プロパティが無い）。
- Firebase 側 `AppleAuthProvider` は `AuthProvider` 型（`auth/lib/index.d.ts:97-110`）で:
  ```ts
  credential: (token: string | null, secret?: string) => AuthCredential;  // :109
  ```
  → **第1引数 token = idToken、第2引数 secret = nonce**。

### nonce 整合の事実と注意点
- Apple の OIDC 仕様では、`signInAsync({ nonce })` に渡す nonce は **送信前に SHA-256 ハッシュした値**を渡し、返ってくる `identityToken`(JWT) の `nonce` claim はそのハッシュ値になる。Firebase の `AppleAuthProvider.credential(idToken, rawNonce)` には **ハッシュ前の raw nonce** を渡す。Firebase が内部で raw を SHA-256 して JWT の nonce claim と照合する。
- **つまり**: `rawNonce` を生成 → `sha256(rawNonce)` を `signInAsync({ nonce: hashedNonce })` に渡す → 返った `identityToken` と **`rawNonce`** を `AppleAuthProvider.credential(identityToken, rawNonce)` に渡す。**ハッシュ済みを Firebase に渡すと nonce 不一致でサインイン失敗**。
- **落とし穴（依存欠落）**: SHA-256 を計算する `expo-crypto` が **未インストール**（§0）。設計が nonce ハッシュ整合を要求する一方、ハッシュ手段が依存に無い。**選択肢**: (a) `expo-crypto` を依存追加して `digestStringAsync(SHA256, rawNonce)` を使う、(b) **本Issueは型クリーン＋結線のみ**なので nonce ハッシュ計算箇所をヘルパ関数の継ぎ目（スタブ/TODO）に留め、実 SHA-256 はゲートC前に詰める。**実挙動検証はゲートC後**である以上、(b)（継ぎ目だけ用意し型を通す）が本Issueのゲートに最小整合。Implementer は **expo-crypto を勝手に追加せず**、設計（Architect）に「nonce ハッシュ手段の依存追加要否」を確認させること。
- `linkWithCredential` の正しい結線（modular）: `linkWithCredential(getAuth().currentUser!, AppleAuthProvider.credential(identityToken, rawNonce))`（`auth/lib/modular/index.d.ts:492`、`identityToken` が null の場合は事前に弾く）。既に `isAnonymous=false` なら冪等返却（Mock `mock-auth-service.ts:44-46` と同契約）。

---

## §8-7. serverTimestamp vs Timestamp.fromDate（ルールが答えを確定させる）

### 事実: `firestore.rules` が `lastPostAt == request.time` を強制 → `lastPostAt` は **serverTimestamp() 必須**
- `firestore.rules:115-120` `serverTimestamped()`:
  `request.resource.data.members[uid].lastPostAt == request.time`。
- `firestore.rules:104-110` `rateOk()`: `request.time > resource.data.members[uid].lastPostAt + duration.value(10,'s')`。
- trips の `allow update`（:129-132）に `rateOk() && serverTimestamped()` が AND で入る。
- **結論**: `promotePhoto` / `toggleReaction` で書く `members[uid].lastPostAt` は **`serverTimestamp()`** でなければルールに弾かれる（`Timestamp.fromDate(new Date())` だと `== request.time` を満たせず reject）。
- 読み戻し（ドメインへ返す直前）は serverTimestamp が解決されるまでローカルに値が無いので、**`new Date()` で暫定補完**して `Post`/`Member` に詰める（onSnapshot で後追い確定値が流れる）。

### Timestamp 変換 API（`firestore/dist/typescript/lib/FirestoreTimestamp.d.ts`）
```ts
static now(): Timestamp;            // :2
static fromDate(date: Date): Timestamp;   // :3
static fromMillis(ms: number): Timestamp; // :4
get seconds(): number; get nanoseconds(): number;  // :8-9
toDate(): Date;                     // :11
```
- import は modular re-export 経由: `import { Timestamp, serverTimestamp } from '@react-native-firebase/firestore'`。
- **書き分け**:
  - `createdAt`（Post）/ `lastPostAt`（Member）: **`serverTimestamp()`**（ルール整合・サーバ時刻）。
  - `startDate`/`endDate`（Trip, ユーザー指定の Date）/ `expiresAt`（InviteCode）: **`Timestamp.fromDate(d)`**（ドメインの Date をそのまま固定）。
- **読み**: `adapters.ts` の `tsToDate(ts)` で `ts?.toDate()`、null/undefined は安全に undefined（`lastPostAt` 欠落は undefined のまま、`types.ts:21` が optional）。

---

## §8 まとめ（実装者への確定回答）

| # | 確認事項 | 確定回答 |
|---|---|---|
| 1 | API スタイル | **modular API 統一**。namespaced は v24 で deprecation warning（strict で throw）。`getAuth`/`getFirestore`/`collection`/`doc`/`onSnapshot`/`runTransaction`/`serverTimestamp` 等を named import。tx 内の読みは `tx.get`。 |
| 2 | app 初期化 | config plugin 自動初期化で足りる（`getApp()` 参照のみ、`initializeApp` 不要）。import 副作用は native 解決が関数内 lazy だが、**設計どおり import しない**のが安全。 |
| 3 | 匿名サインインの窓 | `getCurrentUser()` 同期契約は不変。構築時に**暫定匿名 AuthUser 即返し**＋`onAuthStateChanged` 解決後 `subscribe` で上書き通知。getCurrentUser の Promise 化は禁止（interface 不変）。 |
| 4 | node 隔離 | テスト・src は context/firebase を import せず（grep 0）。`firebase/**` に `.test.ts` 作らない＝testMatch 非該当。`selectRepositories()` の function 内 require が glass-surface 前例より安全。フラグは定数 `false` 固定。 |
| 5 | 純関数再利用 | `assignColorsToTrip(trip)` / `pickColorForJoiner(trip)` を tx 内で再利用。`status:'active'` 付与は呼び出し側。写経元 `mock-trip-repository.ts:134-146`（assignColors）/ :92-132（join）。 |
| 6 | nonce 整合 | `rawNonce` 生成→`sha256` を `signInAsync({nonce})`→返 `identityToken` と **rawNonce** を `AppleAuthProvider.credential(idToken, rawNonce)`。**expo-crypto 未インストール**＝SHA-256 手段が無い。本Issueは継ぎ目（ヘルパ TODO）で型を通し、依存追加はArchitectに確認。 |
| 7 | serverTimestamp vs fromDate | ルール `serverTimestamped()` が `lastPostAt==request.time` 強制 → `createdAt`/`lastPostAt` は **serverTimestamp() 必須**。`startDate`/`endDate`/`expiresAt` は `Timestamp.fromDate`。読み戻しは `new Date()` 暫定補完。 |

---

## 型整合（§6 補強）

- `Repositories`（`types.ts:197-203`）は **5 フィールド全要求**: `auth/trips/posts/uploadQueue/imageProcessor`。`createFirebaseRepositories(): Repositories` は5つ全て返さないと型エラー。
- `imageProcessor` / `uploadQueue` も束に含む点（設計の注意どおり）。`createMockRepositories`（`mock/index.ts:18-32`）の組み立てが写経元: `uploadQueue` は `posts.promotePhoto` を注入（:21-24）。Firebase 版も **posts を先に const 化 → uploadQueue へ注入**の順を踏襲。
- 本Issueの Firebase ファクトリでも `imageProcessor` は Mock 流用（`MockImageProcessor`）か Firebase 用スタブで型を満たせば良い（実 Storage は §9-7）。uploadQueue の `store` は `createAsyncStorageStore()`（native だが「呼ばない」隔離、storage.ts 前例）。

---

## リスク箇所 3件（壊しうる / 落とし穴 / テスト手薄）

### R-A【最重要・壊しうる】modular / namespaced 混在で deprecation 警告 or strict 例外
- 根拠: `app/dist/module/common/index.js:683-708`。namespaced 呼び出し（`firestore().collection()`）は `warnIfNotModularCall` を通り、`RNFB_MODULAR_DEPRECATION_STRICT_MODE` で throw。
- 落とし穴: コピペ元の古いブログは namespaced 例が多く、Implementer が混ぜると実機で警告/例外。**全 API を named modular import で統一**。レビュー必須項目: `firestore()` / `auth()` の呼び出し形が混入していないか grep。

### R-B【壊しうる・ルール齟齬】`lastPostAt`/`createdAt` を `Timestamp.fromDate(new Date())` で書くと posts/member 更新がルールで reject
- 根拠: `firestore.rules:115-120`（`lastPostAt == request.time`）＋ `:104-110`（rateOk）。クライアント時刻だと `== request.time` 不一致で `allow update` 不成立。
- 落とし穴: §8-7 のとおり **必ず `serverTimestamp()`**。`Timestamp.fromDate` を全時刻に一律適用すると promotePhoto / toggleReaction がゲートC で全滅する。本Issueは型のみで通るため**気付きにくい**（実挙動検証なしの盲点）。adapters の書き分けを「createdAt/lastPostAt=serverTimestamp、startDate/endDate/expiresAt=fromDate」と明示コメントで固定する。

### R-C【落とし穴・依存欠落】Apple nonce の SHA-256 手段（expo-crypto）が依存に無い
- 根拠: `package.json` に `expo-crypto` 記載なし / `node_modules/expo-crypto` 不在（§0）。一方 nonce 整合（§8-6）は SHA-256 を要求。
- 落とし穴: Implementer が `expo-crypto` を勝手に追加すると config plugin / ビルド構成（`useFrameworks: static`）への影響が未検証のまま混入。逆にハッシュ無しで raw を `signInAsync({nonce})` に渡すと Firebase 照合に失敗（ゲートC で発覚）。**本Issueは型クリーン＋結線がゲート**なので、nonce ハッシュ箇所はヘルパ関数の継ぎ目（TODO / 引数で受ける形）に留め、依存追加の是非は Architect に差し戻す。

### （補足・テスト手薄）firebase/** はテストゼロ＝型のみが防御線
- `firebase/**` には `.test.ts` を作らない（node 汚染回避）ため、本Issueのバグ検出は **tsc の型チェックのみ**。Timestamp 変換漏れ（`adapters.ts` 外に Firebase 型を漏らさない）・onSnapshot の unsubscribe 返却（`onSnapshot` は `Unsubscribe` を返す＝`subscribeToX` でそのまま return）・tx 内の読み順（全 `tx.get` を書き込み前に）を、型と目視レビューで担保する。実挙動はゲートC。

---

## 参考前例（リポジトリ内）

1. **動的 require ガード**: `src/components/glass-surface.tsx:30-42`（`Platform.OS` ガード内 `require` + try/catch でネイティブ未リンクを握る）。`selectRepositories()` の写経元。
2. **native を import するが node で呼ばない DI 隔離**: `src/repositories/storage.ts:1-28`（コメントが隔離原理を明記）。uploadQueue の `store` 注入で踏襲。
3. **核トランザクションの Mock 実装**: `src/repositories/mock/mock-trip-repository.ts:134-146`（assignColors）、:92-132（joinTrip）。runTransaction 版の写経元。
