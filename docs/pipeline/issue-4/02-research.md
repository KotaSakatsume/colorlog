# UploadQueue 調査結果

Issue: #4
Stage: 2/5 Investigator

入力: `docs/pipeline/issue-4/01-design.md` のみを参照。実 SDK 54。すべて file:line と実コード引用で裏付ける。

---

## 0. 結論（最重要・先出し）

1. **AsyncStorage を本番アダプタで static import しても node テストは require では落ちない。落ちるのは「実際に呼んだ時」**。`require('@react-native-async-storage/async-storage')` は成功し、`AsyncStorage.getItem('x')` は **Promise を返し、その Promise が `ReferenceError: window is not defined` で reject** する（実測。下記 §2-4）。したがって設計の「import が漏れたら落ちる」前提は不正確。**「import 自体は無害、呼び出しが node で reject する」**。隔離は import 分離ではなく **DI（KeyValueStore 注入）で十分**かつ必須。テストは AsyncStorage を一切 require しない `createMemoryStore()` 経路で完結できる。
2. 楽観UIマージの差し込み先は **2か所**：`compose.tsx:35` の `myPosts` と、`[id]/index.tsx:41` の `myPosts`（どちらも `posts.filter((p) => p.userId === user.uid)`）。後者はさらに `BestNineGrid`（`best-nine-grid.tsx`）へ `posts` を渡す。`BestNineGrid` は `Post[]` 型に固定されており、Job プレースホルダ表示には**型拡張か別描画分岐が要る**（後述リスク1）。
3. `UploadJob` に `AuthUser`/`localImage` を丸ごと保持してよい。両方とも完全に JSON シリアライズ可能（プレーンオブジェクト、`Date` を含まない）。`PromotePhotoInput` も同様（§2-2）。

---

## 1. 既存の購読/DIパターンの実体（UploadQueue を同形で足すための前例）

### 1-1. Repositories 束と注入（`context.tsx`）
- 束の定義: `src/repositories/types.ts:138-142`
  ```ts
  export type Repositories = {
    auth: AuthService;
    trips: TripRepository;
    posts: PostRepository;
  };
  ```
  → ここに `uploadQueue: UploadQueue;` を1行追加。
- 注入は1か所、`useMemo` で生成: `src/repositories/context.tsx:17`
  ```ts
  const repositories = useMemo(() => createMockRepositories(), []);
  ```
  プロセッサ起動の `useEffect` を足すならこの `RepositoryProvider`（`context.tsx:15-21`）内。**`useCurrentUser` が `auth.subscribe` を `useEffect` で購読している前例**が `context.tsx:35` にある（`useEffect(() => auth.subscribe(setUser), [auth])`）—— プロセッサ `start()` も同形で `useEffect(() => repositories.uploadQueue.start?.(), [repositories])` として置ける。

### 1-2. createMockRepositories（束の組み立て）
- `src/repositories/mock/index.ts:13-21`
  ```ts
  export function createMockRepositories(): Repositories {
    const db = new MockBackend();
    seedMockData(db);
    return {
      auth: new MockAuthService(),
      trips: new MockTripRepository(db),
      posts: new MockPostRepository(db),
    };
  }
  ```
  → `uploadQueue: new MockUploadQueue({ promotePhoto: (i) => posts.promotePhoto(i), store })` を追加。**`posts` を先に const で受けてから `uploadQueue` に注入**する形に変える必要がある（現状は object リテラル内で直接 `new` しているため、`posts` インスタンスへの参照を取れない）。

### 1-3. subscribe/emit 三点セット（`mock-backend.ts`）
購読器・通知器・初期値即時 emit の3点が揃った正準パターン。UploadQueue はこれを `tripId` 単位で**そっくり踏襲**する。
- **リスナー保持**: `src/repositories/mock/mock-backend.ts:34`
  `private readonly postsListeners = new Map<string, Set<PostsListener>>();`
- **subscribe（登録 + 初期値即時 emit + unsubscribe 返却）**: `mock-backend.ts:188-194`
  ```ts
  subscribePosts(tripId: string, listener: PostsListener): Unsubscribe {
    const set = this.postsListeners.get(tripId) ?? new Set();
    set.add(listener);
    this.postsListeners.set(tripId, set);
    listener(this.getPosts(tripId)); // 初期値を即時に流す
    return () => set.delete(listener);
  }
  ```
