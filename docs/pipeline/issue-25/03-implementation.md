# 03 Implementer — アバターのカスタマイズ

Issue: #25
Stage: 3/5 Implementer

ブランチ: `pipeline/issue-25`（main 直接コミットなし・未コミット）

## 1. 検証結果（必須ゲート）

- `npx tsc --noEmit` = **0**（エラーなし）
- `npx jest` = **103 passed / 103**（既存 88 + 追加 15・全 9 スイート pass）
- `npx expo config --json` = **exit 0**

追加 15 テストの内訳: `avatar.test.ts` に config 拡張 6 + ピッカー 6、`mock-auth-service.test.ts` に avatarConfig 3。

## 2. 変更/新規ファイル一覧（各 1 行の変更意図）

新規:
- `src/app/profile/avatar.tsx` — アバターカスタマイズ画面（ライブプレビュー / スロット別パーツ / 色パレット / 保存・リセット）。@humation は import せず domain ラッパ + MemberAvatar 経由。

変更:
- `src/domain/avatar.ts` — `AvatarConfig` 型・`AVATAR_SELECTION_SLOTS`/`AVATAR_COLOR_SLOTS` 定数・ID 型 re-export を追加。`buildMemberAvatarSvg` に `config?` を受けて `createAvatar` に `selections`/`colors`/`background` を渡す（`bakeColorVars` は不変）。ピッカー用 `listPartsForSlot`/`buildPartPreviewSvg`（var( 焼き込み済み）を追加。境界変換ヘルパ `toHumationRecord` を追加。
- `src/components/member-avatar.tsx` — Props に `config?: AvatarConfig` を追加し `useMemo` の生成呼び出し・依存配列へ伝播（既存呼び出しは無変更で従来挙動）。
- `src/repositories/types.ts` — `AuthUser.avatarConfig?` 追加・`ProfileUpdate` の Pick に `avatarConfig` を追加・`@/domain/avatar` から型 import（一方向）。
- `src/repositories/mock/mock-auth-service.ts` — `updateProfile` に `if ('avatarConfig' in patch)` の 1 行で保存（既存 displayName/photoURL と同じ部分更新方式・subscribe 通知は既存経路）。
- `src/repositories/firebase/firebase-auth-service.ts` — `updateProfile` で avatarConfig を in-memory 反映（型整合・実保存は follow-up・Firebase Auth profile には乗せない）。
- `src/app/_layout.tsx` — `Stack.Screen name="profile/avatar"` を 1 行登録。
- `src/app/(tabs)/profile.tsx` — 「アバターを編集」ボタン（`router.push('/profile/avatar')`）を 1 つ追加。
- `src/domain/avatar.test.ts` — config 適用・ピッカー var 不残・決定性・null 安全のテストを追加。
- `src/repositories/mock/mock-auth-service.test.ts` — avatarConfig 保存・部分更新・リセット・通知の非回帰テストを追加。

## 3. 設計方針への準拠

- `AvatarConfig = { selections?; colors?; background? }`（全 optional・`{}` は後方互換）= 設計 §2-1 のまま。ID は素 string（調査 §1-1 確定）。
- `AVATAR_SELECTION_SLOTS`（bottom/body/head/item/glasses）と `AVATAR_COLOR_SLOTS`（hair/skin/clothes/stroke/bottom）を別定数で公開。`bottom` の selection/color 両空間問題はテストでも担保。`background` は色スロット一覧から除外（既存背景経路と整合）。
- `@humation/*` の import は `avatar.ts` のみ。画面・型は domain 経由。
- 既存 API はすべて optional 追加で後方互換（既存 88 テスト・MemberAvatar/buildMemberAvatarSvg/AuthUser/updateProfile の既存呼び出しは無変更）。

## 4. Investigator が挙げたリスク 3 件への対応

- **リスク1（パフォ・item 43 パーツ × 11.8KB）**: 画面は選択中スロット 1 つ分だけ `listPartsForSlot` を `useMemo`（`[activeSlot, draft.colors]` 依存）で列挙し、横スクロールで描く。全 86 枚同時描画はしない。サムネサイズは 64px。実機描画負荷は Expo Go 確認が必要（→申し送り）。
- **リスク2（型が画面に humation を漏らす / 循環 import）**: `AvatarConfig` は `avatar.ts` に置き `types.ts → avatar.ts` の一方向のみ（`avatar.ts` は repositories を import しない）。画面は `AVATAR_*_SLOTS` 定数で駆動し不正キー混入を実行時に防止。tsc=0 で循環なしを確認。
- **リスク3（var( 焼き込み漏れ / Mock・Firebase 片肺）**: `listPartsForSlot`/`buildPartPreviewSvg` は `createPartPreview` 出力を必ず `bakeColorVars` に通す（テストで var( 不残を assert）。`updateProfile` は Mock・Firebase の 2 実装ともに avatarConfig を受理（Firebase は in-memory・型整合）。Mock 保存・通知の非回帰テストを追加。tsc=0 で interface 実装漏れなしを確認。

## 5. Reviewer 申し送り

- **実機描画・パフォは Expo Go 確認が必要**: item 43 パーツの横スクロール描画と、色変更時のサムネ再列挙（`draft.colors` 依存の `useMemo` 再計算）の体感を実機で確認してほしい。node テストでは関数の正しさのみ担保。
- **`buildPartPreviewSvg` の `slot` 引数**: `createPartPreview` は slot を取らないため現状未使用（`void slot`）。API の対称性のため受けているが、不要なら Reviewer 判断で削れる（設計 §3-2 のシグネチャに合わせて残置）。
- **設計との相違なし**。members マップ反映・Firebase 永続・複数アセットパックは設計 §7 どおり「やらないこと」として未実装。
- **Firebase の avatarConfig は in-memory のみ**（実保存は follow-up）。他メンバー視点では従来どおり seed のまま（設計どおり）。

---

## 6. 差し戻し修正（04-review.md 受領後・Implementer 2 周目）

レビュー総評「要修正」を受けた修正。設計差し戻し不要・軽量結線のみ（スコープ不変）。

### 検証（再）

- `npx tsc --noEmit` = **0**
- `npx jest` = **104 passed / 104**（103 維持 + ゴール6 回帰 1 追加・全 9 スイート pass）

### must 修正（ゴール6 未達: 保存アバターが自分の表示に反映されない）

- `src/app/(tabs)/profile.tsx` — 自分のアバター `MemberAvatar` に `config={user.avatarConfig}` を結線（`useCurrentUser` 経由）。保存後の subscribe 再描画で即反映。optional prop 追加のみで後方互換不変。
- `src/app/trip/[id]/members.tsx` — 自分の行のみ `config={isMe ? me.avatarConfig : undefined}` を結線。他メンバー行は `undefined`（members マップ反映は設計 §7 follow-up・不変）。

### should 修正

- `src/app/profile/avatar.tsx`（プレビュー配布色・指摘#2）— `AuthUser` に「自分の確定配布色」は存在せず（color は per-trip の `member.color`）、profile タブの自分アバターも color 無し表示。よってプレビューも `color` を渡さず profile 表示と背景条件を揃える方針に確定し、ヘッダ JSDoc に明記（設計 §5 の配布色プレビューは配布色の一意な解決経路が無いため follow-up）。過剰実装はしない。
- `src/app/profile/avatar.tsx`（slot 型・指摘#3）— `activeSlot` を `useState<SelectionSlotId>`、`selectPart(slot: SelectionSlotId, …)`、`selectColor(slot: ColorSlotId, …)` に型付け（domain から re-export 済み型を import）。`bottom` の selection/color 二重存在の取り違えを型で予防。実害ゼロ・tsc=0 維持。

### テスト追加（カバー漏れ対応・ゴール6 回帰）

- `src/domain/avatar.test.ts` — 「`config.selections` は seed 既定と**異なる** SVG を生む（ゴール6 反映の担保）」を追加。既存テストは var( 不残のみで「seed 既定と差分が出る」ことを assert していなかった（must 不具合がすり抜けた箇所）。screen の prop 受け渡しは node 対象外のため、profile/members が依存する domain 経路の「反映＝差分」を `not.toBe(seedDefault)` で固定。

### 残置（nit・Reviewer 判断で許容済み）

- `buildPartPreviewSvg` の `void slot`（シグネチャ対称性・JSDoc 明記済み）→ 残置。
- `profile/avatar` の push presentation（UX 判断）→ 残置。

### 申し送り（再レビュー向け）

- 実機描画・色焼き込みの目視・パフォは Expo Go 確認の申し送りを維持（机上不可）。
- Firebase の avatarConfig は in-memory のみ（`onAuthStateChanged` 再発火で消える）。実保存（users ドキュメント）は follow-up で回収。
- members マップ反映（他メンバー視点の設定表示）は設計 §7 follow-up のまま未実装。
