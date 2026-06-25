# 04 Reviewer — アバターのカスタマイズ

Issue: #25
Stage: 4/5 Reviewer

机上レビュー（実機描画は不可・Expo Go 後）＋ node 検証。基準は `01-design.md` / `02-research.md` / Issue #25 ゴール。

## 検証ゲート（自分で実行）

- `npx tsc --noEmit` = **0**（エラーなし）✅
- `npx jest` = **103 passed / 103**（9 スイート全 pass）✅
- 実機描画・色焼き込みの目視・パフォは Expo Go 確認待ち（机上不可・申し送り維持）。

---

## 指摘リスト

### [must] ゴール6 未達: 保存したアバターがプロフィール/自分のメンバー表示に反映されない

- 箇所: `src/app/(tabs)/profile.tsx:39-44`（および `src/app/trip/[id]/members.tsx:40-45` の `isMe` 行）
- 問題: Issue #25 **ゴール6**「保存後、**プロフィール・自分のメンバー表示でアバターが更新される**（subscribe 経由）」が満たされていない。`avatarConfig` は `updateProfile` で保存され `useCurrentUser` で取得可能になっているが、**それを `MemberAvatar` に渡している箇所がカスタマイズ画面のライブプレビュー以外に 1 つも無い**（`grep` で `config=` は `avatar.tsx` のみ）。結果、ユーザーが保存しても自分のアバターは編集画面の中だけで変わり、プロフィールタブでは seed 既定のまま＝**保存が無意味に見える**。
  - これは設計 §7 / Issue スコープ外の「members マップ反映（他メンバー視点）」とは**別物**。ゴール6 は「自分の」表示で、`useCurrentUser` 経由＝members マップ書き込み不要・cheap。設計 §2-2 自身も「自分のアバターは `useCurrentUser` 経由で即反映でき Issue ゴール 6 を満たす」と書いているが、実装が `config` を渡していないため満たせていない。
- 修正提案:
  - `src/app/(tabs)/profile.tsx:39` の `MemberAvatar` に `config={user.avatarConfig}` を追加。
  - `src/app/trip/[id]/members.tsx:40` の `isMe` 行のみ `config={isMe ? me.avatarConfig : undefined}` を渡す（他メンバーは members マップに無いので従来どおり seed＝設計 §7 follow-up と整合、自分だけ cheap に反映）。
  - いずれも optional prop の追加なので後方互換は不変。

### [should] カスタマイズ画面のライブプレビューに配布色（color）を渡していない

- 箇所: `src/app/profile/avatar.tsx:82-87`
- 問題: 設計 §5「ライブプレビュー: `MemberAvatar` を大きく + `config={draft}` + `color`=配布色」とあるが、プレビューに `color` を渡していない。結果、プレビューの背景が配布色でなく `DEFAULT_BACKGROUND`（#E9E8E6）固定になり、本番（profile/members）の見た目と一致しない。リングも出ない。ユーザーは「保存後に実際どう見えるか」を正しく確認できない。
- 修正提案: 現ユーザーの配布色を解決して渡す。トリップ横断の「自分の配布色」が一意でないなら、せめてプレビューと本番で背景条件を揃える方針（profile タブも color 無しなので、profile に合わせるなら現状で可）。最低限、設計意図（配布色プレビュー）を採るか profile と揃えるかを明示し、ドキュメント上の差分を解消すること。**机上では本番表示との不一致リスクのみ指摘、実機で確認**。

### [should] 不正キー混入を実行時に防ぐ設計だが、画面の slot/part が string でゆるい

- 箇所: `src/app/profile/avatar.tsx:46,55,62`（`activeSlot: string`、`selectPart(slot: string, ...)`、`selectColor(slot: string, ...)`）
- 問題: 設計 §3 / リスク2 の「UI は `AVATAR_*_SLOTS` 定数で駆動して実行時の正しさを担保」は守られている（map で回している）が、`activeSlot`/引数が素の `string` 型のため、将来の改修で `AVATAR_SELECTION_SLOTS` 外のキーを `selections` に書いてもコンパイルで弾けない。`AvatarConfig` のキー型が `@humation` の素 string エイリアスなので型では守れない（調査 §1-1）。現状は実害なしだが保守性リスク。
- 修正提案: `activeSlot` を `useState<SelectionSlotId>(...)`、`selectColor` の `slot` を `ColorSlotId` 型にする（domain から re-export 済み）。型上は string と等価で実害ゼロだが、意図が明示され将来の取り違え（特に `bottom` の selection/color 二重存在）の事故率が下がる。nit 寄りだが `bottom` 衝突リスクがあるため should。

