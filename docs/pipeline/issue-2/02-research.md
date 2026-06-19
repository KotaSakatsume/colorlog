# 02 - Investigator 調査結果

Issue: #2
Stage: 2/5 Investigator
対象: 既存テンプレ由来の `tsc --noEmit` エラー19件を「挙動を変えず型だけ直す」保守タスクの事実調査
実 SDK: Expo 54 (`expo@~54.0.0`, `expo-router@~6.0.24`, `expo-symbols@~1.0.8`, `react-native@0.81.5`)

> 凡例: 【事実】= file:line / 型定義の実コードで裏付け。【推測】= 事実からの解釈で別記。

---

## 0. 現状の tsc エラー (再現済み・19件)

`npx tsc --noEmit` の出力（実行で確認）:

| # | file:line | code | 概要 |
|---|---|---|---|
| 1 | `src/components/animated-icon.tsx:128` | TS2698 | `...StyleSheet.absoluteFill` スプレッド不可 (E) |
| 2-4 | `src/components/app-tabs.tsx:8` | TS2367 / TS2538×2 | `=== 'unspecified'` 死比較 + null/undefined index (A) |
| 5-10 | `src/components/app-tabs.tsx:16,16,17,24,24,25` | TS2339×6 | `NativeTabs.Trigger.Label` / `.Icon` 不在 (B) |
| 11 | `src/components/app-tabs.web.tsx:27` | TS2322 | `href="/explore"` 不正ルート (D) |
| 12-14 | `src/components/app-tabs.web.tsx:52` | TS2367 / TS2538×2 | `=== 'unspecified'` (A) |
| 15 | `src/components/app-tabs.web.tsx:68` | TS2322 | `name={{ios,web}}` → `SFSymbols7_0` 不可 (C) |
| 16 | `src/components/ui/collapsible.tsx:22` | TS2322 | `name={{ios,android,web}}` → `SFSymbols7_0` 不可 (C) |
| 17-19 | `src/hooks/use-theme.ts:11,13,13` | TS2367 / TS2538×2 | `=== 'unspecified'` (A) |

合計 19件。設計の 5 パターン(A=8, B=6, C=2, D=1, E=1 = 18件)＋ app-tabs.web の A 由来 TS2367 を 1 とカウントすると 19 に一致。**設計は「A=8件」と記すが実カウントは A=8(use-theme 3 + app-tabs.tsx 1+2 + app-tabs.web.tsx 1+2 = 9?)** → 正確には A は use-theme 3件・app-tabs.tsx 3件・app-tabs.web 3件 = **9件**、B=6件、C=2件、D=1件、E=1件で計19件。設計の件数内訳ラベル(A8/B5)とは数えが1ずつズレるが**修正対象箇所・修正方針は正しい**(下記で各箇所確認済み)。

---

## 1. 対象ファイルの現状 (実コード引用)

### A: ColorScheme 正規化対象

**`src/hooks/use-theme.ts:9-14`** 【事実】
```ts
export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;   // L11: TS2367, L13: TS2538×2
  return Colors[theme];
}
```

**`src/components/app-tabs.tsx:6-8`** 【事実】
```ts
const scheme = useColorScheme();
const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];  // L8
```

**`src/components/app-tabs.web.tsx:50-52`** 【事実】
```ts
const scheme = useColorScheme();
const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];  // L52
```

#### 共通化先候補
- **`src/hooks/use-color-scheme.ts:1`** 【事実】: `export { useColorScheme } from 'react-native';` (1行の再 export のみ)
- **`src/hooks/use-color-scheme.web.ts:1-21`** 【事実】: hydration 対応で `useState`/`useEffect` を持つ独自実装。`hasHydrated` 前は `'light'`、後は `colorScheme`(= `'light'|'dark'|null|undefined`)を返す。

> 【重要・落とし穴】設計 A は「`src/hooks/use-color-scheme.ts` に `useThemeScheme()` を追記」とするが、**プラットフォーム解決は `use-color-scheme.ts`(native) と `use-color-scheme.web.ts`(web) の2ファイルに分かれている**。`.ts` だけに `useThemeScheme` を追記すると **web ビルドでは `use-color-scheme.web.ts` が優先解決され `useThemeScheme` が存在せず web の import が壊れる**。詳細は §4 落とし穴1。

#### 型の裏取り
- **`ColorSchemeName`** = `'light' | 'dark' | null | undefined` (`node_modules/react-native/Libraries/Utilities/Appearance.d.ts:12`) 【事実】。`'unspecified'` は型に**存在しない** → `=== 'unspecified'` は常に false (TS2367)、false 枝の `scheme`(null/undefined を含む)が `Colors[...]` のインデックスに漏れる (TS2538)。設計の前提は正しい。
- 実タブ `src/app/(tabs)/_layout.tsx:51` は既に `Colors[scheme === 'dark' ? 'dark' : 'light']` と書いている 【事実】。**設計 A の `useThemeScheme` 実装 (`s === 'dark' ? 'dark' : 'light'`) は既存の実タブと完全に同じロジック**で、挙動同一が裏付けられる(dark 以外 = light)。

