# 04-review.md

- Issue: #23
- Stage: 4/5 Reviewer
- 対象: Humation 配布色アバター `MemberAvatar`（実 SDK 54・机上 + node 検証）
- 基準: `01-design.md` / `02-research.md` / `03-implementation.md`

---

## 検証ログ（自分で実行）

- `npx tsc --noEmit` = **0**（エラーなし）。
- `npx jest` = **88 passed / 88（9 suites）**。既存 79 無傷 + 新規 9。
- 実 `@humation` 出力での独立検証（node・モックなし）:
  - 生成 SVG の生 `var(--hm-*)` = **27 個**（`var(--hm-bottom, #000000)` 等の実パターン）。
  - 実装と同じ正規表現適用後 **leftover `var(` = 0**。`bakeColorVars` は実出力を漏れなく潰す。
  - 背景配布色 `#E63946` が baked SVG に実 hex で存在。
  - 同 seed → 同 SVG（決定的）。
- 依存ツリー: `npm ls` で `@humation/assets-humation-1@1.0.1` + `@humation/core@1.0.1`（deduped）の **2 つのみ**。core の runtime deps = `{}`。**headroom-ai 等の不審/無関係依存は混入なし**。
- `@humation/*` の import 箇所 = `src/domain/avatar.ts` のみ（起動経路を汚していない）。
- `jest.config.js` の `testPathIgnorePatterns: ['/node_modules/', '/tests/rules/']` は**不変**（rules テスト除外維持）。

---

## 観点別判定

### 1. 依存の健全性（must級・third-party）— 確認済み: 問題なし
- `package.json` 追加は `@humation/core` + `@humation/assets-humation-1` の 2 つだけ（`git diff main -- package.json` 全行確認）。
- `package-lock.json` 追加行も同 2 パッケージの resolved（registry.npmjs.org）のみ。芋づる依存・不審 URL なし。
- import は `avatar.ts` の 2 行（`createAvatar` / `humation1`）のみ。**合格。**

### 2. 色焼き込みの正しさ（must級）— 確認済み: 問題なし
- `bakeColorVars`（avatar.ts:46-48）が実出力 27 個の `var(--hm-*, #hex)` を全置換し、最終 SVG に `var(` ゼロを実測。
- `avatar.test.ts:11-15` は実 `./avatar` を import（モックなし）し `not.toContain('var(')` を assert = 真の回帰ガード。
- 背景配布色 hex が `<rect fill>` に実 hex で焼き込み（test:29-34 + 独立実測で確認）。
- 決定性（test:17-21 + 実測）・不正入力で throw せず（test:43-45、avatar.ts は try/catch→null）。**合格。**

### 3. jest ESM 設定 — 確認済み: 問題なし
- `transformIgnorePatterns` whitelist + `moduleNameMapper` の dist 直マップで 88 pass、既存 79 無傷。
- 既存 `moduleNameMapper['^@/(.*)$']` / `testMatch` / `testPathIgnorePatterns` を破壊していない。**合格。**

### 4. MemberAvatar フォールバック — 確認済み: 問題なし
- 写真 > Humation > 頭文字 の 3 段（member-avatar.tsx:59-83）。`SvgXml` に `onError`→`setSvgFailed` + `fallback` prop 二重化。`fallback?: JSX.Element` は react-native-svg v15 型に存在（実確認）。
- props（userId/color/size/photoURL）後方互換 + `fallbackName`/`style` 追加（破壊なし）。**合格。**

### 5. 適用箇所 — 確認済み: 問題なし
- members.tsx: `styles.swatch`(View) → `<MemberAvatar size={36} color={member.color} />`、死んだ `swatch` スタイル除去。ColorChip/未配布表示維持。
- profile.tsx: photoURL/頭文字分岐 → `<MemberAvatar size={88} photoURL={user.photoURL ?? undefined} />`、orphan 化した `Image`/`Tint`/`useThemeScheme`/`avatar`/`avatarText` 除去。`photoURL?: string`（null でなく undefined）型と整合。
- `AssignedColor`/`contrastTextColor` 尊重。tsc=0 で型整合確認。**合格。**

### 6. Metro 実機リスクの扱い — should（机上で残るリスクを明記）
- 申し送り A で「`transformIgnorePatterns` だけでは jest 落ち→`moduleNameMapper` 追加・Metro 実機は `unstable_enablePackageExports` 要かも・未検証」が記録済み。
- ただし **`@humation/*` の exports が `import` 条件のみ**である事実は jest で実証されており、Metro（SDK54 既定で package exports）も**同じ exports 解決に依存**するため、実機で `Cannot find module @humation/core` / 描画されない**リスクが机上で残る**。jest は moduleNameMapper で回避できたが Metro には同マッピングが無い。**ゲートC / Expo Go 確認の必須項目として明示すべき**（下記 should-1）。

