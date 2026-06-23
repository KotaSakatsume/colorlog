# 01-design.md — Firebase 実装層（§9-5）

- **Issue: #19**
- **Stage: 1/5 Architect**
- 対象: `@react-native-firebase` v24 で Auth/Trip/Post を実装し、`context.tsx` 1か所差し替えで Mock→Firebase。Storage 実装・実機検証は別Issue。
- 検証境界: 本Issueのゲートは **`tsc --noEmit` 0 / 既存 jest 79 不変 / Expo Go・node に native を漏らさない隔離**。実挙動（実機/シミュレータ + 実 Firestore）は **ゲートC（EAS Dev Build）後**で本Issueでは行わない。

---

## 1. 方針サマリー + サブ分割の提案

### 方針（1行）
`src/repositories/firebase/` に native 隔離した Firebase 実装一式を置き、`context.tsx` を **「動的 require ガード付きファクトリ」** に変えて既定は Mock・Dev Build でのみ Firebase を解決する形にする（Firebase コードを Expo Go/node の起動バンドルに静的 import しない）。

### サブ分割の提案（規模「大」）
3層（差し替え機構 / Auth / Trip / Post）を **1 PR にまとめる**ことを推奨する。理由:
- 「Mock→Firebase 差し替え」はファクトリ・Timestamp アダプタ・3 Repository が**揃って初めて型が閉じる**（`Repositories` 型は5フィールド全てを要求。Auth だけ Firebase 化すると `createFirebaseRepositories` が型エラー、もしくは Mock との混成という設計外の状態になる）。
- 本Issueは「実挙動検証なし・tsc/型のみ」がゲートなので、3実装を同時に出してもレビュー対象は型と隔離だけ。PR を割るより**境界の一貫性**を保つ方が手戻りが少ない。
- ただし**レビュー単位**としては investigator/implementer 向けに「①差し替え機構+Timestampアダプタ → ②Auth → ③Trip → ④Post」の順で**コミットを分ける**。1 PR・複数コミットが最適。

**本Issueでやり切る範囲**: 差し替え機構（ファクトリ + ガード）・Timestamp アダプタ・FirebaseAuthService・FirebaseTripRepository・FirebasePostRepository（reactions 含む）・`firebase-uploader` 注入の継ぎ目（スタブ）。
**本Issueで配線しない**: 実 Storage アップロード本体（§9-7）・既定の Firebase 有効化（既定は Mock のまま）。

---

## 2. Expo-Go-safe な差し替え機構（最重要）

### 確定方式: 「`createMockRepositories` 既定 + 動的 require ガード付き `createFirebaseRepositories`」
`storage.ts` の前例（native を import しても **呼ばなければ** node では無害）は **import 自体が無害なケース**だが、`@react-native-firebase/app` は **import 時にネイティブ TurboModule を解決しようとし、Expo Go では即クラッシュ**しうる（glass-effect と同じ轍）。したがって本Issueは **「import すらしない」** を満たす必要がある。確定する手段:

1. **`firebase/index.ts` を起動経路から静的 import しない。** `context.tsx` は `@/repositories/firebase` を**トップレベル import しない**。
2. **`context.tsx` に実行時ガード関数 `selectRepositories()` を置く。**
   ```ts
   import Constants, { AppOwnership } from 'expo-constants';
   const isExpoGo = Constants.appOwnership === AppOwnership.Expo;
   const FIREBASE_ENABLED = false; // 本Issueでは既定 false（安全側）。Dev Build で true 化。
   ```
3. **Firebase 解決は `Platform.OS !== 'web' && !isExpoGo && FIREBASE_ENABLED` のガード内で `require` する**（glass-effect の「`Platform.OS` ガード内 動的 require + try/catch」前例に揃える）。
   ```ts
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
   ```
   `useMemo(() => selectRepositories(), [])` で呼ぶ。
4. **node テスト保証**: テストは `context.tsx` を import しない（確認済み: `grep` でヒット0）。仮に import されても `FIREBASE_ENABLED=false` かつ require はガード内なので `firebase/` は評価されない。**`firebase/**` に `.test.ts` を一切作らない**（`testMatch` 由来で jest が拾わない＝listTests に出ない）。

