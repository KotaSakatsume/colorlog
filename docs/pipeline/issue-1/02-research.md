# 調査レポート — QR招待 + ベスト9リアクション

Issue: #1
Stage: 2/5 Investigator

入力: `docs/pipeline/issue-1/01-design.md`（Architect 設計）のみ。SDK 54 前提（実体は `expo: ~54.0.0` / RN 0.81.5 / React 19.1）で検証した。

---

## 0. 結論サマリー（先に読む）

- 設計の大枠（4層・Repository interface 経由・Firebase 非 import・別購読でリアクション集計）は既存コードの慣習と整合する。**そのまま実装可能**。
- ただし**ブロッカー1件・要修正2件**を確認した（詳細は §6 リスク）:
  1. **`npm test` が現状すでに失敗**する（`babel-preset-expo` が未インストール）。リアクションのユニットテストを書く前に `npm install` が必須。事実: §5 参照。
  2. **`Linking.parse().queryParams?.code` は `string | string[] | undefined` 型**（事実: `node_modules/expo-linking/build/Linking.types.d.ts:1`）。strict 下で `setCode` / `.replace()` に直接渡せない。正規化純関数で吸収する必要あり。
  3. **deep link パス文字列のミスマッチ**。設計は `createURL('join', ...)` → `colorlog://join` だが、実ルートは `/trip/join`（事実: `.expo/types/router.d.ts:9`、ファイル `src/app/trip/join.tsx`）。設計の「join 画面が能動的に useURL を読む」方式なら破綻しないが、生成パスは `trip/join` に揃えるべき。
- ライブラリ検証: `react-native-svg` は SDK 54 が `15.12.1` をピン（事実: `node_modules/expo/bundledNativeModules.json`）。`react-native-qrcode-svg@6.3.21` は**自前の型定義同梱**（`types = 'index.d.ts'`）で `peerDependencies.react-native-svg: '>=14.0.0'` を満たす → **`declare module` ラッパ不要**。

---

## 1. 既存実装パターン（ファイル:行 付き）

### 1.1 import 規約 / パスエイリアス
- 外部ライブラリ → 空行 → `@/` 内部 import の順。例: `src/app/trip/join.tsx:1-10`、`src/repositories/mock/mock-post-repository.ts:1-6`。
- パスエイリアス `@/*` → `src/*`（事実: `tsconfig.json:5-8`）。jest 側も同じ mapping（`jest.config.js:13-15`）。型 import は `import type { ... }` を徹底（例: `src/repositories/types.ts:8`、`mock-backend.ts:11-12`）。
- TypeScript は `strict: true`（事実: `tsconfig.json:3`）。

### 1.2 Repository 注入の仕方（DI）
- 画面/hooks は `useRepositories()` / `useCurrentUser()` 経由でのみデータ層へ触れる（事実: `src/repositories/context.tsx:23-37`）。
- `Repositories = { auth, trips, posts }`（事実: `src/repositories/types.ts:112-116`）。Mock は単一 `MockBackend` を3リポジトリで共有（事実: `src/repositories/mock/index.ts:14-22`）。
- 画面での取り出し例: `const { trips: tripRepo } = useRepositories();`（`src/app/trip/join.tsx:13`）、`const { posts: postRepo } = useRepositories();`（`src/hooks/use-trips.ts:81`）。
- → リアクションは `posts`（PostRepository）に生やす設計と整合。新しい束フィールドは追加しない。

### 1.3 購読パターン（subscribe* + hook）
**Backend 側（subscribe* の標準形）**: `subscribePosts`（事実: `src/repositories/mock/mock-backend.ts:120-126`）。
- リスナーを `Map<key, Set<Listener>>` に登録 → **登録直後に初期値を即時 emit**（`mock-backend.ts:124`）→ `() => set.delete(listener)` を返す。
- mutation メソッドは値を更新後に `emitXxx(key)` でそのキーのリスナーへ再通知（例: `putPosts` → `emitPosts`、`mock-backend.ts:97-100, 135-138`）。

**Repository 側**: backend へ委譲するだけ（事実: `src/repositories/mock/mock-post-repository.ts:11-13`、`subscribeToTripPosts`）。

