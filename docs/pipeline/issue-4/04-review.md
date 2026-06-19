# コードレビュー（再レビュー） — Issue #4 UploadQueue

Issue: #4
Stage: 4/5 Reviewer（focused re-review / 差し戻し解消確認）
基準: `01-design.md` / 差分: `git diff main` + 新規untracked直読み（branch `pipeline/issue-4`）
検証: `npx tsc --noEmit` = 0 errors、`npx jest` = 49 passed / 5 suites（Reviewer 実機確認）。

## 総評: must なし = 承認（approve）

前回差し戻した should 4件・テスト穴5件はすべて妥当に解消。新たな must/リグレッションの混入なし。型崩れ・購読解除漏れ・挙動の意図しない変更も確認できず。本Issueはマージ可能。残 nit はブロックしない。

## should 解消確認（4件すべて解消）

### should-1 解消: 処理中 enqueue 取りこぼしレース
`mock-upload-queue.ts:165-171` の `kick()` `finally` に `if (this.nextPending()) this.kick()` の自己再キックが入った。`processing=null` 代入後に残 pending を再評価するため、`runLoop` 終了判定（`nextPending→undefined`, line181）と enqueue の窓に積まれた pending を確実に拾う。`enqueue` 内 `kick()`（line77）は処理中 `return`（line164）するが、ループ側の `while`（line178-182）継続＋ finally 再キックの二経路で取りこぼさない設計に整合。回帰テスト（test.ts:324-360, 手動ゲートで1件目を uploading 滞留→2件目 enqueue→両方処理され store 空）は不変条件を正しく固定しており妥当。

### should-2 解消: 嘘の削除警告
`compose.tsx:78-80` の `isReplacing` が `cells.find(c=>c.slotIndex===targetSlot)?.post != null` になり、確定Post実在スロット限定に修正。送信中ジョブだけのスロット（`post===null`, `job!==null`）では警告を出さず、後勝ち上書きの実挙動と一致。空き枠判定は `filledSlots = cells.filter(c=>c.state!=='empty')`（line41）に分離され、`firstEmpty`（line46-48）専用になった。差し替えバッジも `isTarget && occupied && !cell.job`（line190）で送信中枠を除外しており一貫。

### should-3 解消: レート制限の口
`mock-upload-queue.ts:197` で `processOne` の promotePhoto 直前に `await this.rateLimitGate(job)` を1か所だけ挿入。実体（line227-229）は no-op で挙動不変。TODO(Firebase) コメントで集約点を明示し、設計§93「逐次処理点にフックを1か所だけ用意（no-op可）」に準拠。

### should-4 解消: 再送導線
`index.tsx:59-66` の `handlePressSlot` が `cell.state==='failed' && cell.job` で `uploadQueue.retry(cell.job.id)` を呼び、それ以外は `goCompose`。failed バッジ「再送」（`best-nine-grid.tsx:67`, `compose.tsx:186`）の表示と挙動が一致した。`onPressSlot={(slot)=>handlePressSlot(slot)}`（index.tsx:162）で導線が通っている。

## テスト穴 解消確認（5件すべて追加・妥当）
1. 処理中 enqueue 取りこぼし: test.ts:324-360。手動ゲートで uploading 滞留させ二経路を検証。妥当。
2. バックオフ上限: test.ts:371-403。常時失敗で attempts=5/calls=5 停止、上限後 60s 進めても再試行なしを確認。妥当。
3. 複数 tripId emit 分離: test.ts:407-433。trip1 enqueue で trip2 リスナーに余計な emit が飛ばないこと（length 1 維持）を確認。`emitAffected`（前後差分の tripId のみ emit）の正しさを固定。妥当。
4. write 例外握り潰し: test.ts:436-460。`setItem` throw でも enqueue が reject せずメモリ状態が購読に流れることを確認。設計§134・リスク7に対応。妥当。
5. 壊れJSON空開始: test.ts:470-486。`getItem` が壊れJSONでも `start()` が throw せず空配列開始。`rehydrate` catch（mock-upload-queue.ts:139-143）を固定。妥当。

## 新規 must / リグレッション混入: 確認済み・該当なし
- 購読解除: `use-upload-jobs.ts:14-21` の `useEffect` は `subscribe` の返す unsubscribe を return し、deps `[uploadQueue, tripId]` も適切。tripId 未定義時は空リセット。漏れなし。
- 型整合: tsc 0 errors。`mergeBestNine`/`BestNineCell`/`UploadJob` の型は一貫。`BestNineGrid.cells?` は optional で既存 `BestNineMini`・album 呼び出し不変（未指定時 `mergeBestNine(posts,[],posts[0]?.userId??'')` に縮退）。
- 挙動変更: `compose.tsx` の `isReplacing` 厳格化と `filledSlots` 分離は意図どおりの修正で副作用なし。`handlePressSlot` の failed 分岐追加のみで他遷移は不変。
- 直列化/二重送信: `mutate` の Promise チェーン直列化（line110-121）・`kick` 単一束ね（line163-164）・`uploading` 再ピック除外（`nextPending` は pending のみ, line187）は維持。自己再キック追加で多重起動は発生しない（`processing` 非null ガードを通る）。

## セキュリティ: マージを止める問題なし（確認済み）
Firebase 直import無し（AsyncStorage は本番アダプタ `storage.ts` のみ DI 隔離）。`JSON.parse` は try/catch 保護（mock-upload-queue.ts:134-143）。`promotePhoto` の認可（色未配布/9枠/期間）は迂回されず必ず通る。retry 経路も同 `promotePhoto` を通すため認可は維持。
将来申し送り（ブロックしない）: rehydrate の `as UploadJob[]`（line136）は型検証なし。実運用前に status enum 等の最小スキーマ検証を。

## 残 nit（本Issueをブロックしない）
- nit-1（解消）: `best-nine-grid.tsx:31-32` に「posts は単一所有者前提・userId は先頭 post から」とコメント明記済み。
- nit-2: `backoffTimers` Set は発火時 self-delete のみで一括 clear/dispose API なし。`mock-upload-queue.ts:45-47` に「dispose は本PRスコープ外（mock は単一寿命）」と意図コメントあり。許容。
- nit-3（解消）: `merge-best-nine.ts:40` に「jobs は投入昇順・末尾後勝ち」契約コメント明記済み。

## マージ可否: approve
must 0件。should 4件・テスト穴5件すべて解消。tsc 0 / jest 49 passed。Integrator へ進めてよい。
