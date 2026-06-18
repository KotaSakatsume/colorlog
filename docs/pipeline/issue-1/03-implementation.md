# 実装サマリー — QR招待 + ベスト9リアクション

Issue: #1
Stage: 3/5 Implementer

入力: `01-design.md`（設計）+ `02-research.md`（調査）のみ。SDK 54 前提で実装。
作業ブランチ: `pipeline/issue-1`（コミットは未実施 = Integrator 段階で行う）。

---

## 0. 段取りの実施結果

- **ブランチ**: `pipeline/issue-1` を作成。
- **テスト基盤の復旧**（調査リスク1）: `npm install` では `babel-preset-expo` が `expo/node_modules` 配下にネストされたままトップレベルに来ず `npx jest` が失敗した。SDK 54 ピン値で `npm install --save-dev babel-preset-expo@~54.0.11` を追加して復旧。既存 `assign-colors.test.ts`（11件）が緑になることを確認してから着手。
- **ライブラリ追加**: `npx expo install react-native-svg`（= 15.12.1, SDK 54 ピン）/ `npm install react-native-qrcode-svg`（= 6.3.21, 型同梱）。`expo-linking` は既存のため追加なし。`react-native-qrcode-svg` は型定義同梱で `declare module` ラッパ不要（調査§2.3 の通り、`tsc` でも型エラーなし）。

## 1. 変更/新規ファイル一覧（各1行）

### 新規
- `src/domain/invite-code.ts` — `normalizeInviteCode`（`string|string[]|undefined`→数字文字列）の純関数。expo-linking 非依存に切り出し node 環境でテスト可能にした。
- `src/domain/invite-code.test.ts` — `normalizeInviteCode` のユニットテスト（数字抽出・配列先頭採用・空入力）。
- `src/components/qr-invite.tsx` — 招待コードを `Linking.createURL('join', {queryParams:{code}})` の URL にして QR 描画するコンポーネント。（※当初 `trip/join` で実装したが Stage4 レビュー must-1 で設計どおり `join` に修正。§7 参照）
- `src/components/reaction-bar.tsx` — `ReactionSummary` を受け取り確定集合の絵文字+件数を表示し `mine` をハイライト、タップで `onToggle` する行。
- `src/hooks/use-deep-link-code.ts` — `Linking.useURL()` を購読し `normalizeInviteCode` で code を取り出す hook。
- `src/hooks/use-reactions.ts` — `subscribeToTripReactions` を購読する `useTripReactions` hook（`useTripPosts` をテンプレに `user.uid` を依存配列に追加）。
- `src/repositories/mock/mock-post-repository.test.ts` — toggleReaction の正常/異常系 + 孤児破棄（delete/差し替え）のユニットテスト。

### 変更
- `src/domain/types.ts` — `REACTION_EMOJIS` / `ReactionEmoji` / `ReactionSummary` を追加（設計§2.1 通り）。
- `src/repositories/types.ts` — `PostRepository` に `subscribeToTripReactions` / `toggleReaction` と `ToggleReactionInput` を追加（既存 `promotePhoto` は不変）。
- `src/repositories/mock/mock-backend.ts` — `reactionsByPost` ストア / `reactionListeners` / `summarizeReactions` / `toggleReaction`（原子的）/ `discardReactions` / `seedReactions` / subscribe/emit を追加し、`deleteTrip` で配下 post のリアクションも破棄。
- `src/repositories/mock/mock-post-repository.ts` — 2メソッドを backend 委譲で実装。差し替え分岐で旧 postId の `discardReactions` を呼ぶ。
- `src/repositories/mock/seed.ts` — trip1 の数件 post に初期リアクションを seed（手動確認用・任意）。
- `src/app/trip/join.tsx` — `useDeepLinkCode` で受信した code を `useEffect` で入力欄へ自動投入。
- `src/app/trip/[id]/index.tsx` — 招待コードカードに `<QrInvite code={inviteCode.code} />` を追加。
- `src/app/trip/[id]/album.tsx` — `useTripReactions` 購読 + 各 post に `<ReactionBar>` を表示し `toggleReaction` を呼ぶ（エラーは既存パターンの `Alert.alert`）。
- `src/components/best-nine-grid.tsx` — `BestNineMini` は変更なし（当初 optional `renderOverlay?` を追加したが Stage4 レビュー should-3 で未使用デッドコードとして削除。§7 参照）。
- `package.json` / `package-lock.json` — `react-native-svg` / `react-native-qrcode-svg` / `babel-preset-expo`(devDep) 追加。

