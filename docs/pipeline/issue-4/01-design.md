# UploadQueue 設計

Issue: #4
Stage: 1/5 Architect

## 方針（1行）

撮影と昇格(promotePhoto)を分離する `UploadQueue` を**第4の Repository**として追加し、enqueue→AsyncStorage永続化→注入されたプロセッサが `posts.promotePhoto` で確定、という2段階を Mock+ユニットテストだけで完結させる。実Firebase/画像生成/電波検知は作らない。

## 設計方針（5-7行）

- **4層への収め方**: `UploadQueue` を `Repositories` 束に追加し `context.tsx` で注入。画面/フックは interface 経由でのみ触る（既存 Repository と同じ規律）。実体は Mock 層に置き、`promotePhoto` 関数と `KeyValueStore`（AsyncStorageアダプタ）を**コンストラクタ注入**する。
- **データフロー**: compose の「公開」→ `uploadQueue.enqueue(input)` が即 `UploadJob(status:'pending')` を返し画面はブロックされず戻る → プロセッサが pending を1件ずつ `uploading` にして `promotePhoto` 実行 → 成功でジョブ除去、失敗で `failed`+`attempts++`、単純バックオフ後に再試行。各 mutation 後にメモリ状態を AsyncStorage へ永続化し、`tripId` 単位でリスナーへ emit。
- **主要インターフェース**: `enqueue / subscribe(tripId) / retry(jobId) / remove(jobId)`。永続化は `KeyValueStore { getItem/setItem/removeItem }` 抽象で差し替え可能（テストは in-memory mock、本番は AsyncStorage アダプタ）。
- **DB変更**: ドメイン型 `Post`/`Trip`/Firestore スキーマは変更なし。新規ドメイン型 `UploadJob` を追加するのみ。`promotePhoto` のシグネチャも不変。
- **エラーハンドリング**: `promotePhoto` 失敗はジョブを `failed` に落として保持（フローは止めない）。AsyncStorage の read/write 例外は握りつぶしてログのみ（永続化失敗で機能停止させない＝撮る体験を守る）。rehydrate 時に `uploading` で固まったジョブは `pending` に戻す（クラッシュ復帰）。

## 採用理由とトレードオフ

- **採用: UploadQueue を独立 Repository + プロセッサ注入**。理由: 既存DI規律に合致し、AsyncStorage と promotePhoto の両方を mock 化でき、テストが node 環境だけで完結する。トレードオフ: 楽観的UIのマージをフック側に1段追加する手間が増える。
- 却下: compose 内に直接キュー実装 → 画面密結合で再起動再開・テスト不能。
- 却下: zustand store でキュー管理 → 永続化/DI境界が曖昧になり「interface 経由でのみ触る」規律を崩す（将来 Firebase 実装差し替え時に画面が漏れる）。zustand は導入済みだが今回は使わない。
- 却下: `promotePhoto` を直接拡張して内部でキューイング → PostRepository の責務肥大、レート制限やリトライが Firebase 実装にも漏れる。

## 型 / インターフェースの確定

```ts
// src/domain/types.ts に追加
export type UploadJobStatus = 'pending' | 'uploading' | 'failed';

export type UploadJob = {
  id: string;
  tripId: string;
  userId: string;          // 起票ユーザー（楽観UIの自分判定・将来のレート制限用）
  slotIndex: number;       // 0〜8
  localImage: LocalImage;  // { uri, width?, height? }
  caption: string;
  status: UploadJobStatus;
  attempts: number;        // 失敗回数。バックオフ算出と上限判定に使う
  createdAt: number;       // epoch ms（JSON シリアライズ容易・順序保証）
  error?: string;          // 直近の失敗理由（UI 表示用）
};
```

```ts
// src/repositories/types.ts に追加
export interface UploadQueue {
  /** ジョブを積み、即 pending ジョブを返す（撮影フローをブロックしない）。永続化と emit も行う。 */
  enqueue(input: PromotePhotoInput): Promise<UploadJob>;
  /** トリップ単位で未確定ジョブ一覧を購読する（登録直後に現在値を即時通知）。 */
  subscribe(tripId: string, listener: (jobs: UploadJob[]) => void): Unsubscribe;
  /** failed ジョブを pending に戻して再処理を促す。 */
  retry(jobId: string): Promise<void>;
  /** ジョブをキューから除去する（ユーザー取消 / 成功後の内部除去）。 */
  remove(jobId: string): Promise<void>;
}

export type Repositories = {
  auth: AuthService;
  trips: TripRepository;
  posts: PostRepository;
  uploadQueue: UploadQueue;   // ← 追加
};
```

