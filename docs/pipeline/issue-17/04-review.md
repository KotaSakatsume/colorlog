# Issue: #17 / Stage 4/5 Reviewer — UI/UX 刷新

実 SDK 54。基準: `01-design.md` / `02-research.md`。差分: `git diff main` + 新規 `src/components/glass-surface.tsx` 直読み。
検証は本レビュー内で自走実行: **`npx tsc --noEmit` = 0 errors** / **`npx jest` = 8 suites, 79 tests passed**。

## 総評: **approve（must なし）**

設計準拠・API 据え置き・Expo Go 安全性・型安全・hex 集約・ロジック不変、すべて設計どおり。検証ゲート（tsc 0 / jest 79）も再現確認済み。must 0 件。should 1 / nit 3 はいずれも任意改善で、マージをブロックしない。

---

## 観点別判定

### 1. API 据え置き（最重要）→ 確認済み: 問題なし
全共有コンポーネントの `Props`/エクスポート型に破壊なし。`git diff` で各 `Props` 型定義行に変更なしを確認、screens 側呼び出し（`UIButton`/`ColorChip`/`TripCard` 等）も無改修で `tsc` 0。
- `themed-text.tsx:7-18` の `type` union は `display`/`hero` の**追加のみ**（既存 7 リテラルのリネーム/削除なし）→ 後方互換。OK。
- `ui-button.tsx:30` の `color` prop 優先維持: `bg = isPrimary ? (color ?? Tint[scheme].tint)`、`pressedBg = isPrimary && !color ? tintPressed : bg`。color 指定時は押下色も尊重。設計どおり。
- 内部の振る舞い差分は `ui-button` の押下フィードバックが `opacity:0.85` → `transform scale 0.97`（設計指示どおりの意図的変更）。API 不変。

### 2. Expo Go 安全性（最重要）→ 確認済み: 問題なし
`glass-surface.tsx` は調査 §9-2/リスク① の安全形を正確に実装。
- `expo-glass-effect` の **static import なし**（2 行目は react-native のみ）。
- `Platform.OS==='ios'` ガード内で**動的 `require`**（33 行目）+ try（31-41）。モジュール評価時 throw を握る。
- availability は `isGlassEffectAPIAvailable?.() && isLiquidGlassAvailable?.()`（36 行目、より厳密な方を先・AND・optional chain）。呼び出し throw も try 内。
- Android/Web は分岐に入らず常にフォールバック View。失敗時 `glassUsable=false` で即フォールバック描画（64-79）。フォールバックは `Glass[scheme].fill` + hairline border + Radius + `shadow(2)` で設計 §4 一致。
- GlassSurface は**現状どの画面からも参照されていない**（grep 0 件）。継ぎ目のみ新設で、起動経路に未投入＝Expo Go クラッシュ面はゼロ。安全。

### 3. トークンの型安全 → 確認済み: 問題なし
`Tint`/`Radius`/`Glass`/`shadow()` は `theme.ts` で `Colors` と**独立 export**。`ThemeColor = keyof Colors`（5 キー）は不変、`themed-view`/`themed-text` の `themeColor` 許容キーも 5 のまま（tsc 0 が裏付け）。
- `shadow()` の dark 分岐: `mult = scheme==='dark' ? 1.5 : 1` を iOS の `shadowOpacity` のみ乗算（`theme.ts` shadow ヘルパ）。level 1/2/3 の radius/offset/elevation 値は設計 §2 と完全一致。level 0 → `{}`。OK。
- `useThemeScheme()` の戻り型 `'light'|'dark'` が `Tint`/`Glass`/`shadow`/GlassView `colorScheme`（`'auto'|'light'|'dark'`）すべてに型整合。

### 4. ハードコード hex 置換 → 確認済み: 問題なし
`#208AEF` は `Tint.light.tint` へ集約。残存 `#208AEF`/`#3c87f7` を grep 確定:
- `theme.ts:80` Tint 定義（意図）/ `:75` コメント。
- **`animated-icon.tsx:129` は diff に出ず据え置き** / **`app.json:34` splash も diff なし据え置き** → 二重管理回避（リスク② 対応）OK。
- `profile.tsx:106`・`profile/edit.tsx:107,112`・`ui-button.tsx:29`・`themed-text.tsx:66` の hex はすべて Tint 参照へ置換済み。`.web` 派生に当該 hex なし（既存どおり）。

### 5. 色覚多様性・ロジック不変 → 確認済み: 問題なし
`src/domain`・`src/repositories`・`*.test.ts` の diff 0（`contrastTextColor`/`COLOR_POOL` 不変）。`color-chip.tsx` は名前ラベル維持・`contrastTextColor` 不変・Pressable 化していない（View のまま `shadow(1)` 追加のみ）。best-nine の埋まりセル色フレームは `color.hex` 由来でドメイン値不変。