**hook 側（標準形）**: `useTripPosts`（事実: `src/hooks/use-trips.ts:80-99`）。
- `useEffect` 内で `subscribeToXxx(...)` → `setState` → cleanup で `unsubscribe`。依存配列は `[repo, key]`。
- → `subscribeToTripReactions(tripId, userId, listener)` の hook（`use-reactions.ts`）は `useTripPosts` をテンプレに、依存配列に `userId` も含める形でよい。

### 1.4 エラーハンドリング規約
- データ層: `throw new Error('日本語メッセージ')`（例: `src/repositories/mock/mock-post-repository.ts:18,23,28,32,61`、`mock-trip-repository.ts:47,52,57`）。
- 画面: `try/catch` で `Alert.alert('見出し', String(e instanceof Error ? e.message : e))`（事実: `src/app/trip/join.tsx:31-34`、`create.tsx:103-106`、`trip/[id]/index.tsx:55-57`）。
- → `toggleReaction` の不正絵文字も `throw new Error(...)`、画面側は同パターンで握る。

### 1.5 命名規約
- Backend: `subscribeXxx` / `getXxx` / `putXxx` / `emitXxx`（private）。Repository interface: `subscribeToXxx` / 動詞名詞。Input 型: `XxxInput`（例: `PromotePhotoInput`、`src/repositories/types.ts:44`）。hook: `useXxx`。コンポーネント: kebab-case ファイル名 + PascalCase export（例: `best-nine-grid.tsx` → `BestNineGrid`）。
- → 設計の `subscribeToTripReactions` / `toggleReaction` / `ToggleReactionInput` / `useReactions` / `ReactionBar` はすべて既存命名と整合。

### 1.6 mutation の「原子性」コメント慣習
- 各 mock mutation は「単一スレッドなので原子的（= トランザクション相当）」とコメントで明記（事実: `mock-backend.ts:8-9, 68`、`mock-post-repository.ts:67-68`、`mock-trip-repository.ts:135-136`）。
- → `toggleReaction` も同じトーンのコメントを添えると一貫する。

---

## 2. QR招待 — 事実調査

### 2.1 app.json の現状（scheme / deep link）
- 事実: `app.json:8` → `"scheme": "colorlog"` が**既に設定済み**。deep link 用の追加設定（intentFilters / associatedDomains 等）は無し。
- plugins に `expo-router`（`app.json:30`）と `typedRoutes: true` / `reactCompiler: true`（`app.json:51-54`）。
- → 設計通り **app.json 変更不要**。`react-native-svg` は autolinking で config plugin 不要（プラグイン配列に svg を足す必要なし）。

### 2.2 expo-linking
- 事実: `package.json:23` に `"expo-linking": "~8.0.12"` が**既に依存に存在**、`node_modules/expo-linking` も `8.0.12` でインストール済み。SDK 54 ピン値と一致（`bundledNativeModules.json` の `"expo-linking": "~8.0.12"`）。→ **追加インストール不要**。
- 現状コードベースで `Linking` / `useURL` / `createURL` は**未使用**（`grep -rn "expo-linking\|Linking\." src/` がヒット0）。本 Issue が初導入。
- API 型（事実: `node_modules/expo-linking/build/createURL.d.ts:25,31`、`Linking.d.ts:66`）:
  - `createURL(path, { scheme?, queryParams?, isTripleSlashed? }): string`
  - `parse(url): ParsedURL`
  - `useURL(): string | null`
- **型の落とし穴**: `QueryParams = Record<string, undefined | string | string[]>`（事実: `Linking.types.d.ts:1`）。`parse(url).queryParams` は `QueryParams | null`（`Linking.types.d.ts:12`）。→ `queryParams?.code` は `string | string[] | undefined`。strict 下で **そのまま `setCode(string)` 不可**。`Array.isArray` 分岐 or `String(...).replace(/[^0-9]/g,'')` で正規化する純関数に切り出すこと（テスト容易・§8）。

