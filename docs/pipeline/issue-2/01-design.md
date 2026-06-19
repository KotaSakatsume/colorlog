# 01 - Architect 設計方針

Issue: #2
Stage: 1/5 Architect
対象: 既存テンプレート由来の `tsc --noEmit` エラー19件を、見た目・挙動を変えずに型だけ緑にする

---

## 方針 (1行)
型エラーの原因5パターンを「型だけ直す最小変更」で潰す。`ColorSchemeName` 正規化は共通ヘルパに切り出し、NativeTabs は SDK54 の正しい API (`Label`/`Icon` の名前付き export) に追従、その他 (SFSymbol/ルート/スプレッド) は各箇所をピンポイント修正する。

## 前提となる重要な調査結果 (実機で確認済み)
- `useColorScheme()` の戻り値は `'light' | 'dark' | null | undefined`。**`'unspecified'` は存在しない** → `=== 'unspecified'` は常に false の死んだ比較 (TS2367)、フォールバック側で `null`/`undefined` が `Colors` のインデックスに漏れる (TS2538)。
- `src/components/app-tabs.tsx` と `app-tabs.web.tsx` は **どこからも import されていない孤立テンプレートファイル** (実タブは `src/app/(tabs)/_layout.tsx`)。よって本件の修正はランタイム挙動に一切影響しない = 「挙動を変えない」が型上だけで確実に担保できる。
- 実ルートは `index` / `profile` のみ。**`/explore` ルートは存在しない** (D の真因)。
- `app.json` で `typedRoutes: true`。
- `Colors` は `as const` のため `null`/`undefined` でインデックス不可。

## 設計方針 (5-7行)
1. **A (8件) 共通正規化**: `src/hooks/use-color-scheme.ts` に薄いラッパ `useThemeScheme(): 'light' | 'dark'` を追加 (`const s = useColorScheme(); return s === 'dark' ? 'dark' : 'light';`)。`use-theme.ts` / `app-tabs.tsx` / `app-tabs.web.tsx` の3箇所はこれを使い、`scheme === 'unspecified' ? 'light' : scheme` を撤去。挙動は従来 (dark 以外は light) と同一。
2. **B (5件) NativeTabs API 追従**: `Label`/`Icon` は SDK54 では `NativeTabs.Trigger.Label` ではなく、`expo-router/unstable-native-tabs` の**名前付き export `Label` / `Icon`**。import に `{ NativeTabs, Label, Icon }` を追加し、`<NativeTabs.Trigger.Label>X</...>` → `<Label>X</Label>`、`<NativeTabs.Trigger.Icon src=.../>` → `<Icon src=.../>` に置換 (画像 src・renderingMode はそのまま流用可)。
3. **C (2件) SFSymbol**: expo-symbols の `SymbolView.name` は**プレーン文字列 `SFSymbol`** であり `{ios,android,web}` オブジェクト不可。iOS シンボル名の文字列だけを渡す (`name="arrow.up.right.square"` / `name="chevron.right"`)。web/android のキー値は元々 SymbolView が解釈していない死にプロパティのため削っても表示は不変。
4. **D (1件) /explore ルート**: 実ルートに存在しないため、孤立ファイル `app-tabs.web.tsx` の `href="/explore"` を実在ルート `href="/profile"` に合わせる (typedRoutes を緩めない / 新ルートも作らない)。`name` も `explore`→`profile` に合わせ整合させる。**Investigator 確認事項**: このテンプレを将来使う想定が無いことの最終確認 (import 0 件は確認済み)。
5. **E (1件) スプレッド**: `StyleSheet.absoluteFill` は数値 ID。スプレッド可能な `StyleSheet.absoluteFillObject` に置換 (`animated-icon.tsx:128`)。展開される値は同一矩形 (top/left/right/bottom:0 position:absolute)。
6. **エラーハンドリング方針**: いずれも型整合のみで try/catch や実行時分岐は追加しない。
7. **DB / API 変更**: なし。

## 採用理由とトレードオフ
- **A 共通化を採用** (各ファイル個別三項演算子で潰す案を却下): 同一誤りが3ファイルに散るため、1ヘルパ集約で再発防止・差分最小。却下案は重複が残りレビューコストが上がる。
- **B 名前付き export を採用** (Trigger 子要素を全削除して `options` props に寄せる案を却下): SDK54 の正規 API は宣言的子要素 (`Label`/`Icon`) であり最小差分。props 化は書き換え範囲が広く挙動差リスク大。
- **C 文字列化を採用** (`name as any` でキャスト回避する案を却下): `any` は型を緑にするだけで誤用を温存。正しい単一文字列が SDK の契約。
- **D href を実ルートへ修正を採用** (`/explore` ルートを新設 / typedRoutes 無効化を却下): ルート新設はスコープ拡大、typedRoutes 無効化は他箇所の型安全を犠牲にする。
- **E absoluteFillObject を採用** (`as any` 却下): 公式が用意するオブジェクト形が正解。

## スコープ (影響範囲)
- 変更: `src/hooks/use-color-scheme.ts` (ヘルパ追加, +5行程度), `src/hooks/use-theme.ts`, `src/components/app-tabs.tsx`, `src/components/app-tabs.web.tsx`, `src/components/ui/collapsible.tsx`, `src/components/animated-icon.tsx`。
- 想定変更行数: 合計 +/- 30〜40行オーダー。1 PR で完結するサイズ。
- 新規ファイル: なし (ヘルパは既存 `use-color-scheme.ts` に追記)。

## やらないこと (3点)
1. 孤立テンプレ (`app-tabs*.tsx`) の削除・大規模リライト・機能追加はしない (型を通す最小修正のみ。削除は別 PR 判断)。
2. `/explore` 等の新ルート追加・typedRoutes 設定変更・ナビゲーション構成の変更はしない。
3. Issue #1 (QR招待+リアクション) 関連コード、4層アーキテクチャ、テーマ配色・スタイル値の変更はしない。

## リスク
- **B NativeTabs**: API 追従で要素が `Trigger` の子から独立 export に変わるが、孤立ファイル (import 0) のためランタイム影響なし。将来このテンプレを採用する場合のみ表示確認が必要 → Investigator/Implementer は「未使用ファイルの型修正」と認識すること。
- **C SFSymbol**: web/android キーを削るため、もし SymbolView が独自に web フォールバック実装を持っていれば web 表示が変わる可能性。ただし型定義上 `name: SFSymbol` (文字列) のみ受理で、現状でも非 iOS では SF Symbol を解決できない → 実害なし想定。Investigator が web 描画を一応確認。
- **web/native 差分**: `app-tabs.tsx` (native) と `app-tabs.web.tsx` (web) で別 API。両方を独立に修正し相互依存させない。

## テスト方針
- 型: `npx tsc --noEmit` がエラー0 (現状19→0) を完了条件とする。
- 既存テスト: `npx jest` の既存26件が全 pass を維持 (回帰がないこと)。今回ロジック追加はヘルパ1個のみで、テスト追加は任意 (`useThemeScheme` の dark/light/null 分岐の単体は付けても良いが必須としない)。
- 手動: 孤立ファイルは画面に出ないため UI 確認は collapsible (`chevron` 表示) のみ軽く確認。
