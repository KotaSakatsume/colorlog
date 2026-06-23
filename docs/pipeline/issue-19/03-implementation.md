# 03-implementation.md — Firebase 実装層（§9-5）

- **Issue: #19**
- **Stage: 3/5 Implementer**
- 入力: `01-design.md`（Architect）+ `02-research.md`（Investigator）
- ブランチ: `pipeline/issue-19`（main 直コミットなし・**未コミット**）
- ゲート: `tsc --noEmit` = **0** / `jest` = **79 不変** / Expo Go・node に native を漏らさない隔離
- 実機検証（実 Firestore 接続・onSnapshot・Apple 実フロー）は **ゲートC（EAS Dev Build）後**。本Issueでは行わない。

---

## 検証結果

| ゲート | 結果 |
|---|---|
| `npx tsc --noEmit` | **0 エラー**（modular API の型で全クリーン） |
| `npx jest` | **8 suites / 79 tests passed**（不変） |
| `npx jest --listTests` | 8 ファイル・**firebase は出ない**（`.test.ts` 未作成） |
| `npx expo config --json` | OK（壊れていない） |
| native 静的 import（firebase/ 外） | **NONE**（grep 0・新規漏れなし） |
| modular 統一（namespaced `firestore()`/`auth()`） | コメント以外ヒット 0 |

---

## 変更ファイル一覧と各意図（1行ずつ）

### 新規（`src/repositories/firebase/` に隔離・`.test.ts` を作らない＝node 非対象）
| ファイル | 変更意図 |
|---|---|
| `firebase/adapters.ts` | Timestamp⇄Date と doc⇄domain マッピングを1か所集約。**R-B 書き分け**（createdAt/lastPostAt=serverTimestamp、startDate/endDate/expiresAt=Timestamp.fromDate）をコメントで固定。 |
| `firebase/firebase-app.ts` | `getApp()` 経由で Auth/Firestore を返す modular 窓口（config plugin 自動初期化前提・initializeApp 不要）。 |
| `firebase/firebase-auth-service.ts` | `AuthService` 実装。匿名サインイン窓を暫定 user 即返しで埋め、Apple 連携を expo-crypto nonce 整合で結線。 |
| `firebase/firebase-trip-repository.ts` | `TripRepository` 実装。assignColors/joinTrip を runTransaction（tx.get）+ 既存純関数再利用、createTrip は batch、ID はドメイン ID。 |
| `firebase/firebase-post-repository.ts` | `PostRepository` 実装。promotePhoto/toggleReaction を runTransaction、posts は orderBy+limit(50)、reactions 非正規化。 |
| `firebase/photo-uploader.ts` | `PhotoUploader` interface + `createPassthroughUploader()`（§9-7 継ぎ目・uri passthrough スタブ）。 |
| `firebase/index.ts` | `createFirebaseRepositories(): Repositories` ファクトリ。5フィールドを束ねる。**起動経路から静的 import されない。** |

### 変更
| ファイル | 変更意図 |
|---|---|
| `src/repositories/context.tsx` | `selectRepositories()` を追加（Platform/isExpoGo/`FIREBASE_ENABLED=false` ガード内で動的 `require('@/repositories/firebase')` + try/catch、既定 Mock）。`expo-constants`/`Platform` import 追加。 |
| `package.json` / `package-lock.json` | `npx expo install expo-crypto`（Apple nonce 用・オーケストレータ承認済み）。 |

**触っていない**: `src/domain/**`、`src/repositories/mock/**`、`src/repositories/types.ts`（interface 不変）、画面、`tests/**`、`jest.config.js`、`firestore.rules`。

---

## Investigator リスク箇所 3件への対応

### R-A【modular / namespaced 混在で警告・strict 例外】
- **対応**: firebase/ 配下の全 Firestore/Auth 呼び出しを **named modular import** に統一
  （`getAuth`/`getFirestore`/`collection`/`doc`/`onSnapshot`/`runTransaction`/`writeBatch`/
  `serverTimestamp`/`arrayUnion`/`increment` 等）。`firestore()`/`auth()` 形は1つも書いていない
  （grep でコメント以外ヒット 0）。tx 内の読みは `tx.get`（`getDoc` ではない）。

### R-B【`lastPostAt`/`createdAt` を fromDate で書くとルールで reject】
- **対応**: `adapters.ts` に書き分けを集約・コメントで固定。
  - `createdAt`（Post）= `serverTime()`（`serverTimestamp()`）＝ `postToData()` が必ず載せる。
  - `members[uid].lastPostAt`（promotePhoto の trip update）= `serverTime()`。
  - `startDate`/`endDate`/`expiresAt` = `dateToTs()`（`Timestamp.fromDate`）。
  - 読み戻しは serverTimestamp 未解決の瞬間 `new Date()` 暫定補完（onSnapshot で後追い確定）。