### 2.3 react-native-svg / react-native-qrcode-svg のバージョン整合と型
- 事実: いずれも**現状未インストール**（`node_modules/react-native-svg` 無し、`node_modules/react-native-qrcode-svg` 無し）。
- **react-native-svg**: SDK 54 ピン = `15.12.1`（事実: `node_modules/expo/bundledNativeModules.json` → `"react-native-svg": "15.12.1"`）。→ **必ず `npx expo install react-native-svg`**（`npm install` は SDK 非整合版が入る恐れ）。Expo Go 同梱モジュールのため Expo Go で動作。
- **react-native-qrcode-svg**: npm 最新 `6.3.21`（事実: `npm view`）。
  - `peerDependencies = { react: '*', react-native: '>=0.63.4', react-native-svg: '>=14.0.0' }` → RN 0.81.5 / svg 15.12.1 を満たす。
  - `types = 'index.d.ts'`（事実: `npm view ... types`）→ **型定義を同梱**。`@types/react-native-qrcode-svg` は存在しない（npm に無し）が、本体同梱で足りる見込み → **`declare module` ラッパは原則不要**。
  - 依存に `qrcode` / `text-encoding` / `prop-types`(純JS) を持つ。ネイティブ追加なし。
  - 設計の「型エラー時は薄い `declare module` で回避」は**保険として残してよい**が、現時点の事実では不要。Implementer は `tsc --noEmit` で確認すること（React 19 で props 型が崩れる事例は確認できていない＝推測欄に記載）。

### 2.4 join.tsx / create.tsx の差し込み箇所
- `join.tsx`: `code` state（`src/app/trip/join.tsx:17`）、送信時のみ数字正規化 `code.replace(/[^0-9]/g, '')`（`join.tsx:22`）。→ deep link 受信は **`useURL()` で取得 → 同じ正規化 → `setCode`** を `useEffect` で差し込む（設計通り）。既存の `handleJoin` 正規化はそのまま流用。
- `trip/[id]/index.tsx`: 招待コードカードが既にある（`src/app/trip/[id]/index.tsx:94-106`、`inviteCode.code` を表示）。→ ここに `<QrInvite code={inviteCode.code} />` を**カード内へ追加**するのが最小差分。`inviteCode` は `useTripInviteCode(id)`（`index.tsx:27`、hook 実体 `src/hooks/use-trips.ts:50-77`）で既に解決済み。
- `create.tsx`: 作成完了で `router.replace({ pathname: '/trip/[id]', params: { id } })`（`src/app/trip/create.tsx:102`）。→ 作成完了画面は **trip 詳細へ遷移する**ので、QR は詳細画面（§上記）に置けば「作成完了でも見える」を満たす。create.tsx 自体への QR 差し込みは不要の可能性が高い（設計 §5 は「作成完了で表示」と書くが、実体は詳細へ replace するため詳細カードで充足）。← 要 Architect 申し送り（§6 推測欄）。

---

## 3. リアクション — 事実調査

### 3.1 MockBackend ストア構造（追加先）
- 事実: `MockBackend` は `trips` / `postsByTrip` / `inviteCodes` の Map と、対応する `*Listeners: Map<key, Set<Listener>>` を持つ（`src/repositories/mock/mock-backend.ts:19-25`）。
- 既存 emit/subscribe の型エイリアスは冒頭に定義（`mock-backend.ts:14-16`）。→ 設計の `reactionsByPost: Map<string, Map<string, ReactionEmoji>>` と `reactionListeners: Map<tripId, Set<ReactionsListener>>` を同じ場所・同じ流儀で追加するのが前例通り。
- **集計の走査元**: `getPosts(tripId)`（`mock-backend.ts:58-60`）で当該トリップの全 post を取れる。`summarize` はこれを走査し `counts` を積む。
- **delete 連動の前例**: `deleteTrip` は `trips`/`postsByTrip`/該当 `inviteCodes` を削除し emit する（`mock-backend.ts:81-95`）。→ ここに「該当 tripId 配下 post の `reactionsByPost` エントリ破棄」を追記する箇所が明確。
- **差し替え時の postId 変化**: `promotePhoto` は差し替え時 `newPost`（**新 id**、`mock-post-repository.ts:40-50`）で旧 post を置換（`mock-post-repository.ts:57`）。→ 旧 postId の `reactionsByPost` が孤児化する。設計通り破棄が必要。ただし**現状 `MockPostRepository.promotePhoto` は backend の `reactionsByPost` を一切知らない**ので、破棄ロジックを backend 側（`putPosts` か新メソッド）に持たせる設計判断が要る（§6 リスク）。

