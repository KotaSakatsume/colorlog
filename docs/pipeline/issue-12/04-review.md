# 04 Reviewer — 認証UI配線（匿名→Apple連携・Mock基盤）

Issue: #12
Stage: 4/5 Reviewer

## 検証結果（自分で実行）
- `npx tsc --noEmit` → exit 0（型エラーなし）
- `npx jest` → 8 suites / **79 passed**（設計目標 79 と一致）
- native 隔離: `grep -rn "expo-apple-authentication|AppleAuthenticationButton" src/` → **該当なし**（画面/Mock/domain いずれにも import なし。jest が node で落ちない）

## 設計準拠
おおむね設計（01-design.md）通り。スコープ逸脱なし。
- `AuthUser.isAnonymous: boolean` 必須追加（types.ts:25-26）— 設計どおり必須。
- `AuthService.linkWithApple(): Promise<AuthUser>` 追加（types.ts:101-105）— 設計どおり。
- MockAuthService の simulate（匿名→false化・displayName ソース・冪等・1回通知）— 設計どおり（後述の正しさ参照）。
- profile のアカウント表示＋連携ボタン、create/join の非ブロッキング CTA（匿名時のみ表示・`host.isAnonymous`/`user.isAnonymous` で分岐、送信 disabled とは非連動）— 設計どおり。
- 画面は `useCurrentUser` / `useRepositories().auth` 経由（profile.tsx:23/26、create.tsx:47、join.tsx:15）。native を import せず `UIButton` 固定 — 設計どおり。
- やらないこと3点（実Apple/Firebase、サインアウト・削除・native ボタン、連携必須化）に手を出していない — 遵守。

判定: **スコープ逸脱なし。設計との差分なし。**

## 申し送り（mock-upload-queue.ts:198 の設計外追従）の検証
申し送りの主張を実コードで検証した。**主張は正確で、変更は妥当。**
- `UploadJob.user` の実体は `domain/types.ts:93` の `{ uid; displayName; photoURL? }` で、`isAnonymous` を持たない独立 inline 構造型。`AuthUser` 必須化により `const user: AuthUser = job.user`（旧）は型エラーになるため、補完が必要だった（tsc 0 を確認）。
- 構造型は変えていない（`UploadJob.user` の定義に手を入れていない）。
- promote 挙動不変: `mock-post-repository.ts` を grep して `isAnonymous` を読む箇所がないことを確認（exit 1 = 該当なし）。`promotePhoto` は uid/displayName/photoURL のみ参照。
- rehydrate 時の誤情報懸念も無害: `enqueue`（mock-upload-queue.ts:67-68）が `user: { uid, displayName, photoURL }` と明示射影し `isAnonymous` を永続化時に意図的に落としている。よって `{...job.user, isAnonymous:false}` の `false` は永続化されず・`promotePhoto` から読まれず、境界復元の局所値にすぎない。

判定: **妥当。must/should なし。**

## 指摘リスト

### must
なし。

### should
なし。

### nit
- **[nit] mock-upload-queue.ts:200** `isAnonymous: false` 固定の意図はコメントで明記されているが、`AuthUser` 自体が将来 Firebase 実装で別フィールド（例: `email`）を増やすと、ここの境界復元が再びコンパイルエラー化しうる。現状は無害だが、将来 `AuthUser` 拡張時にこの行が追従ポイントになる旨を `// TODO(firebase):` の形で残すと保守者に親切。修正提案: コメント末尾に `// AuthUser 拡張時はここも追従（promote は uid/displayName/photoURL のみ参照）` の一文を足す。挙動には影響しないため任意。
- **[nit] create.tsx:174-185 / join.tsx:78-89** 両画面の CTA ブロック（`isAnonymous` 分岐・文言・`handleLinkApple`・`linkCta` スタイル）がほぼ完全重複。今は2箇所で許容範囲だが、3箇所目（Issue 想定外の別画面）が出たら `<LinkAppleCta />` 等へ抽出を検討。今 PR では抽出不要（過度な共通化はかえって読みにくい）。
- **[nit] profile.tsx:60-62 / create.tsx・join.tsx の文言不一致** profile は「ゲスト（未連携）のアカウントです」、create/join は「Apple と連携すると端末を変えてもアルバムを引き継げます。」と訴求が異なる。意図的（画面ごとの文脈）と読めるため許容だが、連携済み/未連携の表現トーンを後で統一しておくと UX 一貫性が上がる。

## テスト評価
新規 `mock-auth-service.test.ts`（7 ケース）は設計のリスク箇所を網羅。
- 初期匿名 `isAnonymous===true`（L8-12）— 確認済み
- linkWithApple で false 化＋初期名なら Apple 名へ更新（L14-22）— 確認済み
- displayName 編集済みなら維持（L24-32）— 上書き条件の境界を正しく検証
- subscribe へ連携後ユーザーを **1回だけ** 通知（L34-49、`toHaveLength(2)`＝初期1＋連携1。重複なし）— 確認済み
- 連携済み再呼び出しの冪等（状態不変・**追加通知なし** `toHaveLength(1)`）（L51-66）— 確認済み
- updateProfile 非回帰（L68-79）・subscribe/unsubscribe 非回帰（L81-92）— 確認済み

カバー漏れの評価:
- リスク箇所（false化・名前上書き条件・冪等・通知1回）はいずれも意味のあるアサーションでカバー済み。
- 画面（profile/create/join）の CTA 表示条件・`handleLinkApple` の loading/Alert 経路はテストなし。ただし設計は「画面はロジックを持たず状態購読のみ」で、Mock は reject しない（Alert は将来 Firebase 用の骨）ため、現段階で画面テスト未追加は許容範囲（should ではなく情報共有）。将来 Firebase AuthService 実装時に「linkWithApple reject → Alert 表示・loading 解除（finally）」のケースを足すこと。

判定: **十分。追加必須テストなし。**

## セキュリティ
確認済み: 該当なし。
- 入力検証: linkWithApple は引数なし・Mock 内部状態遷移のみ。外部入力なし。
- 認可: Mock 段階、認可境界の変更なし。実 Apple/Firebase 連携は本 PR スコープ外。
- 機密情報: トークン・認証情報の扱いなし（固定文字列のみ）。`Alert` に出すのは `e.message`（Mock では発火しない）で機密漏洩経路なし。
- インジェクション・依存脆弱性: 新規依存追加なし（native ライブラリ未 import）。

## 総評
- 設計準拠・正しさ・テスト・セキュリティすべて問題なし。tsc 0 / jest 79 pass を自分で再現確認。
- 申し送り（upload-queue:198）は実コードで妥当性を裏取り済み（構造型不変・promote 挙動不変・rehydrate に誤情報を残さない）。
- 残課題は nit 3件のみ（保守性・文言の好みレベル）。must は **0件**。

**マージ可否: approve（must なし）**
