# 03-implementation.md

- Issue: #23
- Stage: 3/5 Implementer
- 対象: 配布色に染まる Humation アバター `MemberAvatar`（実 SDK 54）
- ブランチ: `pipeline/issue-23`（main 直コミットなし・未コミット）

---

## 1. 変更/新規ファイル一覧（各 1 行意図）

**新規**
- `src/domain/avatar.ts` — Humation 色焼き込みアダプタ（純関数）。`buildMemberAvatarSvg` / `bakeColorVars`。`@humation/*` の import はここだけ。
- `src/domain/avatar.test.ts` — アダプタの node テスト 9 件（var() 残留回帰・決定性・背景色焼き込み・未配布・不正入力・置換単体）。
- `src/components/member-avatar.tsx` — 写真 > Humation SVG > 頭文字 の 3 段フォールバックを持つ表示コンポーネント。

**変更**
- `src/app/trip/[id]/members.tsx` — 行頭 `styles.swatch`（色丸 View）を `<MemberAvatar size={36} />` に置換。右の ColorChip/未配布表示は維持。死んだ `swatch` スタイルを除去。
- `src/app/(tabs)/profile.tsx` — `profileHeader` の photoURL/頭文字分岐を `<MemberAvatar size={88} photoURL=... />` に置換。orphan になった `Tint`/`useThemeScheme`/`avatar`/`avatarText` を除去。
- `jest.config.js` — `transformIgnorePatterns` で `@humation` を babel 変換 whitelist 化 + `moduleNameMapper` で `@humation/*` を dist エントリへ直接マップ（後述・調査の想定外対応）。
- `package.json` / `package-lock.json` — `@humation/core@^1.0.1` + `@humation/assets-humation-1@^1.0.1` 追加。

スコープ外は不変: `trip-card.tsx`（余力枠・未着手）、`color-chip.tsx`、`AssignedColor`/`contrastTextColor`、DB スキーマ、写真アップロード経路。

---

## 2. アダプタの焼き込み方式（`src/domain/avatar.ts`）

- `createAvatar(humation1, { seed: userId, background: colorHex ?? '#E9E8E6' }).toString()` で生成。
  - **背景（メンバー配布色）**は `createAvatar({ background })` 経由で `<rect fill="#HEX">` の実 hex 直書きとして出力される（調査 §0 補正どおり、R1 非該当）。未配布は無彩デフォルト `#E9E8E6`。
- 出力 SVG に残る造形色 `var(--hm-KEY, #fallback)` を **`bakeColorVars` の正規表現 `/var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g → $1`** で fallback hex に潰す。**最終 SVG に `var(` を 1 つも残さない**（実テストで assert・実 SDK 出力で pass 確認済み）。
- 例外時は throw せず `null` を返す（呼び出し側がフォールバックできる形）。`@humation/core` は純 JS（runtime deps 0）なので domain 層 import で 4 層を維持。

## 3. `MemberAvatar`（`src/components/member-avatar.tsx`）

- props: `{ userId; color?: AssignedColor; size; photoURL?; fallbackName?; style? }`。
- 描画優先順位:
  1. `photoURL` → `expo-image` `<Image>`（clip View でラップし円形クリップ）。profile の既存写真挙動を維持（R5）。
  2. SVG 生成成功 かつ 未失敗 → `react-native-svg` の `<SvgXml xml width height onError fallback>`。`color` ありなら `contrastTextColor` 由来色のリングを付与。
  3. 生成 null / `onError` 発火 → 頭文字 + 色（配布色 hex or tint）の swatch にフォールバック。**UI は決して空にしない**。
- ロジックは全て domain に寄せ、コンポーネントは薄い try/catch（`onError`/`fallback`/`useState`）ラッパに留めた（node テスト不可な RN 層を最小化）。

---

## 4. jest 設定変更（調査 R2 + 想定外の追加対応）

調査 R2 のとおり `transformIgnorePatterns: ['node_modules/(?!(?:@humation)/)']` を追加。
**ただし、これだけでは `Cannot find module '@humation/core'` で落ちた**（申し送り A 参照）。`@humation/*` の `package.json#exports` が `import` 条件しか持たず jest 既定の CJS 条件で解決できないため、**`moduleNameMapper` で `@humation/core` / `@humation/assets-humation-1` を dist エントリ（`./dist/index.js`）へ直接マップ**して exports 解決を回避した。内部の相対 import は babel が CJS 化するため OK。

`testEnvironmentOptions.customExportConditions: ['node','import']` も試したが、jest 内部依存（`synckit` 等）まで ESM 解決させてしまい別の SyntaxError を誘発したため**不採用**。moduleNameMapper 方式が副作用ゼロで最小。

---

## 5. Investigator リスク 3 件への対応

- **リスク#1（var() 焼き込み漏れ → 色が出ない・最重要）**: `bakeColorVars` で全 `var(--hm-*, #hex)` を fallback hex に置換。テスト `expect(svg).not.toContain('var(')` で**実 SDK 出力に対し**回帰を固定（pass 確認済み）。背景色は元から実 hex なので二重に安全。
- **リスク#2（jest ESM 解決漏れ → SyntaxError）**: `transformIgnorePatterns` whitelist + moduleNameMapper で解決。既存 79 テストは無傷、新規 9 と合わせ **88 全 pass**。
- **リスク#3（SvgXml 描画テスト手薄 / 巨大 assets / seed 偏り）**: ①ロジックを全て domain に寄せ node テスト、コンポーネントは `onError`/`fallback` で頭文字縮退（実描画は手動/Expo Go 確認に依存・自動テスト空白は設計どおり受容）。②`import { humation1 }` はモジュールトップで 1 回のみ。③seed 偏りは背景配布色で識別担保（R4 受容）。

---

## 6. 検証結果

- `npx tsc --noEmit` = **0**（エラーなし）。
- `npx jest` = **88 passed / 88（9 suites）**。内訳: 既存 79 + 新規 9（avatar.test.ts）。
- `npx expo config --json >/dev/null` = **OK**。
- **バンドル増分**: `@humation/assets-humation-1` 1.7M（実バンドル主因 `dist/embedded.js` ≈ **700KB**・SVG inline）+ `@humation/core` 116K。芋づる依存なし（`npm ls`: assets→core deduped の 2 パッケージのみ）。

---

## 7. Reviewer 申し送り

- **A（jest 設定・要確認）**: 調査 R2 の `transformIgnorePatterns` だけでは不足で、`@humation/*` の `exports` が `import` 条件のみのため `moduleNameMapper` での dist 直マップを追加した。これは設計§6「必要なら jest.config.js 調整」の範囲内の最小対応。**Metro 実機側は exports を解決できる見込み（調査 §3）だが未検証** — 実機/Expo Go で描画されない場合は `metro.config.js` に `unstable_enablePackageExports: true` を試す。
- **B（自動テスト空白）**: `member-avatar.tsx` の実描画（SvgXml の native レンダ・onError 発火）は node jest でテスト不可。ロジックは domain でカバー済みだが、**実機での「色が出るか」「失敗時に頭文字へ落ちるか」は手動確認が必要**。
- **C（profile の color 未指定）**: 設計§5 は profile 頭に「先頭の配布色?」を渡す案だったが、profile 画面に user 自身の確定配布色を引く既存経路が無いため `color` 省略（写真 or 頭文字 + tint）で最小実装。造形は seed 決定的に出る。配布色リングが欲しければ別 PR で color source を配線。
- **D（trip-card）**: 設計どおり余力枠として未着手。
- **E（未コミット）**: 本ブランチは未コミット。Integrator がコミット整形する前提。