- **emit（mutation 後に対象 tripId のリスナー全員へ）**: `mock-backend.ts:218-221`
  ```ts
  private emitPosts(tripId: string): void {
    const posts = this.getPosts(tripId);
    this.postsListeners.get(tripId)?.forEach((fn) => fn(posts));
  }
  ```
- **mutation→emit の順**: `putPosts` が `mock-backend.ts:141-144` で `set` 直後に `emitPosts`。UploadQueue の各 mutation（enqueue/remove/retry/状態遷移）も「メモリ更新 → 永続化 → emit」をこの順で踏む。

### 1-4. PostRepository が backend を薄くラップする形（`mock-post-repository.ts`）
- `subscribeToTripPosts` は backend へ委譲のみ: `src/repositories/mock/mock-post-repository.ts:16-18`
  ```ts
  subscribeToTripPosts(tripId, listener): Unsubscribe {
    return this.db.subscribePosts(tripId, listener);
  }
  ```
- `promotePhoto` 本体: `mock-post-repository.ts:36-103`。**UploadQueue のプロセッサが最終的に呼ぶのはこの関数**。重要な副作用＝成功時に `putPosts`(100) + `putTrip`(101) を行い `subscribeToTripPosts` 購読者へ確定 Post が流れる。設計どおり「成功後はジョブ除去 → 確定 Post は既存購読で表示」が成立する。
- バリデーション（プロセッサが踏みうる失敗源）: `slotIndex` 範囲(39)、トリップ不在(44)、`isTripOver`(48)、**色未配布(52-54: `if (!member?.color) throw '色が未配布のため公開できません'`)**、9枠超過(83-85)。→ 失敗ジョブの `error` 文字列はこれらになる。

### 1-5. フックの購読形（`use-trips.ts`）
- `useTripPosts`: `src/hooks/use-trips.ts:80-99`。`useState` + `useEffect(subscribe→setState, return unsubscribe)`。**`useTripUploadJobs(tripId)` はこれを丸写しで作れる**（`postRepo.subscribeToTripPosts` を `uploadQueue.subscribe` に置換するだけ）。loading 不要なら省略可。
  ```ts
  useEffect(() => {
    if (!tripId) { setPosts([]); setLoading(false); return; }
    const unsubscribe = postRepo.subscribeToTripPosts(tripId, (next) => {
      setPosts(next); setLoading(false);
    });
    return unsubscribe;
  }, [postRepo, tripId]);
  ```

---

## 2. 設計末尾「Investigator への確認事項」への回答

### 確認1: `mergeBestNine`/プレースホルダ表示の置き場所

**マージ先は2ファイル、いずれも同一の `myPosts` 定義。**
- `src/app/trip/[id]/compose.tsx:35` `const myPosts = posts.filter((p) => p.userId === user.uid);`
  - これを使うのは「公開先スロット選択」グリッド `compose.tsx:152-179`（`myPosts.find((p) => p.slotIndex === slot)` で各枠を描画、`compose.tsx:154`）。送信中 Job をここにプレースホルダ表示する。
- `src/app/trip/[id]/index.tsx:41` `const myPosts = posts.filter((p) => p.userId === user.uid);`
  - これを `BestNineGrid` に渡す: `index.tsx:142-147` `<BestNineGrid posts={myPosts} ... />`。
  - `filled = myPosts.length` も `index.tsx:43` で使われ「{filled}/9」表示に出る（`index.tsx:138-140`）。マージ後配列を渡すと枚数表示も変わる点に注意（仕様判断）。

**共通コンポーネント `BestNineGrid` の制約（重要）**: `src/components/best-nine-grid.tsx:9-21`。`posts: Post[]` 固定で `post.thumbURL`(38) / `post.id`(43, recyclingKey) を読む。Job は `Post` 型ではない。compose 側は自前の `<View>` グリッド（`compose.tsx:152-179`）なので分岐を足しやすいが、index 側の `BestNineGrid` で送信中バッジ・failed 再送ボタンを出すには **(a) `mergeBestNine` が `Post` 互換の表示用オブジェクト配列を返す、または (b) `BestNineGrid` にプレースホルダ用 prop を足す** のどちらか。→ **設計が言う「純粋関数で合成」だけでは BestNineGrid のバッジ表示は出せない**。Implementer はここを明示設計する必要あり（リスク1）。