### Firebase 有効化の切り替え
本Issueでは `FIREBASE_ENABLED = false` 固定（既定 Mock）。Dev Build での有効化は「定数を true にする」or「`expo-constants` の `extra` フラグ参照」のどちらでも良いが、**フラグの環境変数化はゲートC以降の別Issue**。本Issueは「true にすれば Firebase 経路が解決される配線」までを型クリーンで用意する。

---

## 3. 各実装の設計

> 全実装は `src/repositories/types.ts` の interface に厳密準拠（シグネチャ変更不可）。`@react-native-firebase` v24 の **modular API か namespaced API か**は Investigator 確認事項（§8）。以下は API 形に依存しない設計意図を記す。

### 3-1. FirebaseAuthService（`AuthService`）
- **起動**: 構築時に `onAuthStateChanged` を購読。既存ユーザーが無ければ匿名サインイン（`signInAnonymously`）を起動。最新の Firebase user を `mapFirebaseUserToAuthUser()` で `AuthUser` に変換しキャッシュ。
- `getCurrentUser()`: キャッシュした `AuthUser` を同期返却（interface が同期のため、構築直後に値が無い窓を避ける = **匿名サインイン完了まで暫定 user を持つ or Provider で `start()` を待つ**かは Investigator が現状の `useCurrentUser` 即時要求と突き合わせて決める。設計既定は「構築時に暫定匿名 user を即返し、解決後 `subscribe` で上書き通知」）。
- `subscribe(listener)`: `onAuthStateChanged` をラップ。登録直後に現在値を即時通知（Mock と同契約）。`displayName` 欠落は SPEC の表示名規約でフォールバック。
- `updateProfile(patch)`: Firebase `currentUser.updateProfile` を呼び、ローカルキャッシュ更新 → listener 通知。interface は同期 void なので **fire-and-forget**（Mock と同じ）。
- `linkWithApple()`: `expo-apple-authentication` の `signInAsync({ requestedScopes: [FULL_NAME, EMAIL] })` → 取得した `identityToken`（+ `nonce` / `rawNonce`）から Firebase `AppleAuthProvider.credential(...)` を作り `currentUser.linkWithCredential(credential)`。成功で `isAnonymous=false` の `AuthUser` を返す。既に連携済みなら冪等（現ユーザー返却・通知なし）。**nonce のハッシュ整合**（Apple は raw nonce、Firebase は sha256 ハッシュ要求）は Investigator が v24 の正しい API で確認。

### 3-2. FirebaseTripRepository（`TripRepository`）
- **データ形（§4 マッピング）**: `trips/{tripId}` ドキュメント。`members` は**マップ内包**、`memberIds` は**配列**、`status`/`colorsAssigned`/`hostUserId` はそのまま。時刻フィールド（`startDate`/`endDate`/`members[uid].lastPostAt`）は Firestore `Timestamp`、ドメイン境界で `Date` 変換（§4 のアダプタ）。
- `subscribeToUserTrips(userId, listener)`: `collection('trips').where('memberIds', 'array-contains', userId).onSnapshot(...)` → 各 doc を `tripFromDoc()` で `Trip` に変換し配列で流す。
- `subscribeToTrip(tripId, listener)`: `doc('trips/{tripId}').onSnapshot(...)`。存在しなければ `null`。
- `getTrip` / `resolveInviteCode` / `getInviteCodeForTrip`: 単発 `get()`。`resolveInviteCode` は `code.trim().toUpperCase()` 正規化 + `expiresAt < now` を null 扱い（Mock と同一規約）。
- `createTrip`: Mock と同じ入力検証（名前必須・終了≥開始・開始≥今日）→ `trip` doc と `inviteCodes/{code}` doc を **batch write**。ID 採番は既存 `@/domain/id` の `generateId`/`generateInviteCode` を再利用（Firestore 自動IDではなくドメインID採用で Mock と一致）。
- `joinTrip`: `runTransaction` 内で trip 取得 → 参加済みなら冪等返却 → 上限(`MAX_MEMBERS`)チェック → `colorsAssigned` なら `pickColorForJoiner(trip)` で1色 → `members[uid]` 追加 + `memberIds` に `arrayUnion`。**ルールの `isJoiningSelf()` と整合**するよう、書き込みは自分の uid 追加のみ。
- `deleteTrip`: trip 削除 + 関連 `posts` サブコレクション + `inviteCodes` の掃除。**サブコレクションはクライアントから一括削除できない**ため、posts を列挙して batch 削除（件数は小さい＝最大 12人×9枚）。存在しない tripId は no-op（冪等）。
- `assignColors`（核トランザクション）: **`runTransaction`** で trip doc を読み、**既存純関数 `assignColorsToTrip(trip)` を再利用**して新 `members`/`colorsAssigned` を計算 → `status:'active'` も付けて書き戻し。配布済みなら `assignColorsToTrip` が `ColorsAlreadyAssignedError` を投げる＝二重配布が原理的に起きない（Mock と同じ不変条件）。**純関数は再実装しない。**