### [nit] `buildPartPreviewSvg` の `slot` 引数が未使用（`void slot`）

- 箇所: `src/domain/avatar.ts:202-208`
- 問題: `createPartPreview` は slot を取らないため `slot` は完全に未使用（`void slot` で握りつぶし）。設計 §3-2 のシグネチャ対称性のため残置、と申し送りにあるが、デッドパラメータは呼び出し側に「slot で何か変わる」誤解を与える。
- 修正提案: 実害は無いので残置でも可。ただし JSDoc に「slot は現状 no-op・将来の検証余地のため」と明記済みなので**そのままで許容**。気になるなら `partId` 単独引数に簡素化。Reviewer 判断＝残置で可。

### [nit] プロフィール編集（edit）は modal、アバター編集は push でプレゼンテーションが不揃い

- 箇所: `src/app/_layout.tsx:21`（`profile/avatar` に `presentation` 無し）
- 問題: `profile/edit` は `presentation: 'modal'`、`profile/avatar` は通常 push。調査 §推測でも触れられた UX 判断事項。グリッド操作の多いアバター編集はフルスクリーン push の方が自然なので**意図的なら問題なし**。一貫性を気にするなら揃える。
- 修正提案: 残置で可（UX 判断）。

---

## 観点別チェック

### 1. 後方互換（must級）→ 確認済み: 破壊なし ✅

- `MemberAvatar.config?` / `buildMemberAvatarSvg.config?` / `AuthUser.avatarConfig?` / `ProfileUpdate`（`Pick` に `avatarConfig` 追加）すべて optional。
- 既存呼び出し（profile/members 既存箇所・edit.tsx の `updateProfile({displayName,photoURL})`）は無変更で通る。
- `config` 省略時＝従来挙動は **`avatar.test.ts` で `withEmptyConfig`/`withUndefined` が `withoutConfig` と完全一致**を assert（`toBe`）＝担保済み。
- 既存 88 テスト含む 103 全 pass＝既存テスト破壊なし。

### 2. 色焼き込み（must級）→ 確認済み: 罠なし ✅

