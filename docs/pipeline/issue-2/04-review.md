# コードレビュー — Issue #2（既存テンプレ tsc エラー19件の解消）

Stage: 4/5 Reviewer / 基準: `01-design.md` / 差分: `git diff main`（branch `pipeline/issue-2`）

## 総評: approve（must 0件）

`npx tsc --noEmit` = **0件**（19→0）、`npx jest` = **26件 全pass** を実機確認。設計準拠・挙動非変更（孤立テンプレゆえランタイム影響ゼロ）ともに成立。`expo-router@6.0.24`（SDK54同梱）で `Label`/`Icon` が `unstable-native-tabs` の名前付き export であることを型定義で確認。

## 指摘

### should-1: `renderingMode` 削除は「型だけ・挙動不変」の建前から外れる差分 → 記録すべき
`src/components/app-tabs.tsx`。設計Bの「renderingMode はそのまま流用可」は SDK54 の `IconProps` に `renderingMode` が無く**誤り**。実装は正しく削除して吸収。孤立ファイルゆえ実害ゼロだが、PR説明と `01-design.md` に「SDK54 の Icon API に無いため削除・孤立につき挙動影響なし」と注記を残す。

### should-2: `app-tabs.web.tsx` の "Explore" ラベル残り（設計D未完遂） → **Integrator 前に修正済み**
trigger を `profile`/`href=/profile` にした一方 `<TabButton>Explore</TabButton>` が残存していた。**`Profile` に修正済み**（このレビュー後に1語修正で取り込み）。

### nit-1: `use-color-scheme.ts` の `export { useColorScheme }` が実利用ゼロ（死にエクスポート）
後方互換目的で残すなら現状維持で可。

### nit-2: `useThemeScheme` のユニットテスト未追加
唯一のロジック追加（`dark→'dark'` / `null|undefined|'light'→'light'`）。設計は必須としないが、3箇所の唯一の正規化ソースになるため任意で1テスト推奨。

## 設計準拠
- A ✅（`'unspecified'` 死んだ比較を撤去し `=== 'dark' ? 'dark' : 'light'` へ。旧式の `Colors[null]` 潜在バグも解消＝旧より安全）
- B ✅（名前付き export 追従、型確認済み。renderingMode 削除は should-1 で記録）
- C ✅（`SymbolView.name` を文字列化、型 `SFSymbol` と整合）
- D ✅（href/name 修正 + ラベル "Explore"→"Profile" を修正済み）
- E ✅（`absoluteFillObject`、矩形値同一）
- `use-color-scheme.web.ts` 追加は web ビルドが別実装を解決するための必然（設計A成立に必要）＝逸脱ではない。

## セキュリティ
該当なし。型整合のみ・新規依存なし・入力検証/認可/機密に非接触。

## 結論
must 0件で **approve**。should-2 は修正済み、should-1 は記録対応、nit は任意。Integrator 段階へ進行可。