## 2. 主要な実装判断

- **リアクションは別購読**（設計§2.2）。`subscribeToTripReactions(tripId, userId, listener)` は posts 本体と独立。viewer ごとに `mine` が異なるため、backend では viewerUid を束ねた wrapper を listener セットへ登録し、emit 時に viewer ごと再集計して流す方式にした（既存 `subscribePosts`/`emitPosts` の三点セットを踏襲しつつ viewer 差を吸収）。
- **孤児破棄は backend に集約**（調査リスク3）。`deleteTrip` 内と `discardReactions(postId)` の2経路。`MockPostRepository.promotePhoto` の差し替え分岐から `discardReactions(旧postId)` を呼ぶ。
- ~~**deep link パスは `trip/join`**~~（→ Stage4 レビュー must-1 で設計どおり `join` に修正。§7）。`useURL` を能動的に読む方式で Router の自動ナビゲーションに依存しない点は維持。
- **純関数の切り出し**: `normalizeInviteCode` を `expo-linking` を import しない `src/domain/invite-code.ts` に置いた。これにより jest（node 環境）で `expo-linking` の ESM 変換問題を踏まずにテストできる（調査§8-7「RN/native import 禁止」に合致）。

## 3. 設計から逸脱した点（申し送り）

1. ~~**deep link 生成パス**: `createURL('trip/join', ...)` を採用~~ → **撤回**。Stage4 レビュー must-1 で設計どおり `createURL('join', ...)` に修正（router 実ルート `/trip/join` との二重発火懸念を回避）。設計者の意図（join 画面で能動受信）は保持。§7 参照。
2. **`create.tsx` への QR 追加は見送り**: 作成完了は trip 詳細へ `router.replace` するため、QR を詳細カードに置けば作成直後も見える（調査§7）。設計§5 の「作成完了で表示」は詳細カードで充足。
3. **純関数の置き場所**: 設計§5 は「join 画面内インラインでも可」としたが、テスト容易性のため `src/domain/invite-code.ts` に独立させた（設計の許容範囲内）。
4. **リアクション操作 UI は album のみ**: 調査§7 推測の通り、トリップ詳細は「自分のベスト9編集専用」で他人投稿が無く、リアクション操作が自然に成立しない。よって操作・表示とも album（全メンバー閲覧）側に集約。詳細グリッドの `renderOverlay?` の口は Stage4 should-3 で削除済み（未使用デッドコードのため）。

## 4. リスク箇所3件への対応

- **リスク1（テスト基盤・ブロッカー）**: `babel-preset-expo@~54.0.11` を devDependency に追加し復旧。`npx jest` が緑（24件）になることを確認済み。
- **リスク2（strict 型 / Router パス）**: `normalizeInviteCode(raw: string | string[] | undefined): string` の純関数で `queryParams.code` の3つ組型を吸収（`any` 化なし）。生成パスは Stage4 must-1 で `'join'` に修正（router 実ルートと非衝突）。`tsc --noEmit` で当該ファイル群はエラー0。
- **リスク3（差し替え・削除のリアクション孤児）**: 破棄を backend に集約。`deleteTrip` で配下 post のリアクションを削除、`promotePhoto` 差し替えで `discardReactions(旧postId)`。テスト `⑥a deleteTrip`・`⑥b 差し替え`で固定（先に付与→破棄を検証）。

## 5. 検証結果

- **`npx tsc --noEmit`**: 本Issueで新規/変更したファイルはエラー **0**。
  - リポジトリ全体では **19 件**のエラーが残るが、いずれも**本Issueで一切触っていない既存テンプレートファイル**（`animated-icon.tsx` / `app-tabs.tsx` / `app-tabs.web.tsx` / `ui/collapsible.tsx` / `use-theme.ts`）の既存問題。初期コミットが無く `main` 比較は不可だが、変更ファイルを除外したフィルタで本Issue起因0を確認済み。← Reviewer/Integrator 申し送り（既存 baseline 不具合で本Issueのスコープ外）。