### 3.2 PostRepository への追加（interface）
- 事実: `PostRepository` は現状 `subscribeToTripPosts` / `promotePhoto` の2メソッド（`src/repositories/types.ts:99-109`）。`Unsubscribe` 型（`types.ts:11`）、`AuthUser` 型（`types.ts:14-18`）は既存。
- → 設計の `subscribeToTripReactions` / `toggleReaction` / `ToggleReactionInput` を `types.ts` に追記。`ReactionEmoji` / `ReactionSummary` は `@/domain/types` から import（設計 §2.2 のシグネチャと整合）。**既存 `promotePhoto` は不変** → 既存実装・テストへの破壊なし。

### 3.3 domain/types.ts への追加
- 事実: `src/domain/types.ts` は型 + 定数（`BEST_NINE_SLOTS = 9`、`types.ts:74`）を export する場所。`as const` 配列の前例はこのファイルには無いが、`src/domain/colors.ts` の `COLOR_POOL` 等で同種パターンあり。→ `REACTION_EMOJIS = [...] as const` / `ReactionEmoji` / `ReactionSummary` を追加（設計 §2.1 通り）。Firebase 非依存（時刻は `Date`、`types.ts:5-6` の方針）を維持。

### 3.4 seed.ts の現状
- 事実: `seedMockData(db)` が trip1〜4 を投入（`src/repositories/mock/seed.ts:60-161`）。post 生成は `makePosts`（`seed.ts:30-46`）が `id = ${tripId}_${userId}_${i}` の**決定的 postId**を作る。→ 初期リアクションを seed する場合、この決定的 id を参照できる（テスト・手動確認に有利）。
- seed 投入は `seedTrip` / `seedPosts` / `seedInviteCode`（`mock-backend.ts:29-39`）。→ `seedReactions(postId, Map<uid,emoji>)` を足すならこの並びに追加。**任意**（設計 §4.1）。

### 3.5 album.tsx / best-nine-grid.tsx の現状構造
- `album.tsx`: メンバーごとに `BestNineMini posts={memberPosts} color=...`（`src/app/trip/[id]/album.tsx:53`）。`BestNineMini` は**タップ不可・小サイズ**（`best-nine-grid.tsx:60-82`）。
- `best-nine-grid.tsx`: 2 export = `BestNineGrid`（編集グリッド、`src/components/best-nine-grid.tsx:21-57`）と `BestNineMini`（`best-nine-grid.tsx:60-82`）。`BestNineGrid` の Props は `posts/color/onPressSlot/editable`（`best-nine-grid.tsx:9-18`）。
- 使用箇所: `BestNineGrid` は `trip/[id]/index.tsx:140-145`（編集グリッド）。`BestNineMini` は `album.tsx:4,53`。
- → リアクション overlay/prop は**必ず optional** で追加（設計 §7 のリスク通り）。`index.tsx` の編集グリッド呼び出し（`index.tsx:140`）と `album.tsx` の mini 呼び出し（`album.tsx:53`）を**壊さない**ことが受け入れ条件。
- **注意**: 設計 §5 は「詳細グリッド `best-nine-grid.tsx`」と書くが、トリップ詳細 (`index.tsx`) は**自分のベスト9のみ**を編集表示する画面。他人の写真への「リアクション」UI 的に自然なのは album（全メンバー閲覧）側。詳細での操作は「自分の写真に自分でリアクション」になり仕様的に不自然になりうる → §6 推測欄で申し送り。

---

## 4. 参考前例（このリポジトリ内）

1. **「別購読を1本足して画面に重ねる」前例 = `useTripInviteCode`**（`src/hooks/use-trips.ts:50-77`）。trip 購読に乗せて派生データ（招待コード）を解決し、`active` フラグで非同期の後勝ちを防ぐ。`subscribeToTripReactions` の hook 化はこれが最も近い前例。
2. **「backend に新ストア + listener セット + 即時初期 emit」前例 = `subscribePosts`/`emitPosts`/`putPosts` 三点セット**（`src/repositories/mock/mock-backend.ts:97-100, 120-126, 135-138`）。reactions の subscribe/emit/toggle はこの三点セットを丸ごと踏襲する。
3. **「純粋関数 + 決定的テスト」前例 = `assignColorsToTrip` とそのテスト**（`src/domain/assign-colors.ts` / `src/domain/assign-colors.test.ts:40-100`）。`describe`/`it`、`@jest/globals` から `describe, expect, it` を import、決定的入力（`identityShuffle`）で順序を固定。集計 `summarize` や code 正規化はこの粒度の純関数に切り出すとテストしやすい。