### セキュリティ — 確認済み: 該当なし
- 入力検証: `userId`/`colorHex` は SVG 文字列生成のみに使用、外部送信・eval・ファイル I/O なし。
- 機密情報: ハードコード秘密なし。`var()` 置換は文字列 replace のみでインジェクション経路なし（生成元は信頼パッケージ）。
- 認可: 本変更に認可境界の変更なし。

### テスト評価
- domain ロジック（var 残留・決定性・背景焼き込み・未配布・不正入力・bakeColorVars 単体）は 9 件で十分カバー。
- 空白: `member-avatar.tsx` の実描画（SvgXml native レンダ・onError 発火・3 段縮退の実 UI）は node jest 不可で**自動テスト空白**。申し送り B で受容記録済みだが、Expo Go 手動確認が**唯一の検証手段**として残る（下記 should-1 に統合）。

---

## 指摘リスト

### must
- **なし。**（不審依存・色が出ない罠・既存テスト破壊のいずれも検出されず。実出力で baked 確認済み。）

### should
- **[should-1] Metro 実機での exports 解決が未検証（member-avatar/avatar.ts 経路全体）**
  jest は `moduleNameMapper` で `@humation/*` の `exports`(import 条件のみ) を回避したが、**Metro には同等のマッピングが無い**。実機で `@humation/core` が解決できず描画されない可能性が机上で残る。
  修正提案: ①`metro.config.js` に `config.resolver.unstable_enablePackageExports = true` を**先回りで追加**しておく（SDK54 で安全）、または ②ゲートC / Expo Go 確認手順に「members/profile でアバターが**色付きで**描画されること」「写真なしユーザーで Humation 造形が出ること」「生成失敗時に頭文字へ落ちること」を**必須チェック項目として明記**する。最低でも②は Integrator 前に文書化必須。

### nit
- **[nit-1] avatar.test.ts に「実 fallback hex に置換された造形色」のポジティブ assert が無い**
  現状は「`var(` が消える」ことのみ assert。`var(--hm-stroke, #000000)` → 黒が**残る**ことは bakeColorVars 単体テスト(test:49-52)でカバー済みだが、`buildMemberAvatarSvg` 経由でも 1 件「baked 後に既知の造形色 hex（例 `#FFFFFF` skin）が `fill="#..."` 形で存在」を足すと回帰が一段堅くなる。任意。
- **[nit-2] member-avatar.tsx:55 リング色が `contrastTextColor(color.hex)`**
  アバター背景=配布色に対する contrast 色をリングに使う設計どおり（design §4）。配布色が中間輝度（luminance≒150 近傍）だとリングが背景に近づき視認性が落ちる端ケースはあるが、設計準拠の受容範囲。気になれば別 PR で固定縁取り色を検討。任意。

---

## 設計準拠の判定

- **スコープ逸脱: なし。** 2 層構成（domain アダプタ + RN コンポーネント）、二段焼き込み（background オプション + 正規表現）、3 段フォールバック、members/profile 置換、`trip-card.tsx`/`color-chip.tsx`/`AssignedColor`/DB 不変 — すべて design §2〜§7 と一致。
- **設計との差分（妥当・記録済み）:**
  - jest `moduleNameMapper` 追加（design §6「必要なら jest.config.js 調整」の範囲内）。
  - profile に配布色 `color` を渡さず省略（申し送り C: profile に user 確定配布色を引く既存経路が無い。設計 §5 の「先頭の配布色?」は `?` 付き任意だったため逸脱ではない）。
  - `trip-card.tsx` 未着手（design §5「余力枠・別対応可」どおり）。

---

## 総評

**approve（must 0 件）。**

- 最重要リスク（不審依存混入・color が出ない var() 残留・既存 79 テスト破壊）はいずれも実出力 + 実行で否定。tsc=0 / jest 88pass を自分で再現。
- 依存は `@humation/*` 2 つのみ・runtime deps ゼロ・起動経路非汚染。
- 残るのは **Metro 実機での exports 解決と実描画が机上未検証**（should-1）という、本パイプラインの制約（実機描画不可）由来の既知空白のみ。これは**マージブロッカーではない**が、**Integrator/ゲートC で実機確認項目を文書化する条件付き approve** とする。should-1 ②（確認項目明記）は Integrator 段階で必ず反映すること。