**結論**: `mergeBestNine(posts, jobs, userId)` は `src/domain` に純粋関数で置くのが既存流儀（`src/domain/format.ts`, `colors.ts` と同列）に合う。compose は `myPosts.find(...)` を「マージ済み配列の find」に差し替え可能。index 側は `BestNineGrid` の表示能力拡張が前提になる。

### 確認2: `UploadJob` に `AuthUser` 全体を持たせてよいか（シリアライズ可能性）

**問題なし。丸ごと保持可。**
- `PromotePhotoInput` 定義: `src/repositories/types.ts:44-52`
  ```ts
  export type PromotePhotoInput = {
    tripId: string;
    user: AuthUser;
    slotIndex: number;
    localImage: LocalImage;
    caption: string;
  };
  ```
- `AuthUser`: `types.ts:14-18` = `{ uid: string; displayName: string; photoURL?: string }` —— 全フィールド string、`Date`/関数/循環なし → **JSON 安全**。
- `LocalImage`: `types.ts:21-25` = `{ uri: string; width?: number; height?: number }` —— **JSON 安全**。compose が渡す実値は `localImage: { uri: selected }`（`compose.tsx:90`）で `selected` は picsum URL 文字列。
- `promotePhoto` は `user: AuthUser` 全体を要求（`mock-post-repository.ts:51` で `trip.members[user.uid]`、`mock-post-repository.ts:65` で `userId: user.uid`）。**`user.uid` だけ使っているように見えるが、`promotePhoto` のシグネチャが `AuthUser` を要求するため、ジョブに `user` 丸ごと保持して再構成する設計が最も素直**。permission/色は `promotePhoto` 内で `trip.members[user.uid].color` から再解決（`mock-post-repository.ts:51-54, 65`）されるので、ジョブに古い color を持つ必要はない。
- → **`UploadJob` は `PromotePhotoInput` 相当 + 状態（id/status/attempts/createdAt/error）を持てばよい**。`userId` 単独フィールドは「楽観UIの自分判定」用に冗長に持っても害なし（設計の型定義どおり `userId` + `localImage` + `caption` + `slotIndex` + `tripId`、user 全体は別途 `input` として保持 or job に `user` を足す）。

### 確認3: `RepositoryProvider` でプロセッサ `start()` する箇所とテスト容易性

- 起動箇所: `src/repositories/context.tsx:15-21` の `RepositoryProvider`。`useCurrentUser` の `useEffect(() => auth.subscribe(setUser), [auth])`（`context.tsx:35`）と同形で `useEffect(() => { void uploadQueue.start(); }, [...])` を1つ足せる。**ただし `createMockRepositories()` 内で start() を呼ぶとテストで自動起動して fake timer 制御が乱れる**ため、**start() はテストから明示呼びできるよう public メソッドにし、Provider 側で起動**する設計が良い（設計の「同関数内 or useEffect で1回」のうち**後者を推奨**）。
- **テスト容易性は良好**。jest 30 + babel-preset-expo（`jest.config.js`、`testEnvironment: 'node'`）。fake timer は jest 標準で利用可（`jest.useFakeTimers()` / `jest.advanceTimersByTimeAsync()`）。バックオフは `setTimeout`（設計 §プロセッサ91）なので fake timer で前進可能。**注意**: バックオフ後の再キックは Promise（`promotePhoto`）解決を挟むため、`advanceTimersByTime`（同期）では Promise マイクロタスクが進まない。**`await jest.advanceTimersByTimeAsync(ms)` を使う**こと（リスク2）。
- **`start()` は冪等に**（設計リスク §132「二重起動しない」）。テストで複数回 await されても多重ループにならないようガードフラグを持つ。

### 確認4: AsyncStorage の本番 import が node テストに漏れない構成（**実測**）