---

## 5. 既存テストの状況

- **テストランナーは現状壊れている（ブロッカー）**。`npx jest` 実行で `Cannot find module 'babel-preset-expo'`（事実: 実行ログ）。`jest.config.js:11` が `presets: ['babel-preset-expo']` を要求するが、`node_modules/babel-preset-expo` が**未インストール**（`ls` でヒット0、`node_modules/.package-lock.json` に記録なし）。`package-lock.json` には記載あり（grep 3 件）→ **`npm install` で復旧する見込み**。テストを1つでも書く前にこれを直さないと「テスト追加」自体が検証不能。
- 既存テストは `src/domain/assign-colors.test.ts` のみ（事実: `find src -name '*.test.ts*'`）。**Mock backend / repository 層・購読・画面のテストは0件＝カバレッジ皆無**。
- jest 設定: `testEnvironment: 'node'`、`testMatch: ['**/*.test.ts', '**/*.test.tsx']`、`@/` mapping あり（事実: `jest.config.js:8-16`）。
- → 新規テスト配置: `src/repositories/mock/mock-post-repository.test.ts`（設計通り、node 環境で RN 非依存に書けば動く）。`MockBackend` を直接 new + `seedTrip`/`seedPosts` して `toggleReaction` を検証する形が `node` 環境と整合（RN コンポーネントを import しないこと）。
- **テスト手薄箇所**: `MockBackend` の delete 連動・`promotePhoto` 差し替え経路には**既存テストが一切ない**。reactions の孤児破棄を足す際、ここを壊しても気づけない → 同テストファイルで `deleteTrip`/差し替えのリアクション破棄を必ずカバーする（設計 §8 ⑥に対応）。

---

## 6. リスク箇所（壊しうる / 落とし穴 / テスト手薄）

### リスク1（ブロッカー・テスト基盤）: `npm test` が現状すでに失敗する
- 根拠: `npx jest` → `Cannot find module 'babel-preset-expo'`（実行ログ）。`jest.config.js:11` が要求、`node_modules/babel-preset-expo` 不在。
- 影響: 設計 §8 のユニットテストを「追加」しても **CI/ローカルで緑にできない**。Reviewer 段でテスト未実行のまま通過する危険。
- 対策: Implementer は着手前に `npm install`（lockfile には存在）でランナーを復旧 → `npx jest` が既存 1 ファイル緑になることを確認してからテストを足す。

### リスク2（壊しうる・strict 型）: `Linking.parse().queryParams.code` の型と Router パス
- 根拠（型）: `QueryParams = Record<string, undefined | string | string[]>`（`node_modules/expo-linking/build/Linking.types.d.ts:1`）。`code` は `string | string[] | undefined`。strict 下で `setCode(...)` / `.replace(...)` に直渡し不可 → コンパイルエラー。
- 根拠（パス）: 実ルートは `/trip/join`（`.expo/types/router.d.ts:9`、`src/app/trip/join.tsx`）。設計 §3.2 の `createURL('join', ...)` は `colorlog://join` を生成し、`/trip/join` と一致しない。
- 影響: ① 型を握り潰すと `any` 化して strict 規律が崩れる。② 生成 URL を実機 OS が開いたとき Expo Router の自動解決先が想定とずれ、`useURL()` には届くが Router 側で 404 的挙動になりうる。
- 対策: `code` 正規化を `normalizeInviteCode(raw: string | string[] | undefined): string` の純関数に切り出し（テスト容易・設計 §8 ②に合致）。生成パスは `createURL('trip/join', { queryParams: { code } })` に揃える（要 Architect 確認＝§7）。

