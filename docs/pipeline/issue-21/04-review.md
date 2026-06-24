# 04-review.md — Storageアップロード（§9-7後半）

Issue: #21
Stage: 4/5 Reviewer
対象: `git diff main` + 新規 `src/repositories/firebase/firebase-photo-uploader.ts`
基準: 01-design.md / 02-research.md / storage.rules / RNFirebase storage 24.1.1（実SDK 54）
検証環境: 机上 + エミュレータ（実機検証はゲートC＋Blaze後・不可）

---

## 総評: 要修正（must 1件）

実装の中核（rules 5セグメント・FirebasePhotoUploader・promotePhoto 配線・隔離）は**すべて設計準拠で技術的に正しい**。
ただし `package.json` / `package-lock.json` に **本Issueと無関係な依存 `headroom-ai@^0.22.4` が混入**しており、これは
スコープ逸脱かつサプライチェーン上の must。これ1点のみで Implementer へ差し戻す。**他に must/should は無し。**

---

## 指摘リスト

### [must] package.json:32 / package-lock.json — 無関係依存 `headroom-ai` の混入（スコープ逸脱・供給網リスク）
- 問題:
  - `headroom-ai@^0.22.4` が dependencies に追加されているが、**設計 01-design.md に記載なし**（`grep headroom` → NONE）、
    **`src/` のどこからも import されていない**（`grep -rn headroom src/` → 0件）。
  - この package は peerDependencies に `@anthropic-ai/sdk` / `openai` / `ai` / `@ai-sdk/provider` を持つ LLM 系で、
    本Issue（Storageアップロード）と一切関係がない。出所不明の依存をビルドに引き込むのはサプライチェーン上の must 級リスク。
- 修正提案:
  ```
  npm uninstall headroom-ai
  ```
  を実行し、`package.json` の該当行と `package-lock.json` の `node_modules/headroom-ai` ブロック（および lockfile の
  dependencies エントリ）を差分から完全に除去する。`git diff main -- package.json package-lock.json` が
  headroom-ai を一切含まないことを確認してから再提出。
  - 注: もし意図的（ツール導入等）なら本Issueでなく別PRで、かつ設計合意の上で入れること。本差分には残さない。

---

## 設計準拠の判定

### storage.rules 5セグメント（must級・再確認 → 合格）
- `match /trips/{tripId}/{uid}/{postId}/{fileName}`（storage.rules:15）に変更済み。`{uid}` は3番目のまま維持され、
  `request.auth.uid == uid`（:19）・`size < 1.5*1024*1024`（:20）・`contentType == 'image/jpeg'`（:21）すべて従前どおり機能。
- v2 ワイルドカードは1セグメントのみマッチ＝`main.jpg`/`thumb.jpg` を `{fileName}` で受ける設計は正しい。隔離破壊・rules不一致なし。
- 申し送り「主宰が `npm run test:rules --runInBand` で 57件 pass（storage 9 + firestore 48）独立確認済み」を前提に、テスト本体を机上確認:
  本人main許可 / 本人thumb許可 / サイズ超拒否 / ちょうど1.5MiB拒否（境界）/ 1.5MiB未満許可（境界）/ 非jpeg拒否 /
  他人uid拒否（`trips/t1/bob/bob_0/main.jpg`）/ 未認証拒否 / read許可 — **隔離破壊・拒否経路を網羅**。パスは実アップロード先
  （`trips/t1/alice/alice_0/main.jpg`）と一致。OK。

### FirebasePhotoUploader（合格）
- modular API 統一: `getStorage` / `ref(storage,path)` / `putFile(ref, uri, metadata)` / `getDownloadURL(ref)`。
  RNFirebase 24.1.1 の `lib/modular/index.d.ts` の実シグネチャと一致確認済み
  （`putFile(storageRef, filePath, metadata?): Task` / `getDownloadURL(ref): Promise<string>`）。namespaced 混在なし。
- `putFile` の返す `Task` は thenable（`then` を実装・`lib/index.d.ts`）なので `await putFile(...)` は正しい。
- R3 厳守: `JPEG_METADATA = { contentType: 'image/jpeg' }` を putFile に明示。拡張子推測に依存せず rules を満たす。OK。
- パス `trips/{tripId}/{uid}/{postId}/main.jpg`・`/thumb.jpg`（firebase-photo-uploader.ts:38,41,42）が rules と完全一致。
- main/thumb を `Promise.all` で並列。独立パスなので妥当。