**設計の前提は不正確。実測結果で上書きする。**
- jest 設定: `jest.config.js` —— `testEnvironment: 'node'`、transform は `babel-preset-expo`、`moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }`、`testMatch: ['**/*.test.ts', '**/*.test.tsx']`。**jest.setup / モックファイルは無し**（`jest.setup*` 不在を確認）。
- node 実行時に jest が解決するのは CommonJS ビルド: `node_modules/@react-native-async-storage/async-storage/lib/commonjs/index.js`（実測 `require.resolve`）。`react-native` フィールド（`src/index.ts`）ではなく `main` フィールドが使われる。
- **実測した挙動（probe テストで確認）**:
  - `require('@react-native-async-storage/async-storage')` → **エラーなし**（`REQUIRE_ERROR: none`）。
  - `AsyncStorage.default` は `getItem/setItem/removeItem/...` を持つ（`MOD_KEYS: [default, useAsyncStorage]`）。
  - `AsyncStorage.getItem('x')` → **Promise を返す**。その Promise が **`ReferenceError: window is not defined` で reject**。
- **結論**: 「import で落ちる」のではなく「**呼び出した Promise が reject する**」。よって：
  1. **import 分離（`storage.ts` だけが async-storage を import）は不要だが、害もない**。本質的な隔離は **DI**：テストは `createMemoryStore()` を注入し、AsyncStorage アダプタのコードパスを一切評価しない。
  2. それでも **本番アダプタ関数を import するファイルをテストが import すると、トップレベルで `import AsyncStorage from ...` していても require は通る**（reject は呼んだ時だけ）。つまり `mock-upload-queue.ts` が `storage.ts` を import し、`storage.ts` が AsyncStorage を import していても、**テストが本番アダプタ関数を呼ばない限り安全**。
  3. より堅牢にするなら：AsyncStorage import を**本番アダプタ関数の内部で動的 import / require 遅延**にする、または **`storage.native.ts` / `storage.ts`（web/test）でプラットフォーム分岐**する。**プラットフォーム分岐の前例あり**: `src/hooks/use-color-scheme.web.ts`（`.web.ts` サフィックス分岐が既にこのリポジトリで使われている）。ただし jest は Metro の platform 解決を使わないため `.web.ts` は jest では効かない —— **テスト隔離目的なら DI 一択**で十分。
  4. 最小実装方針：`storage.ts` に `createMemoryStore()`（Map ベース、テスト用）と `createAsyncStorageStore()`（AsyncStorage ラップ、本番用）を両方置き、**テストは `createMemoryStore()` のみ import/使用**。本番アダプタを呼ばないので reject に遭遇しない。**設計の「テストからは触らせない」は import 分離ではなく『呼ばせない』で達成される**。

---

## 3. 既存テストの構造（26件）と新規テストの置き場所・作法

- テストファイルは3つ（合計の describe/it で 26 ケース）:
  - `src/domain/assign-colors.test.ts`
  - `src/domain/invite-code.test.ts`
  - `src/repositories/mock/mock-post-repository.test.ts`（リアクション + 孤児破棄、`mock-post-repository.test.ts:54-211`）
- **作法（`mock-post-repository.test.ts` が手本）**:
  - import: `import { describe, expect, it } from '@jest/globals';`（`mock-post-repository.test.ts:1`）。
  - **mock は手書きの最小ファクトリ**。`makeUser`(12-14)/`makeTrip`(17-29)/`makePost`(31-42)/`setup`(45-52) のように **plain object を組み立てる**。jest.mock やライブラリは使っていない。
  - 即時 emit / 再通知 / unsubscribe を `received: T[]` 配列に push して件数・最終値を assert（`mock-post-repository.test.ts:109-142`）。**UploadQueue の subscribe テストはこの「配列に push して assert」流儀をそのまま使う**。
  - async は `async/await` + `await expect(...).rejects.toThrow(...)`（`mock-post-repository.test.ts:156-167`）。
- **新規テストの置き場所**: 設計どおり `src/repositories/mock/mock-upload-queue.test.ts`（同ディレクトリ・隣接配置が既存流儀）。マージ純粋関数を `src/domain` に置くなら `src/domain/merge-best-nine.test.ts` を追加（domain テストの前例 2件に倣う）。
- **`createMemoryStore` の置き場所**: `src/repositories/storage.ts` に export し、テストから import。テスト専用 helper を test ファイル内 or 同ディレクトリに置くのも既存流儀に合う。