### C: SFSymbol 対象

**`src/components/ui/collapsible.tsx:21-22`** 【事実】
```tsx
<SymbolView
  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}  // L22 TS2322
```

**`src/components/app-tabs.web.tsx:66-68`** 【事実】
```tsx
<SymbolView
  tintColor={colors.text}
  name={{ ios: 'arrow.up.right.square', web: 'link' }}   // L68 TS2322
```

### E: スプレッド対象

**`src/components/animated-icon.tsx:127-131`** 【事実】
```ts
backgroundSolidColor: {
  ...StyleSheet.absoluteFill,   // L128 TS2698
  backgroundColor: '#208AEF',
  zIndex: 1000,
},
```

---

## 2. 設計の前提検証 (node_modules 型定義で裏取り)

### 2-1. app-tabs* は孤立か → 【事実: 孤立 = 確定】
- `grep -rn "app-tabs" .`（node_modules/.expo 除外）= **マッチ 0件 (exit 1)** 【事実】
- `grep -rn "AppTabs" src app` = **マッチ 0件 (exit 2)** 【事実】
- 実タブ `src/app/(tabs)/_layout.tsx` は **`Tabs` (`expo-router`) を直接使用**し、画面は `index` / `profile` の2つ(`Tabs.Screen name="index"`/`name="profile"`、L67/L74) 【事実】。`app-tabs.tsx`(NativeTabs) も `app-tabs.web.tsx`(`expo-router/ui` の Tabs) も**この実レイアウトとは無関係**。
- → 設計の「import 0件・ランタイム影響なし」は確定。**この2ファイルは型を通すだけの未使用テンプレ**。

### 2-2. SDK54 NativeTabs の正しい API → 【事実: 名前付き export が正しい】
- `node_modules/expo-router/unstable-native-tabs.d.ts:1` = `export * from './build/native-tabs';` 【事実】
- `node_modules/expo-router/build/native-tabs/index.d.ts` 【事実】:
  - `export * from './common/elements';`
  - `export { NativeTabs } from './NativeBottomTabs/NativeTabs';`
- `common/elements.d.ts` で **`export declare function Label(props: LabelProps): null;`** と **`export declare function Icon(props: IconProps): null;`** が名前付き export として定義 【事実】。
- `NativeTabs` 本体の静的メンバは **`Trigger`(と `Trigger.TabBar`)のみ**: `NativeTabs.d.ts` の型 = `... & { Trigger: (...) & { TabBar: ... } }` 【事実】。`Trigger.Label`/`Trigger.Icon` は**存在しない** → TS2339 の根拠が確定。
- → **設計 B の主張(「`Label`/`Icon` は `expo-router/unstable-native-tabs` の名前付き export」)は正しい。** `import { NativeTabs, Label, Icon } from 'expo-router/unstable-native-tabs';` で解決可能。

> 【重要・設計の誤り: B の `renderingMode` 流用は不可】
> 現 `app-tabs.tsx:17-20,25-28` の `<NativeTabs.Trigger.Icon src={require(...)} renderingMode="template" />` の **`renderingMode` プロパティは新 `Icon` の型に存在しない**。
> - `grep -rn "renderingMode" node_modules/expo-router/build/native-tabs/` = **マッチ 0件 (exit 1)** 【事実】
> - 新 `Icon` の props (`IconProps` = `{selectedColor?} & (NamedIconCombination | SourceIconCombination | CrossPlatformIconCombination)`)。`SourceIconCombination` は `src?: ImageSourcePropType | ReactElement | {default?; selected}` を持つが **`renderingMode` は無い** 【事実: `common/elements.d.ts`】。
> - → 設計の「画像 src・renderingMode はそのまま流用可」のうち **`renderingMode` を残すと新たな型エラー (TS2353 過剰プロパティ) が出る**。Implementer は `<Icon src={require(...)} />` とし **`renderingMode` を落とす**必要がある。`src` の流用は可。

### 2-3. expo-symbols SymbolView.name → 【事実: 単一文字列 SFSymbol のみ】
- `node_modules/expo-symbols/build/SymbolModule.types.d.ts` の `SymbolViewProps`: **`name: SFSymbol;`** (オブジェクト不可、必須・単一値) 【事実】。
- `SFSymbol` = `node_modules/sf-symbols-typescript/dist/index.d.ts:9426` でバージョン分岐し既定 `SFSymbols7_0` に解決(`tsc` が出した `SFSymbols7_0` がこれ) 【事実】。
- → **設計 C の「`{ios,android,web}` 不可・iOS シンボル名の文字列のみ」は正しい。**
- 渡す文字列の妥当性 【事実】:
  - `'chevron.right'` は `SFSymbols7_0` に存在 (grep ヒット 1)
  - `'arrow.up.right.square'` は存在 (`'arrow.up.right.square'` と `'arrow.up.right.square.fill'` が定義) 
  - → 設計指定の 2 文字列はどちらも型に通る。