### R-C【Apple nonce の SHA-256 手段（expo-crypto）が依存に無い】
- **対応**: 段取り 2 の指示どおり `npx expo install expo-crypto` で依存追加（**オーケストレータ承認済み**）。
  `firebase-auth-service.linkWithApple()` で
  `rawNonce = Crypto.randomUUID()` → `hashedNonce = digestStringAsync(SHA256, rawNonce)` を
  `signInAsync({ nonce: hashedNonce })` へ、返った `identityToken` と **rawNonce（ハッシュ前）** を
  `AppleAuthProvider.credential(idToken, rawNonce)` → `linkWithCredential`。継ぎ目スタブではなく実結線。

---

## 主要実装の要点

- **Expo-Go-safe 差し替え（context.tsx）**: `FIREBASE_ENABLED=false` 既定。
  `Platform.OS!=='web' && !isExpoGo && FIREBASE_ENABLED` のガード内でのみ動的 `require`。
  firebase を静的 import しない＝Expo Go/node の起動バンドルに native が乗らない（R1/R2）。
  `firebase/**` に `.test.ts` を作らないため jest は拾わない（listTests に firebase 非表示）。
- **匿名サインインの同期窓（§8-3）**: `getCurrentUser()` は同期契約のまま。構築時に
  `currentUser` があればそれ、無ければ暫定匿名 AuthUser を即返し、`onAuthStateChanged` 解決後に
  `subscribe` リスナーへ確定値を流す。未サインインなら `signInAnonymously` を fire-and-forget で起動。
- **核トランザクション（R4）**: `assignColors` は `assignColorsToTrip(trip)` 純関数を tx 内再利用
  （配布済みは `ColorsAlreadyAssignedError`＝二重配布が原理的に起きない）。`joinTrip` は
  `pickColorForJoiner(trip)` 再利用 + `arrayUnion(自uid)`/`members[uid]` 追加のみ（ルール `isJoiningSelf` 整合）。
  `promotePhoto`/`toggleReaction` は集計更新と doc 書き込みを同一 runTransaction。
- **ファクトリ（型整合）**: `imageProcessor` は既存 `ExpoImageProcessor` 流用、`uploadQueue` は既存
  `MockUploadQueue` に `posts.promotePhoto` 注入 + `createAsyncStorageStore()`（オフライン送信キューは
  Firebase 化対象外・継ぎ目維持）。`posts` を先に const 化してから uploadQueue へ注入（mock/index.ts 同手順）。

---

## テストについて

- 設計・段取りの**絶対制約に従い `firebase/**` に `.test.ts` を作っていない**（node 汚染回避＝79 不変の前提）。
  本Issueのバグ検出ラインは **tsc の型チェック + 目視レビュー**（実挙動はゲートC後）。
- 既存 79 テスト（Mock 経路・domain）は全て不変でグリーン。Mock 実装・types interface・rules を
  一切変更していないため回帰リスクなし。

---

## Reviewer 申し送り

1. **設計準拠**: スコープは設計 §5 の影響ファイル（新規7 + context.tsx）に限定。`types.ts` interface は
   不変、domain/mock/rules/画面/tests は未変更。実 Storage（§9-7）・既定有効化はやらないこと通り未実装。
2. **隔離の確認観点**（レビュー必須）: `context.tsx` が firebase を静的 import していないこと（require のみ）、
   `firebase/**` に `.test.ts` が無いこと、native 静的 import が firebase/ 外に漏れていないこと。いずれも grep 済み。
3. **設計どおりだが要レビュー判断の点（申し送り）**:
   - **reactions の mine 解決**: `subscribeToTripReactions` は posts 購読時に各 post の `reactions/{userId}`
     を個別 `getDoc` で後追い補完し、counts を即時1回 + mine 確定後にもう1回 listener へ流す2段通知にした。
     設計 §3-3 が「読み取り最小化を Implementer/Investigator が確定」としていた箇所。post 件数ぶんの
     追加読み取りが発生するため、ゲートC でコスト/挙動を確認のうえ collectionGroup 等への最適化余地あり
     （本Issueは型クリーン + 結線がゲートのため最小実装に留めた・スコープ外最適化はしない）。
   - **firestore.rules に reactions サブコレクションの match が無い**（firestore.rules:142-155 は posts まで）。
     toggleReaction の reactions 書き込みはゲートC でルール追加が要る可能性。本Issueはルール変更が
     やらないこと/スコープ外のため**ルールは触っていない**。設計・ルール担当への申し送りとして記録。
   - **promotePhoto の差し替え時、旧 post の reactions サブコレクション掃除**は本実装では行っていない
     （tx 内でサブコレクション列挙は不可・Mock も discardReactions は集計破棄のみ）。孤児 reactions の
     クリーンアップ方針はゲートC で別途確定が必要。
4. **未コミット**: 段取り指示どおりコミットしていない。Integrator 段階でコミット整形する前提。