---

## 4. Implementer が踏む落とし穴

1. **zustand は使わない（既存流儀どおり手書き購読）**。`src/` に zustand の import は **0件**（grep でヒットなし、依存にはあるが未使用）。購読は §1-3 の Map<tripId, Set<listener>> + 即時 emit 手書きが唯一の前例。設計の却下理由（§22）どおり zustand 不採用で実装すること。
2. **fake timer × Promise の合流**: バックオフ `setTimeout` の後に `promotePhoto`(Promise) を再実行するため、`jest.advanceTimersByTime`（同期）では再試行が走らない。**`await jest.advanceTimersByTimeAsync(ms)` を使う**（jest 30 で利用可）。さらに `enqueue` 直後の最初のループも `await Promise.resolve()` / `await flushPromises` を挟まないと `promotePhoto` 解決が観測できない。
3. **AsyncStorage の getItem null**: 初回起動時 `getItem(key)` は `null`（未保存）。`JSON.parse(null)` は `null` を返す（throw しない）が、`JSON.parse('')` は throw。**`const raw = await store.getItem(key); const jobs = raw ? JSON.parse(raw) : [];`** とし、さらに parse を try/catch で囲む（設計 §84「parse 失敗時は空配列」）。**memory store は `getItem` 未設定キーで `null` を返す実装にする**（AsyncStorage の契約と一致させる）。
4. **JSON シリアライズ不能値の混入防止**: `UploadJob` には `Date` を入れない（設計どおり `createdAt: number` epoch ms）。`promotePhoto` 自身は内部で `new Date()`（`mock-post-repository.ts:69`）を作るが、それは確定 Post 側であってジョブには残らない。ジョブに `user`/`localImage` を入れるのは安全（§2-2）。**`error` に Error オブジェクトでなく `String(e)` を入れる**（compose の既存流儀 `String(e instanceof Error ? e.message : e)`、`compose.tsx:95` に倣う）。
5. **二重送信 / uploading 再ピック**: 逐次ループで `uploading` のジョブを再 pick しないこと（設計リスク §132）。`start()` 冪等化（処理中フラグ）。enqueue / retry / rehydrate が同時にループをキックしても**単一の処理チェーン**に直列化する（設計リスク §131：Promise チェーン or 処理中フラグ）。
6. **rehydrate 中の状態**: 起動時 `uploading → pending` 正規化（設計 §84, §133）。永続化に `uploading` が残っているのはクラッシュの証跡なので戻して再送。Mock では再送＝同スロット差し替え（`mock-post-repository.ts:76-80`）で実害なし。
7. **永続化 write の例外握り潰し**: AsyncStorage write 失敗はログのみでメモリ状態維持（設計 §134）。**emit はメモリを真実とする**（`mock-backend.ts` の emit はメモリから読む、`mock-backend.ts:219`）。テストでメモリ経路と store 経路を別 assert（設計 §135）。
8. **`createMockRepositories` の組み立て順**: `uploadQueue` は `posts.promotePhoto` を注入するため、`posts` を const で先に作る必要あり（§1-2）。現状の object リテラル直書き（`index.ts:16-20`）を分解する。

---

## 5. 設計の前提で「実際は違う / 要注意」な点

