# 01-design.md

- Issue: #23
- Stage: 1/5 Architect
- 対象: メンバーアバター — Humation(`@humation/core`) で配布色に染まる `MemberAvatar`

## 1. 方針サマリー（1行）

`@humation/core` を **domain/util 層の純関数アダプタ**で「seed→SVG生成→`var(--hm-*)`色焼き込み」まで完結させ、画面側は `MemberAvatar`（`SvgXml` 描画 + try/catch フォールバック）でラップ。色は **背景slotにメンバー色を当て**、未配布/失敗時は既存の頭文字/ColorChip表現に落として UI を壊さない。

## 2. 設計方針（アーキテクチャ / データフロー / IF）

- **2層構成**: (a) `src/domain/avatar.ts`（純JS・node テスト可。`@humation/core` の import はここだけ）、(b) `src/components/member-avatar.tsx`（RN コンポーネント・`react-native-svg` の `SvgXml` 描画）。Firebase のような隔離は不要（純JS だから domain で import 可）。
- **データフロー**: `userId(seed)` + `color?: AssignedColor` → `buildMemberAvatarSvg({ seed, colorHex })` → `createAvatar(humation1, { seed, background, colors })` → `toRenderData()` の `colors` マップで `var(--hm-*, fallback)` を実 hex に置換した SVG文字列 → `<SvgXml xml={svg} width/height={size} />`。
- **色焼き込みは "createAvatar の colors/background オプション + 出力の正規表現置換" の二段構え（推奨）**: まず `colors`/`background` で正規ルートを通し、念のため最終 SVG文字列に残る `var(--hm-KEY, #fallback)` を **`fallback hex に置換**するセーフティ正規表現（`/var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g` → `$1`）を後段に通す。react-native-svg が `var()` を一切解釈しないリスクを確実に潰す（リスク#1対策）。
- **DB変更なし**。`AssignedColor = {hex,name}` をそのまま入力に使う。seed は `userId`(string) を `createAvatar` の `seed` にそのまま渡す（fnv1a で決定的）。
- **エラーハンドリング**: アダプタは「不正入力でも throw しない」純関数（生成失敗時は `null` を返すか throw→上位 catch）。`MemberAvatar` は try/catch（または生成 null 判定）で **フォールバック描画**（頭文字 or 色swatch）。色置換は失敗しても fallback hex が残るので最悪「既定色アバター」で描画継続。
- **配布色 slot**: 実マニフェストの slot 名は Investigator 確認だが、**`background`（root背景）にメンバー色 hex を当てるのが第一推奨**（視認性最大・キャラ造形を壊さない）。`contrastTextColor(color.hex)` で **リング/縁取り色**を決め、暗色背景でも輪郭が見えるようにする。未配布(`color` 無し)は無彩(`theme.backgroundSelected` 相当)を background に。

## 3. 採用理由とトレードオフ

- **採用: colors/background オプション + 出力正規表現の二段焼き込み** — 正規ルートで意図通り当て、react-native-svg の `var()` 非解釈を保険の置換で確実に潰せる（色が出ない最大リスクを単独で解決）。
- 却下A: `toString()` だけ使い全面正規表現置換 — `colors` マップ無しだと slot とhexの対応が不明で置換キーを総当たりになり脆い。
- 却下B: `createAvatar` の `colors` のみ依存（出力置換しない） — react-native-svg が `var()` を出力に残したまま既定色描画する失敗が再現しうる（事前調査の警告そのもの）。保険無しは不採用。
- 却下C: アバター生成を画面コンポーネント内で直書き — node テスト不可・再利用不可。純関数アダプタに切り出して `npx jest` で決定性/置換をテストする方が安全。

## 4. `MemberAvatar` 設計

- **props**: `{ userId: string; color?: AssignedColor; size: number; photoURL?: string }`。
- **photoURL 優先（推奨）**: `photoURL` があれば `expo-image` の `<Image>` を描画、無い人だけ Humation アバター（profile.tsx の既存挙動と一致・自前写真を尊重）。
- **描画**: `photoURL` 無し → `buildMemberAvatarSvg({ seed: userId, colorHex: color?.hex })` → 成功なら `<SvgXml ...>`、`color` ありなら `contrastTextColor` 由来色で丸リング（borderColor）を付与。
- **フォールバック**: 生成失敗(null/throw) → 既存表現に縮退（`color` あり→色swatch丸 / 無し→`userId or displayName` 頭文字 + tint背景）。UI は決して空にしない。
- `width/height` は `size` を渡し、外枠は `borderRadius: size/2` で円形クリップ。

## 5. 適用箇所と置換方針

- `src/app/trip/[id]/members.tsx`: 行頭の `styles.swatch`(色丸 View) を `<MemberAvatar userId={uid} color={member.color} size={36} />` に置換。右側の ColorChip/「未配布」表示は**維持**（色名ラベルは色覚配慮で残す）。
- `src/app/(tabs)/profile.tsx`: `profileHeader` の photoURL/頭文字分岐を `<MemberAvatar userId={user.uid} photoURL={user.photoURL} color={先頭の配布色?} size={88} />` に置換。
- `src/components/trip-card.tsx`: **余力枠**。現状アバター画像なし（ColorChip のみ）なので、小サイズ MemberAvatar 追加は任意・別対応可。
- `src/components/color-chip.tsx`: **触らない**（色名ラベル責務はそのまま）。

## 6. 影響ファイル

- 新規: `src/domain/avatar.ts`（アダプタ）、`src/domain/avatar.test.ts`（node テスト）、`src/components/member-avatar.tsx`。
- 変更: `src/app/trip/[id]/members.tsx`、`src/app/(tabs)/profile.tsx`（+任意 `trip-card.tsx`）、`package.json`（依存追加）、必要なら `jest.config.js`/`babel.config.js`（ESM transform 対応・Investigator 判断）。
- 依存追加: `@humation/core@^1.0.1` + `@humation/assets-humation-1`（Implementer が `npm install`、バンドルサイズ記録）。
- 想定規模: 中（アダプタ ~80行 + テスト ~60行 + コンポーネント ~70行 + 適用3箇所の差し替え）。1 PR で完結。

## 7. やらないこと（スコープ外）

1. アバターのカスタマイズUI（パーツ選択画面）・Humation の Figma/CLI 連携。
2. 複数アセットパック対応（`@humation/assets-humation-1` 単一で固定）。
3. 既存 `ColorChip`/`contrastTextColor`/`AssignedColor` の仕様変更、DBスキーマ変更、写真アップロード経路の変更。

## 8. リスク

- **R1（最重要）色が出ない**: react-native-svg が `var()` 非解釈 → 出力 SVG に `var(--hm-*)` 残留で既定色描画。→ 二段焼き込み（§2）+ アダプタテストで「最終 SVG に `var(` が残らない」を assert。
- **R2 ESM 解決**: `@humation/core` が `"type":"module"` ESM。Metro(SDK54) は基本対応だが、**jest は `transformIgnorePatterns` に `@humation` を通す**必要が出る可能性大。Investigator が要確認、必要なら jest config 調整。
- **R3 assets バンドルサイズ**: 埋め込みSVG マニフェストのサイズを Implementer が `du`/`npm ls` で記録。過大なら警告。
- **R4 決定的 seed の偏り**: 同 userId→同アバターは仕様通りだが、fnv1a の分布偏りでメンバー間が似る恐れ。→ 受容（背景色で識別できる）。気になれば seed に salt を混ぜる案を別途。
- **R5 既存API破壊**: MemberAvatar は追加コンポーネント・既存 props 不変。photoURL 優先で profile 既存挙動を維持し破壊しない。

## 9. Investigator 確認事項

1. `@humation/assets-humation-1` の **実 export 名**（`humation1` 等）と manifest の **color slot 一覧**（hair/clothes/skin/stroke/background 等の実キー名）・**viewBox**。
2. `@humation/core` の `createAvatar` / `toRenderData()`（`{viewBox, background, colors, content}`）/ `toString()` の正確な型シグネチャ。`colors`/`background`/`selections`/`crop` オプションの受け取り形。
3. **Metro と jest が ESM(`"type":"module"`) を解決できるか**。jest の `transformIgnorePatterns`/`extensionsToTreatAsEsm` 調整要否。SDK54 Metro での import 可否を実 import で検証。
4. `react-native-svg` `SvgXml`（v15.12.1）の正しい import/使い方（`import { SvgXml } from 'react-native-svg'`、width/height prop）。
5. 現状アバター表示箇所の確定: `members.tsx`(swatch View)、`profile.tsx`(photoURL/頭文字分岐)、`trip-card.tsx`(ColorChip のみ・画像なし)、`color-chip.tsx`(色名ラベル・置換対象外)。
6. 焼き込み正規表現が拾うべき `var(--hm-*)` の **実出力パターン**（fallback hex の桁数 3/4/6/8・空白有無）を実生成 SVG で確認。
