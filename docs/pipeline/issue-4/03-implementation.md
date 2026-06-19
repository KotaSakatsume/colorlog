# UploadQueue 実装サマリー

Issue: #4
Stage: 3/5 Implementer

ブランチ: `pipeline/issue-4`（main 直コミットなし）。SDK54。

## 検証結果

- `npx tsc --noEmit`: **エラー0**（全体0。baseline 0 を維持）。
- `npx jest`: **44 passed / 44**（既存26 + 追加18: UploadQueue 9 + mergeBestNine 9）。

## 変更ファイル一覧（意図1行ずつ）

### 新規

- `src/repositories/storage.ts` — `KeyValueStore` 抽象 + `createAsyncStorageStore()`（本番）+ `createMemoryStore()`（テスト用 Map・未設定キーは null）。隔離は DI（テストは本番アダプタを呼ばない）。
- `src/repositories/mock/mock-upload-queue.ts` — `MockUploadQueue`（enqueue/subscribe/retry/remove/start + 逐次プロセッサ + 永続化 + rehydrate 正規化）。
- `src/repositories/mock/mock-upload-queue.test.ts` — 永続化/rehydrate/uploading正規化/成功除去/失敗+attempts/バックオフ再処理/retry/投入順・後勝ち/remove の9ケース。
- `src/domain/merge-best-nine.ts` — `mergeBestNine(posts, jobs, userId)` 純関数（9セル合成・Job優先・後勝ち）+ `countOccupiedSlots`。
- `src/domain/merge-best-nine.test.ts` — マージ純関数の9ケース。
- `src/hooks/use-upload-jobs.ts` — `useTripUploadJobs(tripId)`（`useTripPosts` と同形の手書き購読）。

### 変更

- `src/domain/types.ts` — `UploadJobStatus` / `UploadJob`（全フィールド JSON 安全・`createdAt` epoch ms）を追加。
- `src/repositories/types.ts` — `UploadQueue` interface（+`start()`）と `Repositories` 束に `uploadQueue` を追加。
- `src/repositories/mock/index.ts` — `posts` を先に const 化し、`uploadQueue` に `posts.promotePhoto` と `createAsyncStorageStore()` を注入（組み立て順を修正）。
- `src/repositories/context.tsx` — Provider の `useEffect` で `uploadQueue.start()` を起動（生成側で呼ばずテストの fake timer 制御を温存）。
- `src/components/best-nine-grid.tsx` — 非破壊で `cells?: BestNineCell[]` prop を追加。未指定なら従来 `posts` 描画、指定時は送信中/失敗バッジ + 半透明プレースホルダを重ねる（既存呼び出し不変）。
- `src/app/trip/[id]/index.tsx` — `useTripUploadJobs` + `mergeBestNine` でセルを合成、`BestNineGrid` に `cells` を渡し、`filled` を `countOccupiedSlots` に変更（「n/9」整合）。
- `src/app/trip/[id]/compose.tsx` — `promotePhoto` 直 await → `uploadQueue.enqueue` に置換し即 `router.back()`。スロットグリッドをマージ済み `cells` で描画（送信中即表示）。空き枠/差し替え判定もマージ後を真実に。

## 主要実装判断

- **直列化**: enqueue/remove/retry/状態遷移 と永続化を単一 `mutationChain`（Promise チェーン）に載せ「メモリ更新→永続化→emit」順を保証。write の前後入れ替わりを防止。
- **逐次プロセッサ**: `processing` を単一の Promise に束ね多重起動を防止（二重送信防止）。`pending` を配列前方から1件ずつ拾い、`uploading` は再ピックしない。同一スロット後勝ちは「末尾に積む + 前方から処理」で投入順に確定。
- **バックオフ**: 失敗で `failed`+`attempts++`+`error`、`attempts < 5` なら `setTimeout(min(1000*2^(attempts-1), 30000))` 後に `pending` へ戻して再キック。
- **rehydrate**: 起動時に `getItem`→`JSON.parse`→`uploading`を`pending`に正規化→`mutate(()=>loaded)`で emit/永続化。`raw ? parse : []` + try/catch で壊れた値は空開始。
- **start() 冪等**: `started` フラグで二重起動を防止。Provider の useEffect で1回、テストは明示 await。
- **マージの口**: `BestNineGrid` は `cells` prop を追加するだけの非破壊改修。`mergeBestNine` は domain の純関数（`format.ts`/`colors.ts` と同列）。

