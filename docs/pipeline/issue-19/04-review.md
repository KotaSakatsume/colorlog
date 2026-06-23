# 04-review.md — Firebase 実装層（§9-5）レビュー

- **Issue: #19**
- **Stage: 4/5 Reviewer**
- 基準: `01-design.md` / `02-research.md` / SPEC §4/§5/§7/§13 / `firestore.rules` / RNFirebase v24 modular / SDK54
- 検証: `npx tsc --noEmit` = **0**、`npx jest` = **79 passed / 8 suites**、`jest --listTests | grep firebase` = **0件**（隔離維持）。

---

## ゲート結果（机上 + 自動検証）

| ゲート | 結果 |
|---|---|
| tsc --noEmit | ✅ 0 エラー |
| jest | ✅ 79 passed（不変） |
| firebase/** に .test.ts 無し・listTests 非表示 | ✅ |
| native 静的 import 隔離（fb/apple/crypto が firebase/ 外に無い） | ✅ `grep` ヒット0 |
| context.tsx の firebase は動的 require のみ | ✅ require 行のみ |
| テストが context.tsx / firebase を import しない | ✅ ヒット0 |

---

## 観点別レビュー

### 1. Expo Go / node 隔離（最重要） — ✅ 確認済み: 該当なし（must級なし）
- `@react-native-firebase/*` / `expo-apple-authentication` / `expo-crypto` は `firebase/` 配下7ファイルのみが import。起動経路・domain・mock・画面・テストへの静的 import は `grep` で0件。
- `context.tsx:24` で `@/repositories/firebase` はトップレベル import されず、`selectRepositories()`（context.tsx:30-43）内の `Platform.OS !== 'web' && !isExpoGo && FIREBASE_ENABLED` ガード + try/catch + 動的 `require` のみ。`FIREBASE_ENABLED=false` 既定（context.tsx:21）。
- `firebase/**` に `.test.ts` 無し → `jest --listTests` 非表示を確認。隔離は設計 §2 / R1・R2 どおり。

### 2. modular API 統一（R-A） — ✅ 確認済み: 該当なし
- namespaced 形（`firestore().collection()` 等）は0件。`getApp`/`getAuth`/`getFirestore`/`onSnapshot`/`runTransaction`/`writeBatch`/`arrayUnion`/`increment` 全て modular。
- tx 読みは `tx.get`（trip-repo:173,230 / post-repo:119-120,174）。`getDoc` ではない。R-A 準拠。

### 3. serverTimestamp（R-B・must級観点） — ✅ 確認済み: 該当なし
- `createdAt`（adapters.ts:185 `postToData`）と `members[uid].lastPostAt`（post-repo:230）は `serverTime()` = `serverTimestamp()`。ルール `serverTimestamped()`（rules:120-126 `== request.time`）と整合。
- `startDate`/`endDate`/`expiresAt` は `dateToTs()` = `Timestamp.fromDate`（adapters.ts:153-154,168）。書き分けは adapters に集約。R-B どおり。

### 4. トランザクション整合 — should 1件
- `assignColors`（trip-repo:228-249）: `runTransaction` + `tx.get` + **既存純関数 `assignColorsToTrip(trip)` 再利用**（再実装でない・trip-repo:235）。配布済みは純関数が `ColorsAlreadyAssignedError`。R4 準拠。
- `joinTrip`（trip-repo:171-223）: `runTransaction` + `pickColorForJoiner(trip)` 再利用、書き込みは自 uid のみ（`arrayUnion` + members 自キー merge）。R6 / `isJoiningSelf` 整合。
- `toggleReaction`（post-repo:118-156）: 全 read（postRef, reactionRef）を write より前に実行。`increment` で原子的。read→write 順守。
- **[should] post-repo:188-194 — `promotePhoto` の tx 内 slot 検索が非トランザクショナル read**。`runTransaction` のコールバック内で `getDocs(slotQuery)` を呼んでいる。Firestore のトランザクションが整合性を保証するのは `tx.get` で読んだドキュメントだけで、`getDocs` は tx のロック対象外＝同 slot への並行昇格で「両方とも existing=null と判定 → 2 doc 作成 → postCount 二重 +1」が起こりうる。Mock は単一スレッドで顕在化しないが Firestore では実害。
  - 修正提案: slot の一意性は post doc の ID を `${uid}_${slotIndex}` のような決定的キーにして `tx.get(doc(...))` 1回で差し替え判定する（query 不要・tx 内整合）。または postCount の +1 を「親 trip の現在値からの再計算」ではなく `increment(1)` にしてカウントの競合だけでも原子化する。**実機経路（ゲートC後）でしか顕在化しないため should**。設計 §3-3 は「同 user・同 slot の既存 post を query」と書いており設計準拠ではあるが、設計自体がこの tx 不整合を見落としている。

### 5. 本番ルールとの齟齬（申し送り検証・must-flag） — **must（ゲートC前に要対応）**
- 申し送りは**事実**。`firestore.rules` を読んだ結果、`trips/{tripId}/posts/{postId}` の `match` は **`reactions` サブコレクションの `match` を持たない**（rules:175-189 が posts の最後、その後 `inviteCodes` へ）。
- 「明示許可以外は全 deny」方針（rules:9）のため、`trips/{tripId}/posts/{postId}/reactions/{uid}` への `set`/`delete`（post-repo:139,150）は**ルールで reject される**。さらに `toggleReaction` は同 tx で `tx.update(postRef, { reactionCounts.* })` を行うが（post-repo:154）、posts の `match` は `allow update` を**一切持たない**（create のみ・rules:182-188）＝ **reactionCounts の更新自体も deny**。
- 結論: **`toggleReaction` は実機（ゲートC後）で100%失敗する経路**。ルール追加は本Issueスコープ外（設計 §6 はルールに触れない）だが、**実装した機能が本番ルールで動かないことが確定している**ため、見落としを防ぐ意味で **must-flag（ゲートC前に必須対応）** とする。
  - 対応提案（別Issueでも可だが明記必須）: rules の posts match 配下に
    ```
    match /reactions/{uid} {
      allow read: if request.auth != null && request.auth.uid in get(.../trips/$(tripId)).data.memberIds;
      allow write: if request.auth != null && request.auth.uid == uid; // 1人1リアクション・自分のみ
    }
    ```
    を追加し、かつ posts の `allow update`（reactionCounts のみ変更・他フィールド不変・メンバー限定）を追加する。**この対応が入るまで toggleReaction はゲートCの検証項目に入れてはいけない**。
- なお `promotePhoto` の post `create`（post-repo:214）はルール rules:183-188（userId 本人・caption≤200・slotIndex 0..8）と整合。ただし **post-repo:219 で caption を `caption.trim()` するが長さ検証が無い** → 201字以上の caption はクライアントを通過し、ルールの `caption.size() <= 200` で reject される。Mock に長さ検証が無ければ挙動は揃うが、実機で「投稿が無言で失敗」する。→ 下記 should。

### 6. Apple nonce 整合（R-C） — ✅ 確認済み: 該当なし
- auth-service:108-119: `rawNonce = Crypto.randomUUID()` → `hashedNonce = SHA256(rawNonce)` を Apple `signInAsync({ nonce: hashedNonce })` へ。
- auth-service:134: `AppleAuthProvider.credential(idToken, rawNonce)`（第2引数に**ハッシュ前** rawNonce）→ `linkWithCredential`。Apple=hashed・Firebase=raw の結線は正しい。
- 冪等（連携済みは現ユーザー返却・通知なし auth-service:101-103）、`identityToken` 空ガード（auth-service:123）も妥当。

### 7. 型 / Repositories 束 — ✅（nit あり）
- `createFirebaseRepositories()`（index.ts:30-44）は `Repositories` 5フィールド全て返す。tsc 0 で型は閉じている。
- `imageProcessor` は `ExpoImageProcessor` 流用、`uploadQueue` は `MockUploadQueue` に `posts.promotePhoto` 注入（設計の継ぎ目維持）。
- onSnapshot の unsubscribe: 各 subscribe は Firestore の `onSnapshot` 戻り値をそのまま return（trip-repo:51,62 / post-repo:63,83）＝ Unsubscribe 契約 OK（R5）。
- Timestamp 変換は `*FromDoc` 経由に集約、Firebase 型が adapters 外へ漏れない（R3）。

---

## その他の指摘

- **[should] post-repo:219 — caption 長さ未検証**。`caption.trim()` のみで 200字上限チェックが無く、ルール `caption.size() <= 200`（rules:186）で実機 reject。Mock と挙動を揃えるため、Mock 側に検証があるか確認の上、無ければ両方に `if (caption.trim().length > 200) throw` を追加。あれば本ファイルにも同じ検証を足す。
  - 修正提案: `promotePhoto` 冒頭の slotIndex 検証（post-repo:162）の隣に `if (caption.trim().length > 200) throw new Error('キャプションは200字以内にしてください');`。
- **[should] post-repo:94-109 — `subscribeToTripReactions` の mine 解決が onSnapshot 発火ごとに N 回 getDoc**。posts 件数 × snapshot 発火回数だけ単発 `getDoc` が走り、§13 のコスト規律（読み取り最小化）に反する。また `Promise.all(...).then(listener)` と末尾 `listener(byPost)`（post-repo:109）で**毎回2回 listener が呼ばれ**、非同期の mine 解決が後から届くため最終的な mine 確定までに UI がちらつく/レースの可能性。
  - 修正提案: 自分の reactions は `trips/{tripId}/posts/{postId}/reactions/{uid}` を個別購読する代わりに、`collectionGroup('reactions')` を `where(uid)` で1購読にまとめるか、自分の mine 用に別 onSnapshot を1本張って counts 購読とマージする。最低限、即時の `listener(byPost)`（mine=null）と後追い `listener` の二重通知は、mine 解決後の1回に寄せる（counts だけ先に出したいなら mine を前回値で保持してから上書き）。実機未検証のため should。
- **[nit] auth-service:58 — 暫定匿名 user の `uid: ''`**。`getCurrentUser()` が `onAuthStateChanged` 解決前に呼ばれると `uid: ''` を返す。設計 §3-1 の「暫定 user 即返し」方針どおりだが、空 uid のまま `createTrip`(host.uid='') 等が走ると不正データになりうる。呼び出し側（ストア）が解決を待つ前提なら問題ないが、`uid: ''` を呼び出し側が弾けるようコメントで明示するか、解決まで mutation を抑止する契約を確認したい。実害は呼び出し側次第のため nit。
- **[nit] trip-repo:191-202 と 206-219 — joinTrip で更新オブジェクトを二重に構築**。`updated`（戻り値用）と `tx.set`（書き込み用）で members エントリをほぼ同じ内容で2回組み立てている。`memberToData` 相当を1関数に寄せると photoURL/color の `undefined` 除外ロジックの重複（trip-repo:213-214）が1か所になる。可読性のみ。
- **[nit] adapters.ts:34 `tsToDateRequired` の `?? new Date()`**。serverTimestamp 未解決の瞬間に `new Date()` で埋める設計意図はコメント済みだが、`startDate`/`endDate`/`expiresAt`（本来必ず存在すべき固定値）まで同じ関数で握りつぶすと、データ破損で Timestamp 欠落していても気づけない。createdAt 系（後追い確定が正当）と固定値系（欠落は異常）で扱いを分けるとデバッグしやすい。nit。

---

## 設計準拠の判定

- **スコープ逸脱なし**。新規7ファイルは設計 §5 の一覧と一致。`context.tsx` 変更は §5 の想定（〜25行・ガード付き require）どおり。`domain/**`・`mock/**`・`types.ts`・画面・`tests/**`・`jest.config.js` は未変更（diff stat で確認）。
- `package.json` に `expo-crypto` 追加（Apple nonce 用・R-C 起因）＝設計 §3-1/§8-6 の必然で逸脱でない。
- 設計との差分: **無し**。ただし設計 §3-3 自体が (a) reactions のルール欠落（観点5）と (b) tx 内 query の非整合（観点4 should）を見落としており、実装は設計に忠実なゆえにそれを引き継いでいる。

## テスト評価

- `firebase/**` に `.test.ts` を作らない方針は設計どおりで正しい（node で native 評価を避ける・jest 79 不変）。本Issueは「型 + 隔離」がゲートで実挙動はゲートC後のため、**ユニットテスト不在自体は設計準拠**。
- カバー漏れ（ゲートC後に必須の検証項目として申し送るべき）:
  1. `toggleReaction` の実ルール通過（観点5 が解消されるまで**失敗が確定**＝最優先）。
  2. `promotePhoto` 同 slot 並行昇格時の postCount 二重加算（観点4 should）。
  3. caption 201字での create reject（観点 should）。
  4. `joinTrip` の `isJoiningSelf` 通過（自 uid 追加のみ・他キー不変）。
  5. `assignColors` の `isHostAssigningColors` 通過（host のみ・構造系不変）。

## 総評: **要修正**

- **must が1件**（観点5: `toggleReaction` が本番ルールで100%失敗する経路。ルールに reactions match と posts update が無い）。ルール追加は本Issueスコープ外だが、**実装した機能が動かないことが机上で確定**しているため must-flag（ゲートC前に必須対応・別Issue起票可）として扱い、規定どおり **must が1件でも残れば「要修正」** とする。
- 併せて should 3件（tx 内 query 非整合・caption 長さ未検証・reactions 購読の N read & 二重通知）の対応を推奨。
- Implementer 段階へ差し戻し。最小対応は「(a) `toggleReaction` のルール非対応を README/申し送りに明記しゲートC検証項目から外す、または rules に reactions match + posts update を追加する別Issueを起票」+「(b) caption 長さ検証の追加」。tx query 非整合は設計に起因するため、設計差し戻し相当だが本Issueの型/隔離ゲートは満たすため should 据え置きで可。

---

# 04-review.md — 再レビュー（focused re-review・2回目）

- **Issue: #19**
- **Stage: 4/5 Reviewer（再レビュー）**
- 基準: 前回 04-review.md（must 1 + should 3）/ 本番 `firestore.rules` / `src/domain/types.ts` REACTION_EMOJIS / SDK54
- 自動検証（自分で実行）: `npx tsc --noEmit` = **0** / `npx jest` = **79 passed / 8 suites** / firebase 静的 import（firebase/ 外）= **0件** / `jest --listTests | grep firebase` = **0件** / `firebase/**` に `.test.ts` = **無し**。
- `npm run test:rules`（56件）は当環境にエミュレータ/Java が無いため自分では未実行。**パイプライン主宰がエミュレータで 56 pass を独立確認済み**との申し送りを前提に、ルール本文とテストを机上で突合した（下記）。

## 前回指摘の解消確認

### must（観点5）解消 — ✅ 解消
- `firestore.rules` の `trips/{tripId}/posts/{postId}` 配下に **`match /reactions/{uid}`** が追加された（rules:191-205 付近）。
  - `read`: `isPostMember()`（親 trip の memberIds を get() でメンバー判定）。
  - `create, update`: `isPostMember() && uid == request.auth.uid && isAllowedEmoji(request.resource.data.emoji)`（自 uid のみ・確定絵文字のみ＝なりすまし/集計汚染を封じる）。
  - `delete`: `isPostMember() && uid == request.auth.uid`（解除）。
- posts の `allow update` が追加され **`request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactionCounts'])`** に限定（rules: posts match 内）。userId/caption/slotIndex 等の投稿本体は改竄不可＝`toggleReaction` の `tx.update(postRef, { 'reactionCounts.*': increment() })`（post-repo:158）が通る一方、本体差し替えは引き続き deny。
- **絵文字集合の一致**: ルール `isAllowedEmoji` の `['❤️','😍','👏','🔥','😂']` は `src/domain/types.ts:109 REACTION_EMOJIS` と**完全一致**（順序含む）。
- **テスト追加**: `tests/rules/firestore.rules.test.ts` に
  - `posts update（reactionCounts のみ限定許可）` 4件（counts のみ許可 / caption 同時改竄 拒否 / userId・slotIndex 改竄 拒否 / 非メンバー 拒否）。
  - `reactions（自分のみ・許可絵文字・メンバー read）` 7件（自 set 許可 / 自 delete 許可 / 他人 uid set 拒否 / 不正絵文字 拒否 / 非メンバー read 拒否 / メンバー read 許可 / 非メンバー自 uid set 拒否）。
  - 許可/拒否の両側、なりすまし・絵文字汚染・非メンバーの各攻撃面をカバー。toggleReaction の実経路（reactions/{uid} set+delete と posts.reactionCounts update）が机上でルール通過することを確認。
- 結論: **前回 must は解消**。toggleReaction は本番ルール下で動く経路になった。

### should-#4（promotePhoto tx 整合） — ✅ 解消
- post ID を**決定的キー `${user.uid}_${slotIndex}`**（post-repo:184）に変更。`getDocs(query)`（非トランザクショナル read）を撤廃し、`tx.get(tripRef)` + `tx.get(postRef)` の2 read のみで差し替え判定（post-repo:189-190）。同 user・同 slot は必ず同一 doc に落ちるため、並行昇格でも tx 競合で一方が後勝ち＝postCount 二重加算が起きない。
- postCount は**新規時のみ `increment(1)`**（post-repo:233-234）で原子加算。差し替え（`isReplace`）は据え置き。`currentPostCount >= BEST_NINE_SLOTS(9)` ガード（post-repo:208）と整合。
- 挙動変化（旧: 新ID create+旧 delete / 新: 同 doc 上書き）に伴う**旧 reactions の孤児**は post-repo:213 のコメントで「tx 内列挙不可のためここでは掃除せず、ゲートCで方針確定」と**申し送り済み**。差し替えは同 postId 上書きのため reactions サブコレクションは旧 doc に紐づいたまま残るが、postId 不変ゆえ実際には孤児化しない（旧実装の「新ID へ移行」だと孤児化したが、決定的キー化でむしろ解消方向）。申し送りは保守的で妥当。

### should-#5（caption 長さ検証） — ✅ 解消
- `promotePhoto` の uploader 呼び出し（書き込み I/O）より前、slotIndex 検証の直後に `const trimmedCaption = caption.trim(); if (trimmedCaption.length > 200) throw`（post-repo:171-174）。ルール `caption.size() <= 200`（rules posts create）と整合し、実機での無言 reject を未然に防ぐ。書き込みにも `trimmedCaption` を使用（post-repo:221）。

### should-#6（subscribeToTripReactions 二重通知） — ✅ 解消（最適化はゲートC送り、許容範囲）
- 即時 `listener(byPost)` を撤廃し、`Promise.all(...).then(() => listener(byPost))`（post-repo:113）の**1回のみ**通知に整理。二重通知は解消。
- mine のちらつき対策として `mineCache`（post-repo:84,93,107）でスナップショット跨ぎに前回 mine を保持。
- 残るコスト（posts 件数ぶん `getDoc` を毎回）は post-repo:75-77 の `TODO(ゲートC)` で明記され、collectionGroup 等の最適化はゲートC送り。指示どおり許容。

## リグレッション/隔離 — ✅ 維持
- firebase 静的 import は firebase/ 配下のみ（外 0 件）。`context.tsx` は `FIREBASE_ENABLED=false` 既定（context.tsx:23）+ `Platform.OS!=='web' && !isExpoGo && FIREBASE_ENABLED` ガード内の**動的 require**（context.tsx:34-41）+ try/catch フォールバック。
- `firebase/**` に `.test.ts` 無し・`jest --listTests` に firebase 非出現。`jest.config.js` の `testPathIgnorePatterns: ['/tests/rules/']`（jest.config.js:19）でルールテストはデフォルト jest から除外＝79 件不変。
- modular API 統一（post-repo は `collection/doc/getDoc/increment/onSnapshot/runTransaction` 等の modular のみ）・serverTimestamp 書き分け（`serverTime()` for createdAt/lastPostAt、`Timestamp.fromDate` for 固定日付）維持。
- tsc 0 / jest 79 を自分で実行確認。

## 残 should / nit（非ブロック・前回からの持ち越し）
- **[should 持ち越し→nit 降格可]** 前回 nit（auth-service の暫定 `uid:''`、joinTrip の更新オブジェクト二重構築、`tsToDateRequired` の `?? new Date()` 握りつぶし）は本再レビューのスコープ（5観点）外で未変更。いずれも実害は呼び出し側依存/可読性レベルで非ブロック。ゲートC以降で拾えば良い。
- **[nit]** post-repo:213 の reactions 掃除はゲートC送りの申し送りで明示済み。決定的キー化により差し替え時の孤児化リスクは実質低下しているため、現時点で追加対応不要。

## テスト評価
- ルールテストは許可/拒否の両側 + なりすまし/絵文字汚染/非メンバーの攻撃面をカバー。reactions・posts.reactionCounts の追加 11 件で前回の最優先カバー漏れ（toggleReaction の実ルール通過）が埋まった。56件 pass（主宰 独立確認）。
- 確認済み（セキュリティ観点）: reactions の認可（自 uid 限定）・入力検証（確定絵文字）・posts 本体改竄封じ（affectedKeys 限定）はテストで担保。**該当 must/should なし**。
- ゲートC送りの実機検証項目（最適化系の getDoc コスト、差し替え時の reactions 実挙動）は申し送りに記載済みで、本Issue（型+隔離+ルール）のゲート範囲外。

## 総評: **approve（must なし）**
- 前回 must（reactions の本番ルール不在）は **rules への reactions match + posts reactionCounts-only update + 対応テスト追加**で解消。絵文字集合も REACTION_EMOJIS と一致。
- should #4/#5/#6 すべて対応済み（#6 の最適化はゲートC送りで指示どおり許容）。
- 隔離・modular・serverTimestamp 書き分けのリグレッションなし。tsc 0 / jest 79 / firebase 隔離 0 を自分で確認、test:rules 56 pass は主宰の独立確認を机上突合で裏取り。
- **must が1件も残っていないため承認。** 残るのは nit レベルのみ（非ブロック・ゲートC で回収可）。Integrator 段階へ進めてよい。