### 6. マイクロインタラクション → 確認済み: 問題なし
全押下フィードバックが Pressable の `transform:[{scale}]`（ui-button 0.97 / trip-card 0.98 / reaction-bar 0.94）。reanimated を新規必須経路にしていない（import なし）。Expo Go 安全。

---

## 指摘リスト

### [should] reaction-bar.tsx:42-47 — selected 解除時に押下の透明感が消え、トグル感が弱まる
旧実装は `opacity: pressed ? 0.6 : 1` で全 chip に押下フィードバックがあった。新実装は `transform scale 0.94` に置換したが、**非 selected chip の押下時に opacity 変化がなくなった**。scale 0.94 のみだと「押した感」は出るが、selected/非 selected いずれも色変化が伴わない瞬間がある（設計 §5 は「押下 scale0.94」を指示しており scale 自体は正。これは欠陥ではなく体感の指摘）。
修正提案（任意）: 体感を補うなら押下時に軽い opacity を併用。
```tsx
{ backgroundColor: selected ? Tint[scheme].tintSubtle : theme.backgroundElement,
  opacity: pressed ? 0.85 : 1,
  transform: [{ scale: pressed ? 0.94 : 1 }] }
```
※設計の scale 指定は満たしているため must ではない。視覚は人間が Expo Go で最終判断。

### [nit] glass-surface.tsx:55 — `glassEffectStyle={intensity}` の型は実 API と整合だが将来の `'none'` 非対応を明示しておくとよい
`intensity: 'regular'|'clear'` は調査 §9-2 の `GlassStyle='clear'|'regular'|'none'` の部分集合で安全。問題なし。`'none'` を意図的に絞った旨のコメントを Props 付近に 1 行残すと将来の拡張誤解を防げる。

### [nit] trip-card.tsx:28 / styles.card:69 — `shadow(2)` × `overflow:'hidden'` で iOS 影クリップ（申し送りの妥当性確認）
申し送りどおり、iOS では `overflow:'hidden'` のある同一 View に `shadowRadius` を当てると角丸外の影がクリップされ柔影が出にくい。**実害は「影がやや弱く見える」程度で機能・API・安全性に影響なし**、設計 §5 も trip-card に `Radius.lg + shadow(2) + overflow:hidden`（色バー/画像のはみ出し防止に hidden 必須）を明示。スコープ内で許容。
将来改善（別 Issue 候補）: 影用の外側ラッパ View（hidden なし）+ 内側 hidden View の二層化。今 PR では**対応不要**。

### [nit] best-nine-grid.tsx:51-57 — `filled && color` の三項に `: null` を明示しており可読性 OK、ただし `Radius.md`(14) とフレーム 1.5px の内側角丸ズレ
`overflow:'hidden'` 下で `borderWidth:1.5` を内側に描くため、外角 14px に対し画像角がわずかに食い込む見え方になりうる。視覚のみの問題で機能影響なし。人間の Expo Go 確認に委ねる。

---

## テスト評価 → 確認済み: 追加必須なし
- 既存テストはドメイン/リポジトリのロジックのみ（`testEnvironment:'node'`、コンポーネントレンダリングテスト 0）。今 PR は **style/StyleSheet 値変更が中心でロジック不変**のため、79 テストは無改修で全 pass（再現確認済み）。
- リスク箇所（GlassSurface の throw 経路）は jest（node 環境）でカバー不能だが、**コードレビューで static import 不在 + 動的 require + try + availability AND を確認済み**。現状テスト基盤にコンポーネントテストがなく、1 コンポーネントのために jsdom/RTL を導入するのはスコープ過大 → 追加見送りが妥当。
- カバー漏れリスク（残）: GlassSurface を将来画面に投入する際は、実機 Expo Go での「未対応端末フォールバック」目視確認を投入 PR の受け入れ条件にすること（申し送り推奨）。

## セキュリティ → 確認済み: 該当なし
入力検証・認可・機密情報・インジェクション・依存いずれも本 PR のスコープ外（純粋に表示トークン/スタイル + ネイティブ機能の安全フォールバック）。新規依存の追加なし（`expo-glass-effect` は既存 dependency、動的 require のみ）。

## 設計準拠 / スコープ
- スコープ逸脱なし。`.gitignore` への Firebase emulator ログ追記は設計 §6 に明記なしだが、生成物の追跡除外で**実害ゼロ・無関係ファイルの誤コミット防止**。許容（nit 未満）。
- screens は tint/部品適用のみ改修（profile/edit のアバター下地・リンク色）。情報設計/フロー改造なし。設計 §6/§7 と整合。

## マージ可否: **approve**
must 0。should 1・nit 3 はいずれも視覚体感/将来改善で、Expo Go での人間目視に委ねる範囲。Integrator へ進めてよい。