### 3-3. FirebasePostRepository（`PostRepository`）
- **データ形（§4）**: `trips/{tripId}/posts/{postId}` サブコレクション。`postCount`/`lastPostAt` は親 trip の `members[uid]` 側（§4）。
- `subscribeToTripPosts`: `collection('trips/{tripId}/posts').orderBy('createdAt','desc').limit(50).onSnapshot(...)`（§13 コスト規律）。`postFromDoc()` で `Timestamp→Date` 変換。
- `promotePhoto`（核トランザクション）: **`runTransaction`** で
  1. trip 取得 → `isTripOver` / `member.color` 必須 / `slotIndex` 範囲チェック（Mock と同一規約）。
  2. 同 user・同 slot の既存 post を query（差し替え判定）。差し替えなら旧 post を新 post で置換（`postCount` 不変）、新規なら `postCount<9` を確認して +1。**`postCount≤9` 不変条件を tx 内で強制**（ルール §7 と整合）。
  3. **画像 URL は注入 `uploader` から得る**（下記継ぎ目）。本Issueでは uploader スタブが `localImage.uri` をそのまま返す＝Mock と同じ挙動（実 Storage は §9-7）。
  4. post doc 書き込み + 親 trip の `members[uid].postCount`/`lastPostAt` 更新を**同一 tx**で。差し替え時は旧 post の reactions も破棄（孤児防止）。
- **画像アップロードの継ぎ目（§9-7 へ）**: `interface PhotoUploader { upload(input): Promise<{ imageURL: string; thumbURL: string }> }` を `firebase/` に定義し、`FirebasePostRepository` のコンストラクタ注入にする。本Issueは **`createPassthroughUploader()`（uri をそのまま返すスタブ）** を注入。実 Storage 実装（`@react-native-firebase/storage`）は別Issueで差し込むだけ。**Storage 実コードは本Issueで書かない。**
- `subscribeToTripReactions` / `toggleReaction`（将来 Firestore 設計）: 設計を確定し**配線まで実装**する。
  - 形: `trips/{tripId}/posts/{postId}/reactions/{uid}` に `{ emoji }` を1人1ドキュメント（1人1リアクション制）。集計は post doc 側に**非正規化 `reactionCounts: Record<emoji, number>`** を持ち、`toggleReaction` を **`runTransaction`** で「旧 emoji -1 / 新 emoji +1（`FieldValue.increment`）+ `reactions/{uid}` の set/delete」を原子的に行う（§13 非正規化でフィードの読み取りコストを抑制）。
  - `subscribeToTripReactions(tripId, userId, listener)`: posts の `onSnapshot` から `reactionCounts` を読み、`reactions/{userId}` の自分の値で `mine` を解決して `Map<postId, ReactionSummary>` を流す。**自分の mine は `reactions` の自 doc 購読 or posts 購読時に補完**（読み取り最小化を Investigator/Implementer が確定）。

---

## 4. Timestamp ⇄ Date 変換アダプタ