---

## 差し戻し修正（04-review.md 反映・2巡目）

レビュー 04-review.md の must 1件 + should 3件に対応した。本巡で `firestore.rules` /
`tests/rules/firestore.rules.test.ts` を**新たに変更スコープに追加**（must の reactions 対応に必須）。

### 変更ファイル（2巡目）
| ファイル | 変更意図 |
|---|---|
| `firestore.rules` | posts 配下に `match /reactions/{uid}`（read=メンバー、create/update/delete=自 uid かつメンバー、絵文字は確定集合）を追加。posts に `allow update`（reactionCounts のみ・他フィールド改竄不可）を限定許可。`isPostMember()` ヘルパへ get() を集約。trips/posts(create)/inviteCodes は不変。 |
| `tests/rules/firestore.rules.test.ts` | reactions と posts(reactionCounts update) の許可/拒否を両側追加（後述）。 |
| `src/repositories/firebase/firebase-post-repository.ts` | promotePhoto を決定的 postID + tx.get 1回 + increment(1) に変更（should #4）。caption 200字検証を書き込み前に追加（should #5）。subscribeToTripReactions の二重通知を解消し mineCache でちらつき抑制 + ゲートC最適化 TODO（should #6）。 |

### must 修正（reactions が本番で動く）— 対応済み
- **rules**: `trips/{tripId}/posts/{postId}/reactions/{uid}`
  - `read: isPostMember()`
  - `create, update: isPostMember() && uid == request.auth.uid && emoji in ['❤️','😍','👏','🔥','😂']`
  - `delete: isPostMember() && uid == request.auth.uid`
  - 絵文字集合は `src/domain/types.ts` の `REACTION_EMOJIS` と完全一致（rules は固定文字列で表現）。
- **posts update 限定許可**: `isPostMember() && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactionCounts'])`。
  非正規化 `reactionCounts` の `increment` を許しつつ userId/caption/slotIndex 等の改竄を不可。
- **toggleReaction が本番で動かない問題は解消**: reactions set/delete も postRef の reactionCounts update も
  ルールで許可されるようになった（従来は両方 deny → 100%失敗）。

### should 修正
- **#4 promotePhoto tx 競合**: post ID を `${uid}_${slotIndex}` の決定的キーにし、`getDocs(query)`（非tx）を廃止して
  `tx.get(postRef)` 1回に。新規時のみ `increment(1)` で postCount 原子加算、差し替えは据え置き。
  同 slot 並行昇格でも両者が同一 doc を get → 後勝ちで二重作成・二重加算が起きない。ルール postCount<=9 と整合。
- **#5 caption 200字検証**: promotePhoto 冒頭（slotIndex 検証の隣）で `trim().length > 200` を明示エラーに。
  ルール `caption.size() <= 200` と一致し、実機での無言 reject を回避。
- **#6 subscribeToTripReactions 二重通知**: 即時 `listener` を廃し、mine 解決後の1回のみ通知。
  `mineCache` を snapshot 跨ぎで保持し counts 更新時の mine ちらつきを抑制。完全最適化（post単位 onSnapshot 分割 /
  collectionGroup）は実機検証が要るため TODO コメントで**ゲートC送り**に留めた。

### 追加した rules テスト（両側）
- posts update: reactionCounts のみ update 許可 / caption 同時改竄拒否 / userId・slotIndex 改竄拒否 / 非メンバー update 拒否。
- reactions: 自分 set 許可 / 自分 delete 許可 / 他人 uid set 拒否 / 不正絵文字拒否 / 非メンバー read 拒否 / メンバー read 許可 / 非メンバーは自 uid でも set 拒否。

### 2巡目 検証結果
| ゲート | 結果 |
|---|---|
| `npm run test:rules`（emulator + Temurin Java 21） | **56 passed / 2 suites**（reactions・posts update の新テスト含む・全 pass） |
| `npx tsc --noEmit` | **0 エラー** |
| `npx jest`（デフォルト） | **79 passed**（不変・firebase 非混入維持） |
| `npx jest --listTests | grep firebase` | **0 件**（隔離維持） |

### 再レビュー申し送り
- **本番ルールの再デプロイはユーザーが行う**。本PRは `firestore.rules` のソース更新 + エミュレータ検証（`npm run test:rules` 全 pass）までで、`firebase deploy --only firestore:rules` は未実行。
- promotePhoto を決定的 postID 化したことで、旧実装の「新規 postId へ create + 旧 doc delete」差し替えから
  「同一 doc 上書き」差し替えへ挙動が変わった。旧 post の reactions サブコレクション掃除は tx 内列挙不可のため
  本巡でも未対応（ゲートC で方針確定）。Mock の discardReactions は集計破棄のみで整合。
- domain/型/Mock/jest.config.js は不変。strict 維持。コミットは Integrator 段階。