- **`npx jest`**: **3 suites / 24 tests すべて pass**。
  - 内訳: 既存 `assign-colors.test.ts`（11）/ `invite-code.test.ts`（4）/ `mock-post-repository.test.ts`（9: 初回トグル①・解除②・付け替え③・viewer 独立④・即時emit⑤・再通知⑤b・不正絵文字⑦・delete孤児⑥a・差し替え孤児⑥b）。
  - 設計§8 の項目を網羅（QR の手動/Expo Go 確認は本段階では未実施）。

## 6. Reviewer への申し送り

- スコープ外（Firebase 差し込み / QR スキャナ / 通知 / 複数絵文字同時押し / リアクション一覧画面）には手を出していない。
- 既存テンプレート由来の tsc エラー19件は本Issueと無関係。別Issueでの baseline 修正が望ましい（本PRでは触らない方針）。
- `BestNineMini.renderOverlay?` は Stage4 should-3 で削除済み（album は per-post `ReactionBar` を維持）。
- リアクション操作を詳細画面にも置くか否か（逸脱点4）は仕様判断のため Architect/Reviewer 確認を推奨。

## 7. レビュー差し戻し対応（Stage 4 → 3 修正ラウンド）

入力: `04-review.md`。must 2件 + should 4件 + テスト2件を反映。

### must
- **must-1（deep link パス逸脱）**: 生成パスを設計どおり `Linking.createURL('join', …)` に戻した（`qr-invite.tsx`）。コメントも `colorlog://join?code=XXXX` に統一。`use-deep-link-code.ts` の docstring も `join` 前提へ更新。`trip/join` の独自採用を撤回（設計判断を尊重）。
- **must-2（useDeepLinkCode の stale 状態）**: `useState` + `useEffect` を廃し、`useMemo` で `url` から直接導出する state レス実装に変更。code 無しリンク（`colorlog://`）やフォアグラウンド復帰で前回 code が残らない。シグネチャは `string | null` のままで、`join.tsx` の自動投入 useEffect（`if (deepLinkCode) setCode(deepLinkCode)`）は変更不要（空文字は `|| null` で null 化されるため誤投入もなし）。

### should
- **should-1**: `reactionListeners` を `ReactionsTrigger = () => void` 型に整理。`subscribeReactions` は viewerUid を束ねた引数なしトリガを登録し、`emitReactions` は `trigger()` を引数なしで呼ぶ。`new Map()` の不自然な受け渡しを解消（viewer ごと再集計・解除の挙動は不変）。
- **should-2**: `ReactionBar` を `React.memo` 化（`ReactionBarBase` を `memo()` でラップ）。**将来 TODO**: 現状は集計更新で全 post の ReactionBar が再評価される Mock 簡略化。Firebase 移行時は **post 単位 onSnapshot に分割**し、変化した post の購読者だけ再描画する。また album 側の `onToggle={(emoji) => handleToggle(post.id, emoji)}` は毎レンダ生成のため memo が完全には効かない（Mock では実害小）。Firebase 分割時に post 単位購読 + 安定クロージャで併せて最適化する。
- **should-3**: 未使用の `BestNineMini.renderOverlay` prop と未使用の `ReactNode` import を削除。album は現方式の per-post `ReactionBar`（グリッド下の操作行）を維持。
- **should-4**: `album.tsx` の `handleToggle` 冒頭に `if (!trip.memberIds.includes(user.uid)) return;` を追加。**メンバー検証は Firebase ルール側で担保**し、UI は楽観的に弾くだけ（Mock では到達不能だが Firebase ルール前提と整合）。

### nit
- **nit-2**: `qr-invite.tsx` のキャプションを「QR を読み取って参加できます」→「このQRから参加リンクを開けます」へ。スキャナ非実装段階の誤解を避ける表現に変更。
- nit-1（import 順）・nit-3（postId 直書き）は本ラウンドでは見送り（スコープ最小化）。

### 追加テスト
- `⑤c Unsubscribe 後はトグルしても通知されない（解除の回帰）` — `subscribeToTripReactions` 解除後の emit が届かないことを検証。
- `⑧ 複数ユーザーが同一 post に異なる絵文字を押すと counts が両方加算される` — alice=❤️ / bob=🔥 で両 counts が 1、viewer 視点 mine が独立することを検証。

### 検証結果（修正後）
- `npx tsc --noEmit`: 本Issue変更ファイルのエラー **0**（既存テンプレ 19 件 baseline は不変・スコープ外）。
- `npx jest`: **3 suites / 26 tests すべて pass**（既存 24 + 追加 2）。