## 調査の訂正・落とし穴への対応

- **AsyncStorage 隔離は DI（調査§0-1, §5-1）**: import 分離に頼らず、テストは `createMemoryStore()` を注入し本番アダプタを一切呼ばない。`storage.ts` は AsyncStorage を static import するが、テストはそのコードパスを評価しない。
- **zustand 不使用（調査§4-1）**: `mock-backend.ts` の Map+Set+即時 emit を踏襲した手書き購読。
- **fake timer × Promise（調査§4-2）**: バックオフ検証は `await jest.advanceTimersByTimeAsync(1000)`。逐次プロセッサは複数 mutation に跨るため、テストの `flush()` はマイクロタスクを多めに掃いて安定化。
- **getItem null / parse（調査§4-3）**: `raw ? JSON.parse(raw) : []` + try/catch。memory store は未設定キーで null。
- **createMockRepositories 組み立て順（調査§4-8）**: `posts` を const 先行。
- **createdAt タイブレーク（調査§5-5）**: `createdAt` 昇順に頼らず配列の挿入順で pending を取り出し、同一スロット後勝ちを保証。

## リスク箇所3件への対応（設計§リスク / 調査§4）

1. **永続化の競合（write 前後入れ替わり）** → `mutationChain` で全 mutation を逐次直列化。書き込みは常に最新メモリ配列を丸ごと出す。テスト「enqueue 永続化」「remove」で store 経路を別 assert。
2. **二重送信 / uploading 再ピック** → `processing` 単一束ね + `start()` 冪等 + `nextPending` は `pending` のみ対象。テスト「投入順・後勝ち」で promotePhoto 呼出回数・順序を検証。
3. **再起動中の uploading 固着** → rehydrate で `uploading→pending` 正規化。テスト「uploading で固まったジョブは…再送される」で確認。

## Reviewer への申し送り

- **BestNineGrid の改修方針**: 調査リスク1（`Post[]` 固定でバッジの口が無い）に対し、`cells?` prop 追加の非破壊方式を採用。`BestNineMini`（アルバム）と既存 `posts` のみ呼び出しは不変。送信中は半透明 + 下部バッジ（「送信中」/「再送」）。
- **failed の手動再送 UI**: グリッドは failed を「再送」バッジで示すのみ。タップで `uploadQueue.retry` を呼ぶ UI 配線はスコープ外と判断（compose/index の `onPressSlot` は従来通り compose 遷移）。必要なら別 PR。
- **enqueue の即時性**: compose は enqueue 後すぐ `router.back()`。promotePhoto のバリデーション失敗（色未配布等）は enqueue 後に failed ジョブとして現れる（compose は色未配布なら早期 return のため通常フローでは色済み・調査§5-4）。
- **レート制限(lastPostAt)の口**: 設計§93 の「集約できる口」はプロセッサの逐次点に相当。今回は no-op（実装せず・スコープ外）。
- **スコープ厳守**: 実 Firebase アップロード / 画像2サイズ生成 / NetInfo / expo-camera は未着手。`promotePhoto` シグネチャ・Post/Trip 型は不変。

---

## 修正ラウンド（Reviewer 差し戻し 04-review.md 対応 / Stage 3 再実行）

Issue: #4 / Stage: 3/5 Implementer（fix round）。must 0・should 4 + テスト穴5 を修正。`tsc`=0 / `jest`=49 passed（既存44 + 追加5）。コミットは Integrator 段階。

### should 4件の対応

