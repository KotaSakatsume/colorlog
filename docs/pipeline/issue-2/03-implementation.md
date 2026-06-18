# 実装サマリー — 既存テンプレ tsc エラー19件の解消

Issue: #2 / Stage: 3/5 Implementer
作業ブランチ: `pipeline/issue-2`（コミットは Integrator 段階）。
※ Implementer サブエージェントが要約返却前に API 切断で終了したため、本サマリーはパイプライン側が作業ツリーの diff と検証結果から作成。

## 変更ファイル（7件・±約40行、挙動保存）
- `src/hooks/use-color-scheme.ts` / `src/hooks/use-color-scheme.web.ts` — 共通ヘルパ `useThemeScheme(): 'light' | 'dark'` を**両方に**追加（調査リスク1）。`scheme === 'dark' ? 'dark' : 'light'` で null/undefined を light に正規化。
- `src/hooks/use-theme.ts` — `useColorScheme` + 死んだ `'unspecified'` 比較を `useThemeScheme()` に置換。
- `src/components/app-tabs.tsx`（孤立テンプレ）— A: `useThemeScheme()` 化。B: `Label`/`Icon` を `expo-router/unstable-native-tabs` の名前付き export に変更し、`Icon` に存在しない `renderingMode` を削除（調査リスク2）。
- `src/components/app-tabs.web.tsx`（孤立テンプレ）— A: `useThemeScheme()` 化。C: `SymbolView.name` を文字列 `"arrow.up.right.square"` に。D: `/explore`→実在する `/profile`（trigger name も `profile`）。
- `src/components/ui/collapsible.tsx` — C: `SymbolView.name` を文字列 `"chevron.right"` に。
- `src/components/animated-icon.tsx` — E: `StyleSheet.absoluteFill`（数値ID・スプレッド不可）→ `absoluteFillObject`。

## パターン別対応
| | 内容 | 件数 |
|---|---|---|
| A | ColorSchemeName 正規化を共通ヘルパに集約、死んだ `'unspecified'` 比較除去 | 9 |
| B | SDK54 NativeTabs 正しい API（名前付き Label/Icon、renderingMode 削除） | 6 |
| C | SF Symbol `name` をプレーン文字列に | 2 |
| D | 型付きルート `/explore`→`/profile` | 1 |
| E | `absoluteFill`→`absoluteFillObject` | 1 |

## 検証結果（パイプライン側で実行・確認）
- `npx tsc --noEmit`: **エラー0**（19→0、新規エラーなし）。
- `npx jest`: **3 suites / 26 tests すべて pass**（型修正のみ、対象6ファイルは jest 参照0・snapshot 0 で独立）。

## Reviewer への申し送り
- A の正規化は旧 `scheme === 'unspecified' ? 'light' : scheme` から `scheme === 'dark' ? 'dark' : 'light'` に変更。旧式は null/undefined で `Colors[null]=undefined` になる潜在バグがあり、新式はそれを light に倒すため**挙動はむしろ改善**（ライト/ダークの確定挙動は不変）。要確認点。
- `app-tabs.web.tsx` の trigger を `profile` にしたが TabButton ラベルは "Explore" のまま（孤立テンプレ・挙動非影響）。nit として残置。
- 孤立テンプレ（app-tabs*）は設計方針どおり削除せず型だけ修正。