- `enqueue` の引数は既存 `PromotePhotoInput`（`{ tripId, user, slotIndex, localImage, caption }`）をそのまま受ける。互換維持。
- **状態遷移**: `pending → uploading → (成功: remove) | (失敗: failed, attempts++)`。`failed →(retry)→ pending`。`uploading` は揮発（rehydrate で `pending` に戻す）。
- **DI注入**: `createMockRepositories()` で `MockUploadQueue` を生成し束に追加。プロセッサ起動（`processor.start()`）は同関数内 or `RepositoryProvider` の `useEffect` で1回だけ。`context.tsx` の `useMemo` は1か所追加するだけ。

## 永続化設計

- **KeyValueStore 抽象**（新規 `src/repositories/storage.ts`）:
  ```ts
  export interface KeyValueStore {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
  }
  ```
  - 本番アダプタ: `@react-native-async-storage/async-storage` をラップ（このファイルだけが async-storage を import。テストからは触らせない）。
  - テスト用: `createMemoryStore()` で `Map` ベースの in-memory 実装を返す（node 環境で完結）。
- **キー設計**: 単一キー `colorlog:uploadQueue:v1` に**全ジョブ配列**を JSON で格納。理由: ジョブ総数は少数（最大 9枠×メンバー）でアトミックな書き換えが単純、rehydrate も1 read。`v1` でスキーマ版管理。
- **シリアライズ**: `JSON.stringify(jobs)`。`createdAt` を epoch ms にしたため Date 復元処理が不要で安全。
- **rehydrate（再起動再開）**: 起動時にプロセッサが `getItem` → `JSON.parse` → 全 `uploading` を `pending` へ正規化 → メモリへロード → emit → 処理ループ開始。parse 失敗時は空配列で開始しログのみ（壊れた値で機能停止させない）。

## プロセッサ設計

- **本体**: `MockUploadQueue` 内に処理ループを持つ（`promotePhoto: (input) => Promise<Post>` と `store: KeyValueStore` を注入）。`enqueue`/rehydrate/`retry` が「処理キック」をトリガする。
- **ループ**: pending を `createdAt` 昇順で1件取り出し `uploading` に → `promotePhoto({tripId,user,slotIndex,localImage,caption})` 実行。`user` は `enqueue` 時の input から再構成（`userId` だけでなく `AuthUser` 全体を job に保持するか、`enqueue` 時の user を内部 Map で保持）。**逐次処理**（並行なし）で順序と同一スロットの上書き順を保証。
- **成功**: ジョブを `remove`（永続化＋emit）。確定 Post は既存 `subscribeToTripPosts` 経由で画面に出る。
- **失敗**: `status='failed'`, `attempts++`, `error` セット、永続化＋emit。`attempts < MAX(=5)` なら `setTimeout(backoff)` 後に `pending` へ戻して再キック。`backoff = min(baseMs * 2^(attempts-1), capMs)`（例 base=1000, cap=30000）。
- **同一スロット・順序**: 逐次処理なので「同じ slotIndex に2件積んだ」場合も投入順に確定（後勝ち = 差し替え）。`promotePhoto` 自身が空き枠追加/差し替えを同経路で扱うため特別扱い不要。
- **レート制限（§13 lastPostAt）整合余地**: 逐次処理点で `trip.members[uid].lastPostAt` を見て最小間隔(10秒)未満なら次ジョブ処理を遅延する**フックを1か所だけ用意**（今回は no-op か固定遅延でよい。将来 Firebase 実装で本実装）。設計上ここに集約できることだけ担保する。

## 楽観的UIマージ

- 新フック `useTripUploadJobs(tripId)` が `uploadQueue.subscribe` を購読（`useTripPosts` と同形）。
- compose / トリップ詳細のベスト9グリッドは「確定 Post（`useTripPosts`）」＋「送信中 Job（`useTripUploadJobs`）」を **slotIndex でマージ**して表示する合成関数を用意：
  - 同一ユーザー・同一 slotIndex に確定 Post と送信中 Job が両方あれば **Job をプレースホルダとして優先表示**（送信中バッジ）。
  - Job のみ → プレースホルダ枠（画像は `localImage.uri`、状態バッジ pending/uploading/failed、failed は再送ボタン）。
  - Post のみ → 従来通り。
- マージは画面で行う純粋関数（`mergeBestNine(posts, jobs, userId)` を `src/domain` か hook に）。既存 `useTripPosts` の購読・型は変更しない（合成のみ追加）。compose の `myPosts.find(...)` を「マージ済み配列」に差し替える。

## スコープ（影響範囲）

**新規**
- `src/repositories/storage.ts`（KeyValueStore + AsyncStorage アダプタ + createMemoryStore）〜50行
- `src/repositories/mock/mock-upload-queue.ts`（MockUploadQueue + プロセッサ）〜180行
- `src/repositories/mock/mock-upload-queue.test.ts`（永続化/rehydrate/成功除去/失敗再試行/順序）〜200行
- `src/hooks/use-upload-jobs.ts`（`useTripUploadJobs`）〜30行
- マージ純粋関数（domain or hook 内）〜30行