- **should-1（処理中 enqueue 取りこぼしレース）** — `mock-upload-queue.ts` `kick()` の `finally` に、`processing=null` 後 `if (this.nextPending()) this.kick()` の自己再キックを追加。runLoop のループ脱出と finally の窓で取り残された pending を確実に再処理する防御ガード。挙動は「処理中に積まれた pending は必ず処理される」を保証。
- **should-2（嘘の削除警告）** — `compose.tsx` の `isReplacing` を `filledSlots.has(targetSlot)`（送信中ジョブだけのスロットも true）から `cells.find(c=>c.slotIndex===targetSlot)?.post != null`（確定 Post 実在限定）へ変更。`filledSlots` は空き枠判定（firstEmpty 算出）専用に分離しコメント明記。送信中ジョブだけのスロットでは「削除されます」警告を出さず後勝ち上書きのみ。
- **should-3（レート制限フックの口）** — `processOne` の `promotePhoto` 直前に `await this.rateLimitGate(job)` を 1 メソッド差し込み。`rateLimitGate` は no-op（挙動不変）+ TODO(Firebase) コメント。設計§93 の集約点を逐次処理点 1 か所に確保。
- **should-4（「再送」表示なのに retry 未呼び出し）** — `index.tsx` に `handlePressSlot(slot)` を新設。`cells` から該当セルを引き、`state==='failed' && cell.job` なら `uploadQueue.retry(cell.job.id)` を呼ぶ。それ以外は従来通り `goCompose(slot)`。`onPressSlot` 配線を `handlePressSlot` 経由に変更し、グリッドの「再送」バッジ表示と挙動を一致させた。

### 追加テスト（mock-upload-queue.test.ts・穴1〜5）

1. `処理中 enqueue の取りこぼし（should-1 回帰）` — 手動ゲートで 1件目を uploading 滞留中に 2件目 enqueue → 解放後に両方処理され store 空（取りこぼし無しの不変条件を固定）。
2. `バックオフ上限（穴2）` — 常時 reject + `advanceTimersByTimeAsync` 反復で `attempts` が MAX_ATTEMPTS(5) で停止、以降は再試行されず failed 保持（calls=5 固定）。
3. `複数 tripId の emit 分離（穴3）` — trip1 への enqueue で trip2 リスナーに余計な emit が飛ばないこと（emit 回数で検証）。
4. `永続化 write 例外の握り潰し（穴4）` — `setItem` が throw する store 注入でも `enqueue` が reject せず、メモリ状態（購読）維持。
5. `壊れ永続化からの起動（穴5）` — `getItem` が `'{壊れ'` を返す store で `start()` が throw せず空配列開始。

### nit（コメント追記のみ・挙動不変）

- nit-1: `best-nine-grid.tsx` cells 未指定フォールバックに「posts は単一所有者前提・先頭 userId」コメント。
- nit-2: `backoffTimers` Set に「自己 delete のみ・将来の一括 clear/dispose 用保持点、dispose API は本 PR スコープ外」コメント。
- nit-3: `merge-best-nine.ts` jobs ループに「jobs は投入昇順・末尾後勝ち」契約コメント。

### 変更ファイル一覧（fix round）

- `src/repositories/mock/mock-upload-queue.ts` — kick 自己再キック（should-1）/ rateLimitGate 追加（should-3）/ backoffTimers コメント（nit-2）。
- `src/app/trip/[id]/compose.tsx` — isReplacing を確定 Post 限定に（should-2）。
- `src/app/trip/[id]/index.tsx` — handlePressSlot で failed タップ→retry 配線（should-4）。
- `src/components/best-nine-grid.tsx` — nit-1 コメント。
- `src/domain/merge-best-nine.ts` — nit-3 コメント。
- `src/repositories/mock/mock-upload-queue.test.ts` — 追加テスト 5件。

### 設計逸脱の有無

無し。スコープ厳守（実 Firebase / 画像2サイズ / NetInfo / expo-camera は未着手）、strict 維持、Firebase 直 import 無し、4層維持、`promotePhoto` シグネチャ・Post/Trip 型不変。should-4 のみ「表示と挙動の一致」のため index 側に最小配線を追加（設計の楽観的UI方針の範囲内）。

### 再レビューへの申し送り

- **should-1 の性質**: runLoop の while ループ自体（毎周 `await this.mutationChain` 後 `nextPending()`）が大半のケースを既に拾うため、自己再キックは「ループ脱出〜finally の窓」を埋める防御ガード。回帰テストは厳密なマイクロタスク窓の強制ではなく「処理中 enqueue が必ず処理される」観測契約を固定する形にした（fake timer での窓再現は不安定なため）。
- **should-4 の配線範囲**: failed タップは retry のみ（remove/再編集導線は出していない）。compose 側スロットグリッドの failed タップは従来どおり targetSlot 設定（再編集）で据え置き、index のベスト9グリッドにのみ retry を通した。compose 側にも retry を出すかは UX 判断として別途。
- **rehydrate の型検証**: `as UploadJob[]` は未検証のまま（Reviewer 申し送り通り）。実運用前に status enum 等の最小スキーマ検証を別 PR で。