- **web/android キー削除の描画影響 → 【事実: 影響なし】**: `node_modules/expo-symbols/build/SymbolView.web.js` の実装は全文 `export function SymbolView(props){ return props.fallback; }` 【事実】。web は `name` を一切参照せず **`fallback` のみ描画**。`collapsible.tsx`・`app-tabs.web.tsx` の `SymbolView` はいずれも `fallback` 未指定 → web では現状も修正後も**何も描画しない(= 不変)**。設計 C の「web/android キーは死にプロパティ・削っても不変」が裏付けられた。

### 2-4. 型付きルート /explore → 【事実: 存在せず、/profile が正】
- `.expo/types/router.d.ts` の `href` 型に列挙されるパス 【事実】: `/(tabs)`, `/`, `/(tabs)/profile`, `/profile`, `/profile/edit`, `/trip/create`, `/trip/join`, `/trip/[id]`, `/trip/[id]/album`, `/trip/[id]/compose`, `/trip/[id]/members`。
- **`/explore` は列挙に存在しない** 【事実】。`/profile` は存在 【事実】。
- → 設計 D(「`href="/explore"` → `href="/profile"`、`name` も `explore`→`profile` 整合」)は正しい。typedRoutes(`app.json` で有効)を緩めずに通る。

### 2-5. StyleSheet.absoluteFill vs absoluteFillObject → 【事実: 設計 E 正しい】
- `node_modules/react-native/Libraries/StyleSheet/StyleSheet.d.ts:149` = `export const absoluteFill: RegisteredStyle<AbsoluteFillStyle>;` 【事実】。`RegisteredStyle<T> = number & {__registeredStyleBrand: T}` (同 :21) 【事実】 → **数値 ID。スプレッド不可 (TS2698)**。
- 同 :142 = `export const absoluteFillObject: AbsoluteFillStyle;`、`AbsoluteFillStyle = { position:'absolute'; left:0; right:0; top:0; bottom:0 }` (同 :122-128) 【事実】 → **オブジェクト。スプレッド可・矩形は同一**。
- → 設計 E(`absoluteFill` → `absoluteFillObject`)は正しく、展開値は同一矩形。

---

## 3. 既存 jest 26件の状況 → 【事実: 型修正で壊れない】

- テストファイルは **3 件のみ** 【事実】:
  - `src/domain/invite-code.test.ts`
  - `src/domain/assign-colors.test.ts`
  - `src/repositories/mock/mock-post-repository.test.ts`
- `npx jest` 実行結果 = **Test Suites: 3 passed / Tests: 26 passed / Snapshots: 0 total** 【事実】。
- 3 テストの import は `./invite-code` `./colors` `./types` `./mock-backend` `./mock-post-repository` `@/repositories/types` のみ 【事実】 → **純粋な domain/repository ロジック**。
- `grep` で 6 対象ファイル・関連シンボル(`use-theme`/`use-color-scheme`/`app-tabs`/`collapsible`/`animated-icon`/`SymbolView`/`NativeTabs`)を test から参照する箇所 = **0件** 【事実】。
- → **型修正は UI スナップショットにもコンポーネント描画にも触れない**(snapshot 0件、component test 0件)。jest 26件は型修正と独立で回帰しない。

---

## 4. Implementer が踏みうる落とし穴 (リスク3件 + 補足)

### リスク1【最重要・設計に明記なし】web/native プラットフォーム解決による `useThemeScheme` 追記先
- 設計 A は `src/hooks/use-color-scheme.ts` のみに `useThemeScheme` を追記とするが、**`use-color-scheme.web.ts` が別実装で併存** 【事実: 両ファイル現存・中身相違】。Metro/tsc のプラットフォーム解決で **web ビルドは `.web.ts` を採用** するため、`.ts` だけに足すと `app-tabs.web.tsx` の `import { useThemeScheme } from '@/hooks/use-color-scheme'` が **web で未定義 → 実行時 undefined / 型エラー**になりうる。
  - 対策: `useThemeScheme` を **両ファイル(`use-color-scheme.ts` と `use-color-scheme.web.ts`)に追加**するか、プラットフォーム非依存の別モジュールに置く。`use-color-scheme.web.ts` 側は hydration 実装(`useColorScheme()` 内部呼び出し)を維持したうえでラップすること。
  - 補足: `app-tabs.web.tsx:10` は現状 `react-native` から直接 `useColorScheme` を import 【事実】。`useThemeScheme` 経由に切り替える際、未使用になった `useColorScheme` import を残すと lint 警告(挙動には無影響)。