- **置き場所**: `src/repositories/firebase/adapters.ts`（firebase 隔離ディレクトリ内・**1か所に集約**）。domain/Mock/画面/node テストからは import しない。
- **方針**:
  - 読み（doc→domain）: `tsToDate(ts: FirebaseFirestoreTypes.Timestamp | null | undefined): Date` と、`tripFromDoc` / `postFromDoc` / `inviteFromDoc` の**ドメイン変換関数**を adapters に集約。null/undefined Timestamp は安全に扱う（欠落 `lastPostAt` は undefined のまま）。
  - 書き（domain→doc）: `dateToTs(d: Date)` or 書き込み時 `Timestamp.fromDate(d)`。`createdAt` 等のサーバ時刻は **`serverTimestamp()`** を使うか `Timestamp.fromDate(new Date())` かを Investigator が v24 仕様 + ルール（レート制限）と突き合わせて確定（既定: 作成系は `serverTimestamp()`、ドメインへ返す直前にローカル `Date` 補完）。
  - ドメイン型（`Trip`/`Post`/`InviteCode`）は **`Date` のまま不変**。Firebase 型はこのファイル外に漏らさない。

---

## 5. 影響ファイル一覧（新規 / 変更）

### 新規（`src/repositories/firebase/` に隔離・全て node テスト対象外＝`.test.ts` を作らない）
| ファイル | 役割 |
|---|---|
| `firebase/index.ts` | `createFirebaseRepositories(): Repositories` ファクトリ。3実装 + passthrough uploader を組み立て返す。**起動経路から静的 import されない（require のみ）。** |
| `firebase/firebase-app.ts` | `@react-native-firebase/app` 初期化の単一窓口（明示初期化要否は §8 で確認。config plugin 自動初期化なら getApp 参照のみ）。 |
| `firebase/firebase-auth-service.ts` | `FirebaseAuthService implements AuthService`。 |
| `firebase/firebase-trip-repository.ts` | `FirebaseTripRepository implements TripRepository`。 |
| `firebase/firebase-post-repository.ts` | `FirebasePostRepository implements PostRepository`。 |
| `firebase/photo-uploader.ts` | `PhotoUploader` interface + `createPassthroughUploader()` スタブ（§9-7 継ぎ目）。 |
| `firebase/adapters.ts` | Timestamp⇄Date + `tripFromDoc`/`postFromDoc`/`inviteFromDoc`。 |

### 変更
| ファイル | 変更内容 | 規模 |
|---|---|---|
| `src/repositories/context.tsx` | `createMockRepositories()` 直呼び → `selectRepositories()`（ガード付き動的 require）。`expo-constants`/`Platform` import 追加。`FIREBASE_ENABLED=false`。 | 〜25行 |

- 想定総変更行数オーダー: **新規 〜500〜700行（7ファイル）+ context.tsx 〜25行**。型のみ通せばよく（実挙動はゲートC後）、ロジックは既存純関数/Mock規約の写経が中心。
- **触らない**: `src/domain/**`、`src/repositories/mock/**`、`src/repositories/types.ts`（interface 不変）、画面、`tests/**`、`jest.config.js`。

---

## 6. やらないこと（3点 + 補足）

1. **Storage アップロード実装**（§9-7・Blaze 待ち）。`promotePhoto` は注入 uploader の**継ぎ目（passthrough スタブ）のみ**。実 `@react-native-firebase/storage` コードは別Issue。
2. **App Check（App Attest, §13.3）**・**Web firebase JS SDK 混在**。本体は RNFirebase 統一、Web は対象外。
3. **実機 / シミュレータでの実挙動検証**（実 Firestore 接続・onSnapshot 動作・Apple 連携の実フロー）。**ゲートC（EAS Dev Build）後**。本Issueは tsc 0 / jest 79 不変 / 隔離のみがゲート。

補足で**やらない**: 既定の Firebase 有効化（`FIREBASE_ENABLED` は false 固定＝既定 Mock）。フラグの環境変数化はゲートC以降。

---

## 7. リスク