1. **【最重要】「AsyncStorage の import が node テストに漏れたら落ちる」は不正確**（確認4）。実測では **require は通り、`getItem()` の返す Promise が `window is not defined` で reject**。隔離は import 分離ではなく **DI（memory store 注入で本番アダプタを呼ばない）** で達成する。設計 §80 の「このファイルだけが async-storage を import。テストからは触らせない」は、正しくは「テストからは**呼ばせない**」。`.web.ts` 分岐（前例 `use-color-scheme.web.ts` あり）は jest の platform 解決外なのでテスト隔離には効かない。
2. **楽観UIマージは「純粋関数だけ」では完結しない**（確認1・リスク1）。`src/app/trip/[id]/index.tsx:142` のベスト9は共通コンポーネント `BestNineGrid`（`best-nine-grid.tsx`）を使い、これは `Post[]` 固定・`thumbURL`/`id` のみ参照・**バッジや再送ボタンの口がない**。送信中/failed 表示を index 側に出すには `BestNineGrid` の prop 拡張か別描画が必要。compose 側（`compose.tsx:152-179`）は自前 View グリッドなので分岐しやすい。設計 §119「（トリップ詳細グリッドがあればマージ表示反映）」は実コンポーネント改修を含む——スコープに明記すべき。
3. **`filled`/枚数表示への波及**: `index.tsx:43` `filled = myPosts.length` と `index.tsx:138-140` の「{filled}/9」、compose `compose.tsx:148` の `myPosts.length >= BEST_NINE_SLOTS` 判定・`compose.tsx:41-43` の `firstEmpty` 計算が `myPosts` に依存。マージ済み配列を使うか確定 Post のみを使うかで**「空き枠」判定が変わる**（送信中 Job を埋まり扱いするか）。設計はここを規定していない——Implementer が判断要。
4. **`promotePhoto` 失敗の主因は「色未配布」**（`mock-post-repository.ts:52-54`）。だが compose は色未配布なら早期 return（`compose.tsx:51-58`、`!myColor` でフォーム自体出さない）するため、通常フローでは enqueue 時点で色済み。**enqueue 後〜処理までの間に色配布状態が変わるケースは Mock では稀**だが、失敗ジョブ（`failed`）テストは `promotePhoto` スタブを reject させて作る（設計 §143、本物の color チェックに依存しない）のが素直。
5. **`createdAt` 順序保証の注意**: 設計は `createdAt` epoch ms 昇順で pending を取り出す（§89）。`Date.now()` は同一ティックで同値になりうる（同一スロット2連続 enqueue）。**順序を厳密保証するには `createdAt` 同値時のタイブレーク（enqueue 連番 or id）が要る**。設計 §144「同 slotIndex に2件 → 投入順」を満たすため、`createdAt` だけに頼らず**配列の挿入順を保持**（pending を配列前方から取る）方が安全。
6. **`generateId('job')` が使える**: `src/domain/id.ts:9-13` の `generateId(prefix)` がジョブ ID 生成にそのまま使える（既存 `generateId('post')` 前例、`mock-post-repository.ts:62`）。新規 ID ユーティリティ不要。
7. **`Unsubscribe` 型は既存を再利用**: `src/repositories/types.ts:11` `export type Unsubscribe = () => void;`。`UploadQueue.subscribe` の戻り値型はこれ。設計の interface（§51）と一致。

---

## 付録: 主要 file:line 索引

| 対象 | 場所 |
|---|---|
| Repositories 束 | `src/repositories/types.ts:138-142` |
| PromotePhotoInput / AuthUser / LocalImage | `src/repositories/types.ts:44-52 / 14-18 / 21-25` |
| Unsubscribe 型 | `src/repositories/types.ts:11` |
| 注入(useMemo) / start 用 useEffect 前例 | `src/repositories/context.tsx:17 / 35` |
| createMockRepositories | `src/repositories/mock/index.ts:13-21` |
| subscribe/emit 三点 | `src/repositories/mock/mock-backend.ts:34 / 188-194 / 218-221 / 141-144` |
| promotePhoto 本体・失敗源 | `src/repositories/mock/mock-post-repository.ts:36-103（色未配布 52-54）` |
| useTripPosts（フック手本） | `src/hooks/use-trips.ts:80-99` |
| マージ先 myPosts（compose / detail） | `src/app/trip/[id]/compose.tsx:35 / src/app/trip/[id]/index.tsx:41` |
| BestNineGrid（共通グリッド・Post固定） | `src/components/best-nine-grid.tsx:9-21, 38, 43` |
| jest 設定 | `jest.config.js`（node / babel-preset-expo / setup なし） |
| テスト作法手本 | `src/repositories/mock/mock-post-repository.test.ts:1, 12-52, 109-142, 156-167` |
| generateId | `src/domain/id.ts:9-13` |
| platform 分岐の前例 | `src/hooks/use-color-scheme.web.ts` |
| AsyncStorage 解決パス | `node_modules/@react-native-async-storage/async-storage/lib/commonjs/index.js`（main） |
| AsyncStorage node 実測 | require OK / `getItem()` Promise が `ReferenceError: window is not defined` で reject |