**変更**
- `src/domain/types.ts`：`UploadJob`/`UploadJobStatus` 追加 〜15行
- `src/repositories/types.ts`：`UploadQueue` interface + `Repositories` に1行 〜25行
- `src/repositories/context.tsx`：`uploadQueue` 注入 + プロセッサ起動 〜10行
- `src/repositories/mock/index.ts`：`MockUploadQueue` 生成・束へ追加 〜5行
- `src/app/trip/[id]/compose.tsx`：`promotePhoto` 直 await → `enqueue` に置換、`router.back()` 即時化、マージ表示 〜25行
- （トリップ詳細グリッドがあればマージ表示反映）

想定：新規6・変更6ファイル、合計 +500〜600行オーダー。**1 PR で完結サイズ**。

## やらないこと（3点）

1. 実 Firebase Storage/Firestore へのアップロード（§9-手順5/7、別Issue）。画像2サイズ生成（400px/1600px、§9-手順7）も別Issue。
2. 実機の電波検知（NetInfo 連携）の作り込み。接続状態はスタブ可能な口だけ残し、レート制限(lastPostAt)も整合の口だけ用意して本実装はしない。
3. expo-camera 実カメラ統合・compose の候補生成置き換え（現状の picsum スタブ維持）。

## リスク・落とし穴

- **永続化の競合**: enqueue / 成功除去 / retry が短時間に重なるとメモリ→AsyncStorage の write が前後する。対策＝全 mutation を**逐次直列化**（処理中フラグ or Promise チェーン）し、書き込みは常に最新メモリ配列を丸ごと出す。
- **二重送信**: 同一ジョブが2回 `promotePhoto` される（再キックの重複）。対策＝`uploading` のジョブは再ピックしない／プロセッサは単一インスタンスで多重起動しない（`start()` 冪等）。
- **再起動中の uploading**: クラッシュで `uploading` のまま永続化されたジョブは復帰時に確定済みか不明。対策＝rehydrate で `uploading→pending` に戻す（再送される＝最悪 Mock では差し替えで上書きされるだけ。実 Firebase では将来べき等キー検討、今回スコープ外）。
- **AsyncStorage 例外**: 端末容量逼迫等で write 失敗。対策＝例外を握りメモリ状態は維持・ログのみ（撮る体験を止めない）。read 失敗時は空で開始。
- **メモリ/永続化の不整合**: emit はメモリを真実とし、永続化は副作用。テストはメモリ経路と永続化経路の両方を別 assert する。

## テスト方針（mock）

`createMemoryStore()` と `promotePhoto` スタブを注入して node 環境で完結：
- **enqueue 永続化**: enqueue 後 `store.getItem(key)` に pending ジョブが入る／`subscribe` に即時 emit される。
- **rehydrate 再開**: store に pending を仕込んだ**新インスタンス**を起動 → ジョブを復元し処理して `promotePhoto` が呼ばれる。`uploading` を仕込んだ場合 `pending` に正規化される。
- **成功除去**: `promotePhoto` 解決 → ジョブが store と subscribe 両方から消える。
- **失敗再試行**: `promotePhoto` 拒否 → `failed`+`attempts=1`+`error`。`retry(jobId)` で `pending` に戻り再処理（fake timers でバックオフ検証）。
- **順序 / 同一スロット**: 同 slotIndex に2件 enqueue → 投入順に `promotePhoto` 呼出（呼出引数列で検証）。後勝ちで確定。
- 既存26件 + promotePhoto 経路を壊さない（compose 変更は enqueue 経由でも `promotePhoto` が最終的に呼ばれる）。

## Investigator への確認事項

1. `mergeBestNine`/プレースホルダ表示の置き場所：トリップ詳細グリッドの実ファイル（`src/app/trip/[id]/index.tsx` 等）を特定し、compose と共通化できる既存コンポーネントがあるか確認。
2. `UploadJob` に `AuthUser` 全体を持たせるか `userId` のみで `promotePhoto` を呼べるか（`promotePhoto` は `user: AuthUser` を要求）。`enqueue` 時の `user` をジョブ permanentに保存する方針で問題ないか（permission/色は trip 側で再解決される）。
3. `RepositoryProvider` でプロセッサを `start()` する箇所と、テストで `start()` を明示呼び/await できる形になっているか（テスト容易性）。
4. AsyncStorage を本番アダプタで import した際、jest(node)実行に漏れないこと（`storage.ts` の本番分岐がテストで評価されない構成）を確認。