### promotePhoto 配線（§5-7順序・合格）
- 順序: `imageProcessor.process(localImage)`（:189）→ **tx外** `uploader.upload(processed, {tripId,uid,postId})`（:193）
  → URL確定 → `runTransaction`（:202）。tx内は `tx.get` 2回（read）を全 write より前に実行（R4）→ postCount≤9 強制
  （:223）/ slot差し替え判定（:218）不変。設計どおり、tx内ロジック改変なし。
- 決定的 postId `${user.uid}_${slotIndex}`（:185）を Storage パスにも流用。並行昇格でも同一 doc に収束する既存性質を維持。

### 隔離（must級 → 合格）
- `@react-native-firebase/storage` の import は `firebase-photo-uploader.ts` のみ（`grep -rn` で firebase/ 配下以外 0件）。
- `firebase/` 配下に `.test.ts` 無し。`jest --listTests` に firebase / rules 非出現（確認済み）。
- `context.tsx` の動的 require ガード（`require('@/repositories/firebase')`・静的 import しない）不変。隔離破壊なし。

### PhotoUploader interface 拡張の後方互換（合格）
- `upload(input: LocalImage)` → `upload(images: ProcessedImages, target: PhotoUploadTarget)` に変更。
- 唯一の実装差し替え点 index.ts で `new FirebasePhotoUploader()` + `ImageProcessor` を constructor 注入。
  passthrough スタブも新シグネチャに追従（`images.main.uri`/`images.thumb.uri` を返す・target無視）。他に PhotoUploader を
  消費する箇所なし。型整合は tsc 0 エラーで担保。

---

## テスト評価

- 確認済み・該当あり: storage.rules.test.ts が 5セグメントパスで 許可/拒否（本人main・本人thumb・サイズ超・境界×2・
  非jpeg・他人uid・未認証・read）を網羅。意味のある検証。
- カバー漏れ（許容範囲・ブロッカーではない）:
  - **FirebasePhotoUploader の単体テストは無い**。これは隔離方針（firebase/ に .test.ts を置かない・node から実SDKを
    引かない）の帰結であり、設計上の意図。エミュレータ/実機（ゲートC後）での結合検証に委ねる申し送りは妥当。追加 must としない。
  - promotePhoto の「process→upload→tx」順序を Mock uploader で検証する node テストは存在しない（既存 mock 系テストで
    promotePhoto 自体はカバー）。nit レベルの追加余地はあるが、本Issュスコープでは必須でない。
- セキュリティ観点（確認済み）:
  - 入力検証/認可は rules（uid一致・jpeg・サイズ）で担保、uploader は座標を引数で受けるだけで uid を偽装する経路なし
    （uid は呼び出し側 `user.uid` 由来）。インジェクション経路なし。
  - **機密情報の扱い: `headroom-ai` 経由で LLM SDK 系依存が入る点が唯一の懸念**（上記 must）。除去で解消。

---

## 申し送りの妥当性
- tx失敗時の孤児: 決定的パスで次回正常昇格時に同一パス上書き＝自然回収。即時削除は §7-2 でスコープ外。妥当。
- `putFile` の file:// uri（expo-image-manipulator saveAsync 出力）: putFile はローカルパス直アップロード API。正しい選択。
- 実機検証ゲートC後: Blaze 必須のため机上＋エミュレータ止まりという制約は明記どおりで妥当。

---

## 検証ログ
- `npx tsc --noEmit` → exit 0
- `npx jest` → 8 suites / **79 passed**（firebase・rules は testPathIgnorePatterns / listTests から除外を確認）
- `npm run test:rules`（storage 9 + firestore 48 = 57）は主宰が runInBand で独立 pass 済み（申し送り前提・本段階では再実行せず机上確認）

## 差し戻し先
must 1件（headroom-ai 除去）につき **Implementer 段階へ戻す**。修正は依存削除のみで、コード本体・rules・テストは
そのまま再レビューで approve 見込み。

---

## 再レビュー（must 解消）
- **must（headroom-ai 混入）解消**: `npm uninstall headroom-ai` で除去。`git diff main -- package.json` = 空、package-lock 差分も空（本Issueは依存変更不要だった＝完全に元へ）。`src` に headroom 参照0。`react-native-calendars` は main 既存で異物でない。
- tsc 0 / jest 79 維持。コード本体・storage.rules・隔離・配線は初回レビューで approve 済み。
- **approve**。Integrator へ進行可。
