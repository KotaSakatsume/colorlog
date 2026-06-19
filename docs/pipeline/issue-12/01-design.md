# 01 Architect — 認証UI配線（匿名→Apple連携・Mock基盤）

Issue: #12
Stage: 1/5 Architect

## 方針（1行）
`AuthUser` に `isAnonymous` を足し、`AuthService.linkWithApple()` を MockAuthService 上で simulate（匿名→連携・冪等・subscribe通知）として実装、profile/create/join 画面は `useCurrentUser` 経由でこの状態を購読し通常 UIButton で導線を出す（native/Firebase は interface 継ぎ目のみ）。

## 設計方針（5-7行）
- **型**: `AuthUser` に `isAnonymous: boolean` を必須追加（uid/displayName/photoURL は据え置き）。`AuthService` に `linkWithApple(): Promise<AuthUser>` を追加。返り値は連携後ユーザー、購読者にも同値を通知。
- **データフロー**: 画面 → `useCurrentUser()`（subscribe購読）で状態取得 → ボタンが `auth.linkWithApple()` 呼出 → MockAuthService が内部 user を更新し `listeners.forEach` で通知 → `useCurrentUser` の `setUser` で UI 即再描画。既存 `updateProfile` と同じ通知経路に乗せる（新規メカニズムを足さない）。
- **MockAuthService**: 初期 `isAnonymous: true`。`linkWithApple()` は `isAnonymous` を `false` 化し displayName を Apple 由来名（Mock固定文字列、例 `'Apple ユーザー'`。ただし既存 displayName が初期値以外＝ユーザー編集済みなら維持）に更新、通知。**既に連携済み（`isAnonymous===false`）なら no-op で現在 user を返す（冪等）**。
- **DB変更**: なし（Firestore/型スキーマ・seed の Trip 構造に影響なし）。`isAnonymous` は AuthUser 限定。
- **エラーハンドリング**: Mock は失敗系なし（`Promise.resolve`）。画面側はボタンに `loading` を持たせ、将来の Firebase 実装での reject に備え try/catch で `Alert` 表示の骨だけ用意（Mock では発火しない）。
- **隔離方針**: 画面・Mock・domain は `expo-apple-authentication` を **import しない**。native `AppleAuthenticationButton` も使わず既存 `@/components/ui-button` の `UIButton`。実 Apple 認証＋Firebase `linkWithCredential` は将来の Firebase AuthService 実装の責務。

## 採用理由とトレードオフ
- 採用: **既存 subscribe 通知経路に linkWithApple を相乗り** — `updateProfile` と同じ仕組みで UI 即更新でき追加配線ゼロ、テストも既存パターン流用可。
- 却下: `useAuth` 新規 hook 追加 — `useCurrentUser` で状態は足り、`auth` は `useRepositories().auth` で取れるため hook 二重化は不要（画面で `const { auth } = useRepositories()` を使う）。
- 却下: 画面で `expo-apple-authentication` を直接 import し `AppleAuthenticationButton` 表示 — 実 SDK 依存が画面に漏れ DI 隔離が崩れ node jest 不能。Firebase 実装時に AuthService 内へ閉じ込める方針と矛盾。
- トレードオフ: `isAnonymous` を必須にすると既存 `AuthUser` 生成箇所が全て型エラー化（後述）→ 数行の追従コストと引き換えに「初期化忘れ」をコンパイラで検出（optional より安全）。

## スコープ（影響範囲）
変更（既存）:
- `src/repositories/types.ts` — `AuthUser.isAnonymous` 追加、`AuthService.linkWithApple` 追加（~3行）
- `src/repositories/mock/mock-auth-service.ts` — `MOCK_CURRENT_USER` に `isAnonymous: true`、`linkWithApple` 実装（~15行）
- `src/app/(tabs)/profile.tsx` — 状態表示＋連携ボタン（~30行）
- `src/app/trip/create.tsx` — 匿名時のみ非ブロッキング CTA（~15行）
- `src/app/trip/join.tsx` — 同上（~15行）

AuthUser 生成箇所の追従（`isAnonymous` 付与）:
- `src/repositories/mock/mock-post-repository.test.ts` の `makeUser`（1関数で全呼出をカバー）
- `src/repositories/mock/mock-upload-queue.test.ts` の inline literal 4箇所（L12/115/147/423 `{ uid:'owner', displayName:'Owner' }`）

新規:
- `src/repositories/mock/mock-auth-service.test.ts` — 初期匿名 / linkWithApple で false 化＋displayName 更新＋subscribe 通知 / 冪等 / 既存 updateProfile・subscribe 非回帰

想定: 1 PR で完結（実コード ~80行 + テスト）。`npx tsc --noEmit` 0、`npx jest` 全 pass（既存 + 追加）。

注意: Issue 本文の画面パスは `app/...` だが実体は **`src/app/...`**（Investigator/Implementer は src/ 配下を対象とすること）。

## やらないこと（3点）
1. 実 Apple 認証（`expo-apple-authentication` の `signInAsync`）と Firebase `linkWithCredential` — 別Issue（Firebase 実装層）。
2. サインアウト / アカウント削除 / `AppleAuthenticationButton`（native）描画。
3. 作成・参加の連携必須化（CTA は非ブロッキング、未連携でも作成/参加は従来どおり可能）。

## リスク
- `isAnonymous` 必須化で既存 `AuthUser` 生成箇所が型エラー → Investigator が全列挙（下記確認事項）。`makeUser` / upload-queue literal / `MOCK_CURRENT_USER` が候補。`mock-trip-repository.ts` の `members[uid]` は `TripMember` 型で AuthUser ではない（影響なしと判定済、Investigator 再確認）。
- 画面が native import で隔離破壊 → 通常 UIButton 固定。Implementer は画面に `expo-apple-authentication` を入れない。
- `linkWithApple` の displayName ソースが未確定（Apple は実認証時にしか名前を返さない） → Mock は固定文字列。ただしユーザーが `updateProfile` で既に名前変更済みの場合に上書きすると編集が消える懸念 → 「初期値（`'あなた'`）のときだけ Apple 名に更新、それ以外は維持」を採用方針とする（Implementer 判断点として明記）。

## Investigator 確認事項
1. **`AuthUser` を生成/組み立てている全箇所の列挙**（`isAnonymous` 必須化での型エラー対象）: `MOCK_CURRENT_USER`、`mock-post-repository.test.ts` の `makeUser`、`mock-upload-queue.test.ts` の inline 4箇所のほか、`{ uid, displayName }` 形のオブジェクトリテラルが他にないか grep で網羅確認。`mock-trip-repository.ts` L72/L122 が `AuthUser` か `TripMember` か最終確認。
2. `useCurrentUser` 以外に `auth`（AuthService）を直接触る hook / 箇所の有無（現状 `useRepositories().auth` を使うのは `profile/edit.tsx` の `updateProfile` のみか）。
3. create.tsx / join.tsx の現状構造（CTA をどこに差し込むか。ScrollView 有無・送信ボタン位置）と、`UIButton` の props（`variant`/`disabled`/`loading` の有無）。
4. profile.tsx の `profileHeader` 配下に連携状態表示＋ボタンを足す際の既存スタイル整合。
5. 既存テスト数の確認（Issue は 72 と記載、`npx jest` で現数を確認しベースライン化）。