### リスク3（壊しうる・データ整合 / テスト手薄）: 差し替え・削除時のリアクション孤児
- 根拠: `promotePhoto` 差し替えは旧 post を**新 id の post**に置換（`src/repositories/mock/mock-post-repository.ts:40-50,57`）。現 `MockPostRepository` は `reactionsByPost` を知らない（backend の reactions ストアへアクセス経路が無い）。`deleteTrip`（`mock-backend.ts:81-95`）も現状 reactions を消さない。
- 影響: 差し替え後に旧 postId のリアクションが残り、`summarize` が消えた post を参照しないなら表示はされないがメモリリーク的に蓄積。`deleteTrip` 後の再 seed/再利用時に古い集計が混入しうる。**この経路は既存テスト0**（§5）なので回帰に気づけない。
- 対策: reactions 破棄は **backend 側に集約**（`deleteTrip` 内 + `putPosts`/差し替え用の専用メソッド）。`MockPostRepository.promotePhoto` から「旧 postId のリアクション破棄」を backend メソッド経由で呼ぶ。設計 §8 ⑥ をテストで固定。

### （補足リスク）共有コンポーネント `best-nine-grid.tsx` の破壊的変更
- 根拠: `BestNineGrid` は `trip/[id]/index.tsx:140` で、`BestNineMini` は `album.tsx:53` で使用。Props 変更は両呼び出しに波及。
- 対策: リアクション用 prop は **optional**（`reactions?` / `renderOverlay?`）。既存2呼び出しを未指定のまま壊さないことを目視確認（設計 §7 と一致）。

---

## 7. 設計の前提で「実際と違った / 要注意」点（Architect 申し送り）

事実ベースの相違:
- 設計 §3.1「型エラー時は `declare module` で回避」: 現時点では `react-native-qrcode-svg@6.3.21` が型同梱（`types: index.d.ts`）のため**不要の見込み**。保険として残すのは可だが、まず `tsc --noEmit` で確認。
- 設計 §3.2 deep link パス `createURL('join', ...)`: 実ルートは `/trip/join`。生成は `'trip/join'` に揃えるべき（リスク2）。
- 設計 §5「作成完了で QR 表示」: `create.tsx` は完了時に trip 詳細へ `router.replace`（`create.tsx:102`）。QR を詳細カード（`trip/[id]/index.tsx:94-106`）に置けば作成直後も見える → `create.tsx` 自体への QR 追加は不要の可能性。

推測（事実でなく要検証、Implementer/Architect 判断事項）:
- リアクション操作 UI を「トリップ詳細グリッド」に置く設計だが、詳細は**自分のベスト9編集専用**画面。他人の投稿が無いので「リアクションを押す」操作が自然に成立するのは album（全メンバー閲覧）側と思われる → 「表示・操作とも album 中心、詳細は自分の集計表示のみ」に寄せるのが妥当か、Architect 確認推奨。
- React 19 + qrcode-svg の props 型崩れは**未確認**（コンパイルして初めて分かる）。「型は通るはず」は推測。

---

## 8. Implementer が踏みうる落とし穴（チェックリスト）

1. `react-native-svg` は **`npx expo install`**（`npm install` 禁止）。SDK 54 ピン = 15.12.1。
2. 着手前に `npm install` で `babel-preset-expo` を復旧 → `npx jest` が緑か確認（リスク1）。
3. `Linking.parse().queryParams?.code` は `string | string[] | undefined`。純関数 `normalizeInviteCode` で吸収（strict・リスク2）。
4. deep link 生成パスは `'trip/join'`（リスク2）。`createURL` に委譲し手書き連結しない（dev client では `exp+colorlog://` になるため）。
5. `best-nine-grid.tsx` の新 prop は optional（既存2呼び出し非破壊・補足リスク）。
6. reactions 破棄は backend 側に集約し、`deleteTrip` / 差し替えで必ず消す + テスト（リスク3）。
7. 新規テストは `node` 環境向けに書く（RN コンポーネント import 禁止）。`MockBackend` 直 new + seed で検証（§5）。
8. import 順・`import type`・`throw new Error(日本語)` + 画面 `Alert.alert` の既存規約を踏襲（§1.1, §1.4）。
9. hook は `[repo, key, userId]` 依存で `useEffect` → cleanup unsubscribe。`useTripInviteCode` の `active` フラグ前例に倣う（§4-1）。