| # | リスク | 対策 / 緩和 |
|---|---|---|
| R1 | **Expo Go 漏れ**（Firebase が起動バンドルに乗りクラッシュ） | `context.tsx` をトップレベル import しない。`Platform.OS`/`appOwnership`/`FIREBASE_ENABLED` ガード内 `require` + try/catch（glass-effect 前例）。**`firebase/index.ts` を起動経路から静的 import しない**ことをレビュー必須項目に。 |
| R2 | **node テスト汚染**（jest が firebase を評価して reject） | `firebase/**` に `.test.ts` を作らない（listTests 非表示）。`context.tsx` をテストが import しない（確認済み）。require はガード内＝評価されない。jest 件数 79 不変を CI ゲート。 |
| R3 | **Timestamp 変換漏れ**（Date 期待箇所に Timestamp 流入で `.getTime()` 例外） | 変換を `adapters.ts` 1か所に集約。doc→domain は必ず `*FromDoc` 経由。Firebase 型を adapters 外に漏らさない（型でガード）。 |
| R4 | **トランザクション整合**（assignColors 二重配布 / promotePhoto の postCount 超過） | `assignColorsToTrip` 純関数を tx 内再利用（既存不変条件流用）。`promotePhoto`/`toggleReaction` の集計更新と doc 書き込みを**同一 runTransaction**に。 |
| R5 | **onSnapshot クリーンアップ漏れ**（リスナーリーク） | 各 subscribe は `Unsubscribe` を返す契約を厳守し、Firestore の unsubscribe をそのまま返す。画面側は既存 `useEffect` クリーンアップで解除（契約は Mock と同一）。 |
| R6 | **ルールとの齟齬**（クライアント書き込みがルールで弾かれる） | §7 ルール（`isJoiningSelf` / posts create の `userId==auth.uid` / inviteCodes read）に合わせて書き込み形を設計。join は自 uid 追加のみ、post は `userId` を自分に。**実検証はゲートC後**だが設計時点でルール条文と突き合わせ済み。 |

---

## 8. Investigator 確認事項

1. **RNFirebase v24 の正しい API スタイル**: v24 は **modular API（`getApp`/`getAuth`/`getFirestore`/`onSnapshot`/`runTransaction`/`signInAnonymously`/`linkWithCredential`/`AppleAuthProvider.credential`）か、従来の namespaced（`firebase.auth()`...）か**。v22 で modular 移行・namespaced 非推奨化の経緯があるため、**v24 の deprecation 状況と推奨形**を最新ドキュメントで確定（型のみで compile 可なことも確認）。
2. **`@react-native-firebase/app` の初期化要否**: config plugin（`app.json` に登録済み・`GoogleService-Info.plist` 設定済み）での**自動初期化で足りるか、明示 `initializeApp` が要るか**。Dev Build 前提での初期化タイミング。
3. **`context.tsx` / `createMockRepositories` の現状**: 現状 `useMemo(() => createMockRepositories(), [])`。`useCurrentUser` が**構築直後に `auth.getCurrentUser()` を同期要求**する点と、Firebase の匿名サインイン非同期解決の窓をどう埋めるか（暫定 user 即返し方針の妥当性）。
4. **node テストが `context.tsx` / firebase を import しないことの再確認**: 現時点 grep ヒット0。実装後も維持されること（とくに新規 firebase ファイルに `.test.ts` を作らない）。
5. **`assignColorsToTrip` のシグネチャ**: `assignColorsToTrip(trip: Trip, shuffle?: Shuffle): Trip`（`@/domain/assign-colors`）。tx 内で `status:'active'` 付与は呼び出し側責務（Mock 同様）。`pickColorForJoiner(trip, pick?)` も同様に再利用。
6. **Apple credential の nonce 整合**: `expo-apple-authentication` の `signInAsync` が返す `identityToken` と、Firebase `AppleAuthProvider.credential` が要求する `nonce`（raw / sha256 ハッシュ）の正しい組み合わせを v24 + expo SDK54 仕様で確定。
7. **serverTimestamp vs Timestamp.fromDate**: 作成系（`createdAt`/`lastPostAt`）にサーバ時刻を使う場合、ドメインへ返す直前のローカル `Date` 補完方法と、レート制限ルール（`lastPostAt`）との整合。