- 本体 `buildMemberAvatarSvg`（`avatar.ts:141`）・ピッカー `listPartsForSlot`（`:189`）・`buildPartPreviewSvg`（`:214`）の **3 経路すべて `bakeColorVars` を通過**。
- `not.toContain('var(')` は jest の moduleNameMapper（`@humation/core` → dist）経由＝**実 @humation 出力に対するアサート**。config 適用後・item 43 枚全サムネ・単発プレビューの 3 ケースで var( 不残を検証＝調査 §2-1 の罠を正しく潰している。
- `config.colors:{hair:'#FF0000'}` 適用後に `#FF0000` が最終 SVG に現れることも assert＝焼き込みが効いている証跡あり。

### 3. 型の健全性 → 確認済み: 妥当 ✅

- `AvatarConfig`（selections/colors は `Partial<Record<string, string>>`）と `toHumationRecord`（undefined エントリ除去で `Partial<Record>` → 非 Partial `Record` の境界を埋める）は strict 下で正しく、tsc=0。`{ glasses: undefined }` を渡すテスト（`avatar.test.ts` risk1 ケース）が undefined 除去経路を実際に通している。
- `types.ts → avatar.ts` の一方向 import（`avatar.ts` は repositories を import しない）＝循環なし。tsc=0 で裏付け。
- `AVATAR_SELECTION_SLOTS`（bottom/body/head/item/glasses）・`AVATAR_COLOR_SLOTS`（hair/skin/clothes/stroke/bottom・background 除外）は調査 §3-1/§3-2 の実 manifest と一致。`bottom` の selection/color 二重存在はテスト「別空間」で担保。

### 4. updateProfile 二箇所 → 確認済み: 整合 ✅

- Mock（`mock-auth-service.ts:40-42`）: `if ('avatarConfig' in patch)` で部分更新。`{}` リセット・他フィールド非破壊・subscribe 通知を 3 テストで担保。
- Firebase（`firebase-auth-service.ts:91`）: in-memory 反映のみ・`fbUpdateProfile` には avatarConfig を乗せない＝型整合・破綻なし（設計どおり follow-up）。
  - 留意（指摘化せず）: `mapFirebaseUserToAuthUser` は avatarConfig を埋めないので、`onAuthStateChanged` 再発火で in-memory avatarConfig は失われる。設計上「実保存は follow-up・in-memory のみ」なので**今回は許容**。follow-up（users ドキュメント）で必ず回収すること。

### 5. パフォ（should）→ 確認済み: 設計どおり ✅（実機は申し送り）

- 画面は `activeSlot` 1 スロット分だけ `listPartsForSlot` を `useMemo(`[activeSlot, draft.colors]`)` で列挙（`avatar.tsx:50-53`）。全 86 枚同時描画はしない＝調査リスク1 対策どおり。
- 色変更時の再列挙は `draft.colors` 依存で必要十分（part 選択では再列挙しない）。
- 実機での item 43 枚横スクロール描画・色変更時の再列挙体感は **机上不可＝Expo Go 確認の申し送りを維持**。

### 6. 隔離/スコープ → 確認済み: 守られている ✅

- `@humation/*` import は `avatar.ts` のみ（`grep` で確認）。画面は domain ラッパ + `MemberAvatar` 経由・`SvgXml` で描画。
- members マップ反映は未実装＝設計 §7 follow-up どおり（ただしゴール6「自分の」反映は別物で must 指摘済み）。

### セキュリティ → 確認済み: 該当なし

- 入力は自分の avatarConfig（自データ）のみ・認可境界なし。`createAvatar`/`createPartPreview` の未知 id は try/catch で null/除外（`avatar.ts:142,176,191,215`）＝インジェクション・クラッシュ経路なし。機密情報・外部入力・依存追加なし（@humation は既存依存）。

---

## テスト評価

追加 15 テスト（domain 12 + mock 3）は意味のある検証をしている:
- 後方互換の `toBe` 一致、色焼き込みの `#FF0000` 出現＋`var(` 不残、item 43 件、決定性、null 安全、`{}` リセット、bottom 二重空間。リスク箇所を的確にカバー。

カバー漏れ（追加推奨）:
- **[must 連動] ゴール6 反映の回帰テストが無い**: 「保存後に profile/自分の member 表示が avatarConfig を使う」結線テストが無いため、上記 must 不具合が gn テストをすり抜けた。画面は node テスト対象外（調査 §8）なので、最低限 `MemberAvatar` に `config` を渡したとき seed 既定と異なる SVG になることを domain レベルで担保するか、結線を目視確認すること。
- [should] `buildPartPreviewSvg` の `slot` 引数が出力に影響しないこと（＝ slot 違いで同 part が同出力）の確認テストがあると、未使用引数の意図が明文化される（nit）。

---

## 設計準拠の判定

- スコープ逸脱: **なし**。members マップ反映・Firebase 永続・複数パック・アニメは設計 §7 どおり未実装。
- 設計との差分: (a) ライブプレビューに `color`（配布色）を渡していない（設計 §5 と差分・should）。(b) ゴール6 の「自分の表示反映」を `config` 結線で実現していない（設計 §2-2 が前提にした反映が実装に落ちていない・must）。型・焼き込み・スロット定数・updateProfile 二箇所は設計どおり。

---

## 総評: **要修正**

must が 1 件残っている（ゴール6 未達: 保存したアバターが自分の profile/member 表示に反映されない）ため **要修正**。Implementer 段階へ差し戻す。

修正は軽量で設計差し戻し不要:
1. `profile.tsx:39` と `members.tsx:40`（isMe 行）の `MemberAvatar` に `config={user.avatarConfig}` を結線（must）。
2. ライブプレビューの配布色方針を決める（should・設計 §5 と整合 or profile と揃える）。
3. 画面の slot 型を `SelectionSlotId`/`ColorSlotId` に（should・bottom 取り違え予防）。

焼き込み・後方互換・型・テスト品質は良好。1〜3 を入れれば approve 見込み。

---

## 再レビュー（差し戻し後・focused re-review）

基準: 前回 must 1 / should 2。`git diff main` + `avatar.tsx` 直読み。tsc/jest 自己実行。

### must 解消の確認 → 解消済み

- ゴール6（保存→自分の表示に反映）の結線が通った:
  - `src/app/(tabs)/profile.tsx:44` 自分アバターに `config={user.avatarConfig}` を追加。
  - `src/app/trip/[id]/members.tsx:45` 自分の行のみ `config={isMe ? me.avatarConfig : undefined}`、他メンバー行は `undefined`（seed 既定）= 設計 §7 follow-up と整合・他メンバー視点は不変。
  - 経路: `avatar.tsx` 保存 `updateProfile({avatarConfig})` → mock の subscribe 通知 → `useCurrentUser` 更新 → profile/自分行が再描画。`useCurrentUser` 経由のため members マップ書き込み不要（cheap）で設計どおり。
- 回帰テスト追加（`avatar.test.ts`）:「config.selections は seed 既定と異なる SVG を生む（ゴール6 反映の担保）」が `buildMemberAvatarSvg(customized) !== buildMemberAvatarSvg(seedDefault)` を `not.toBe` で固定。seed に含まれない head パーツを `find` で選んでから差し替える設計で、偶然一致による偽パスを避けており妥当。

### should 解消の確認 → 2 件とも解消

- ライブプレビューの配布色方針: `avatar.tsx:4-7` のファイル先頭 JSDoc で「配布色はトリップ横断で一意でなく profile タブも color 無しのため、プレビューも color を渡さず profile と背景条件を揃える／設計 §5 の配布色プレビューは確定配布色が無いため follow-up」と明記。本番（profile）との不一致が解消され、判断が文書化された。妥当。
- slot/part の型: `activeSlot` が `useState<SelectionSlotId>`（:51）、`selectPart(slot: SelectionSlotId, ...)`（:60）、`selectColor(slot: ColorSlotId, ...)`（:67）に。domain から型を re-export して使用。`bottom` の selection/color 二重存在の取り違え事故率が下がる。妥当。

### リグレッション / 後方互換 → 確認済み: 破壊なし

- 他メンバー行・既存呼び出しは optional prop 追加のみで不変。
- `@humation` 参照は非テストで `src/domain/avatar.ts`（唯一の import）と `src/app/profile/avatar.tsx`（コメント文のみ・import 無し）の 2 ファイル。画面は domain ラッパ経由を維持。
- `var(` 焼き込み: config 適用後 / item 43 サムネ / 単発プレビュー / `buildPartPreviewSvg` の各経路で `not.toContain('var(')` を維持・追加。

### 検証ゲート（自己実行）

- `npx tsc --noEmit` = 0
- `npx jest` = 104 passed / 104（9 スイート全 pass・前回 103 から回帰テスト +1）
- 実機描画・色の目視・パフォは Expo Go 確認待ち（机上不可・申し送り維持）。

### 残 should / nit（非ブロック）

- [nit] `buildPartPreviewSvg` の `slot` 引数は依然 no-op（JSDoc 明記済み）。残置で可。
- [nit] `profile/edit` は modal・`profile/avatar` は push でプレゼン不揃い。UX 判断、残置で可。
- [申し送り] Firebase 側 avatarConfig は in-memory のみ。`onAuthStateChanged` 再発火で失われる。follow-up（users ドキュメント永続化）で必ず回収。

### 総評: must なし = approve

前回の must（ゴール6 未達）は結線 + 回帰テストで解消。should 2 件も解消。残は nit と既知 follow-up のみで非ブロック。Integrator へ進めて良い。