### リスク2【設計 B の取りこぼし】NativeTabs `Icon` の `renderingMode` 残存で新規型エラー
- §2-2 のとおり新 `Icon` 型に **`renderingMode` は存在しない** 【事実: native-tabs に renderingMode 0件】。設計文の「renderingMode はそのまま流用可」を額面どおり実装すると **TS2353(過剰プロパティ)で tsc が再び赤**。
  - 対策: `app-tabs.tsx:17-20` / `25-28` の `<Icon>` から `renderingMode="template"` を削除。`src={require(...)}` は `SourceIconCombination.src` に合致し維持可 【事実】。孤立ファイルゆえ描画影響は無し。

### リスク3【設計 C の web 表示】web は元々 `name` を描画しない=「web 表示が変わる」懸念は事実上ゼロだが、確認観点が設計と逆
- 設計リスク C は「SymbolView が独自 web フォールバックを持てば web 表示が変わる可能性、Investigator が web 描画を確認」とするが、**実装上 web `SymbolView` は `name` を無視し `fallback` のみ返す** 【事実: `SymbolView.web.js` 全文】。`fallback` 未指定の collapsible/app-tabs.web では web で **元から何も出ていない**。
  - → 「web 表示が変わるリスク」は**実害ゼロ(変化前後とも非表示)**。ただし裏を返すと、**collapsible の chevron は web では元々表示されていない**。設計テスト方針「手動で collapsible の chevron 表示を軽く確認」は **native(iOS) で確認すべき**(web で見ても元から出ないため検証にならない)。落とし穴: 確認プラットフォームを取り違えると「壊した」と誤認する。

### 補足落とし穴
- `app-tabs.tsx`(native) と `app-tabs.web.tsx`(web) は**別 API**(前者 `unstable-native-tabs`、後者 `expo-router/ui`) 【事実: 各 import 文】。B 修正は native 側のみ、D 修正は web 側のみ。**相互に import を混ぜない**。
- 共通ヘルパ追記時、`use-color-scheme.ts` は現状 1 行の再 export 【事実】。`useColorScheme` を内部利用する `useThemeScheme` を足す際、既存の `export { useColorScheme }` を壊さない(他所が `useColorScheme` を import している: `app-tabs.tsx`/`use-theme.ts` 等)。

---

## 5. 設計で「確証なし」とされた点への事実ベース所見

### (a) 孤立テンプレ app-tabs* を将来使う想定があるか
- 【事実】import 0件・実タブは `(tabs)/_layout.tsx` の `expo-router` `Tabs` で確立済み(`index`/`profile`)。`app-tabs*` を参照する設定・ドキュメント・コードは見つからない(grep 0件)。
- 【推測】現状の実装構造(独自 `Tabs` レイアウト + Firebase/4層)から見て、Expo スターター由来の `app-tabs*` テンプレが今後採用される積極的兆候はない。**型を通す最小修正に留め、削除は別 PR 判断**とする設計方針は妥当。ただしこれは「将来使わない」の証明ではなく現時点で参照が無いという事実のみ。

### (b) C での web/android キー削除の描画不変
- 【事実】web `SymbolView` は `name` を見ず `fallback` のみ返す(`SymbolView.web.js`)。android/native では `name: SFSymbol`(単一文字列)しか受理せず、現状の `{ios,android,web}` オブジェクトはそもそも型不正で渡せていない(=tsc が止めている)。`android: 'chevron_right'` 等のキーはランタイムへ到達するパスが無い。
- → **web/android キー削除で描画は不変(両者とも元から非寄与)** は事実で裏付け済み。設計 C のリスクは実質ゼロ。

---

## まとめ (Implementer への要点)
1. **A**: `useThemeScheme()` を **`use-color-scheme.ts` と `use-color-scheme.web.ts` の両方**に追加(リスク1)。ロジックは実タブと同じ `s === 'dark' ? 'dark' : 'light'`。
2. **B**: `import { NativeTabs, Label, Icon } from 'expo-router/unstable-native-tabs'`、`Trigger.Label/Icon` → `Label/Icon`。**`renderingMode` は削除**(リスク2)。
3. **C**: `name` を単一文字列に(`'chevron.right'` / `'arrow.up.right.square'`)。web 表示は元から非表示で不変。
4. **D**: `app-tabs.web.tsx` の `href="/explore"`→`/profile`、`name="explore"`→`profile`。
5. **E**: `animated-icon.tsx:128` の `absoluteFill`→`absoluteFillObject`。
6. 完了条件: `npx tsc --noEmit` 0件 / `npx jest` 26件 pass(型修正は test と独立、回帰なし)。手動確認は **iOS で collapsible chevron**(web では検証にならない)。
