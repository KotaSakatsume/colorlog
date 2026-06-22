# Issue: #17 / Stage 2/5 Investigator — UI/UX 刷新 調査結果

入力は `docs/pipeline/issue-17/01-design.md` のみ。実 SDK 54 / `node_modules` 実物引用。
すべて事実は `file:line` または `node_modules` 実体で裏付け。推測は「推測」欄に分離。

---

## §9-1 + §9-2. expo-glass-effect ~0.1.10（SDK54）の実 API と Expo Go 挙動

### バージョン（事実）
- `node_modules/expo-glass-effect/package.json`: `"version": "0.1.10"`、`"main":"build/index.js"`、`"types":"build/index.d.ts"`。
- `package.json:20` 相当に `"expo-glass-effect": "~0.1.10"` 宣言済み（dependencies）。
- `expo-dev-client` は **未導入**（NONE）。→ 実機は Expo Go 前提で考える必要あり。

### 公開 API（事実: `node_modules/expo-glass-effect/build/index.d.ts`）
```
export { default as GlassView } from './GlassView';
export { GlassColorScheme, GlassEffectStyleConfig, GlassStyle, GlassViewProps } from './GlassView.types';
export { default as GlassContainer } from './GlassContainer';
export { GlassContainerProps } from './GlassContainer.types';
export { isLiquidGlassAvailable } from './isLiquidGlassAvailable';
export { isGlassEffectAPIAvailable } from './isGlassEffectAPIAvailable';
```
- コンポーネント名は **`GlassView`**（`GlassEffectView` ではない）。コンテナは `GlassContainer`。
- availability 関数は **2つ**: `isLiquidGlassAvailable()` と `isGlassEffectAPIAvailable()`。両方 `boolean` を返す。
  - `isGlassEffectAPIAvailable.d.ts` のコメント: 「iOS 26 beta の一部で API 不在 → クラッシュ回避のため GlassView/GlassContainer 使用前にこれをチェックせよ」。→ **より厳密なガードはこちら**。

### Props（事実: `node_modules/expo-glass-effect/build/GlassView.types.d.ts`）
```
GlassViewProps = {
  glassEffectStyle?: GlassStyle | GlassEffectStyleConfig;  // 'clear'|'regular'|'none' or {style, animate?, animationDuration?}  default 'regular'
  tintColor?: string;
  isInteractive?: boolean;                                  // default false
  colorScheme?: GlassColorScheme;                           // 'auto'|'light'|'dark'  default 'auto'
  ref?: Ref<View>;
} & ViewProps;                                              // ← ViewProps継承なので style / children をそのまま渡せる
```
- `GlassStyle = 'clear' | 'regular' | 'none'`。design §4 の `intensity?: 'regular'|'clear'` はこの `glassEffectStyle` に直結マップ可能。
- `colorScheme` で scheme override 可（アプリのダーク/ライト切替に合わせられる）。

### Expo Go で import / レンダリングして throw するか（最重要・事実ベース）
プラットフォーム分岐実装の中身を確認した:

- **非iOS（`.js` フォールバック）— 安全**:
  - `build/GlassView.js`: `export default function GlassView(props){ return <View {...props}/>; }` → ただの View。throw しない。
  - `build/isLiquidGlassAvailable.js`: `return false;`（即値）。
  - `build/isGlassEffectAPIAvailable.js`: `return false;`（即値）。

- **iOS（`.ios.js`）— ネイティブ未リンク時に throw リスクあり**:
  - `build/GlassView.ios.js`: モジュール先頭で
    `const NativeGlassView = requireNativeViewManager('ExpoGlassEffect', 'GlassView');`
    を **トップレベル実行**。→ `ExpoGlassEffect` ネイティブが入っていない Expo Go では requireNativeViewManager が解決できず、**import/モジュール評価の時点で throw する可能性が高い**。
  - `build/isLiquidGlassAvailable.ios.js`: `requireNativeModule('ExpoGlassEffect').isLiquidGlassAvailable` を **呼び出し時に lazy 実行**（`if (undefined) { ... requireNativeModule(...) }`）。→ Expo Go で **呼んだ瞬間に throw する可能性が高い**。
  - `isGlassEffectAPIAvailable.ios.js` も同様に lazy `requireNativeModule`。

事実の要点: **iOS の `GlassView` は「コンポーネントを import した時点」で `requireNativeViewManager` を走らせる**。design §4 が要求する「import 時 try で囲む」だけでは、JS バンドラの静的 import では握れない（import は巻き上げ・try 不可）。安全なのは **動的解決（`require()` を関数内 try で）か、もしくは availability を先に確認してから条件レンダリング**だが、availability 関数自体も throw しうる。

### 推測（明示）
- Expo Go(SDK54) に `ExpoGlassEffect` ネイティブが同梱されているかは未検証。同梱されていれば `isGlassEffectAPIAvailable()` が正しく false/true を返し throw しない。**同梱されていなければ `requireNativeModule` / `requireNativeViewManager` が throw する** というのが上記コードからの推測。dev-client 未導入のため、実機検証なしでは「同梱あり」と断定できない。→ **保守的に「呼ぶと throw しうる」前提で組むのが安全**。

### 安全なフォールバック分岐（実コード提案・推測込みだが最も堅い形）
top-level static import を避け、try で availability を確かめ、ダメなら即フォールバック描画にする:
```tsx
// glass-surface.tsx（提案）
import { Platform, View } from 'react-native';

let GlassView: any = null;
let glassUsable = false;
if (Platform.OS === 'ios') {
  try {
    // 動的 require: モジュール評価の throw を握る
    const mod = require('expo-glass-effect');
    // availability 関数の呼び出し自体も throw しうるので try 内で
    glassUsable = !!mod.isGlassEffectAPIAvailable?.() && !!mod.isLiquidGlassAvailable?.();
    if (glassUsable) GlassView = mod.GlassView;
  } catch {
    glassUsable = false;
    GlassView = null;
  }
}
// レンダリング: glassUsable && GlassView ? <GlassView .../> : <View fallback/>
```
- ポイント: `require('expo-glass-effect')` を **`Platform.OS==='ios'` ガード内 + try**。
- availability は `isGlassEffectAPIAvailable()` を先（より厳密）→ `isLiquidGlassAvailable()` の AND。
- Android/Web は分岐に入らず常にフォールバック View（`.js` 版は安全だが require すら呼ばない方が確実）。
- design §4 の「import 時 try」は **static import では効かない**点を Implementer に強調（落とし穴①）。

---

## §9-3. reanimated 4 の babel 設定 と Expo Go での withSpring 動作

### 事実
- `babel.config.js` は **存在しない**（リポジトリに無し）。プロジェクトルートの config は `jest.config.js` / `jest.rules.config.js` のみ。
- Expo SDK54 は babel config 不在時に **`babel-preset-expo` を既定適用**。`node_modules/babel-preset-expo` バージョン `54.0.11` インストール済み。
- `react-native-reanimated` `4.1.7`（package.json は `~4.1.1`）、`react-native-worklets` `0.5.1` インストール済み。
- **reanimated/worklets は既に本番コードで稼働中**（=babel の worklets 変換が効いている証拠）:
  - `src/components/animated-icon.tsx:4` `import Animated, { Easing, Keyframe } from 'react-native-reanimated';`
  - `src/components/animated-icon.tsx:5` `import { scheduleOnRN } from 'react-native-worklets';`
  - `src/components/animated-icon.tsx:37` インラインで `'worklet';` ディレクティブを使用（withCallback 内）。
  - `.web` 版 `animated-icon.web.tsx:3` も reanimated を使用。

### 結論
- reanimated 4 は **このアプリで動いている**（babel-preset-expo 54 が worklets plugin を内包し、別途 plugin 記述不要）。`useSharedValue`+`withSpring` も同経路で動作するはず。
- ただし design §5 自身が「**Pressable の `transform:[{scale}]` を第一推奨・reanimated は必須経路にしない**」と明記（01-design.md:60）。→ **Implementer は Pressable scale で進めて良い**。reanimated 依存を新規に増やす必要なし。リスク最小。

### 推測
- 既存稼働実績から withSpring も動くと推測するが、design 方針どおり Pressable transform で十分のため、**reanimated を新規導入しないのが安全**（検証コスト・throw リスクゼロ）。

---

## §9-4. `#208AEF` / `#3c87f7` 全参照 確定列挙（grep 確定）

`grep -rni '208AEF\|3c87f7' src app.json`（実行済み）の確定結果:

| file:line | 内容 | 置換方針 |
|---|---|---|
| `src/app/(tabs)/profile.tsx:106` | `backgroundColor: '#208AEF'` | → `Tint[scheme].tint` |
| `src/app/profile/edit.tsx:107` | `backgroundColor: '#208AEF'` | → `Tint[scheme].tint` |
| `src/app/profile/edit.tsx:112` | `changePhoto: { color: '#208AEF' }` | → `Tint[scheme].tint` |
| `src/components/animated-icon.tsx:129` | `backgroundColor: '#208AEF'`（splash 単色オーバーレイ） | splash 連動色。app.json:34 と揃える必要あり（落とし穴参照） |
| `src/components/ui-button.tsx:29` | `color ?? '#208AEF'`（primary 既定背景） | → `color ?? Tint[scheme].tint`。**`color` prop 優先は維持** |
| `app.json:34` | `"backgroundColor": "#208AEF"`（splash） | design §6: **値据え置き・注記のみ**（ネイティブ splash 設定。tint 変更とは別レイヤ） |
| `src/components/themed-text.tsx:66` | `color: '#3c87f7'`（linkPrimary） | StyleSheet から削除し、描画時に `Tint[scheme].tint` を当てる（themed-text.tsx:24 の `linkPrimary` 分岐） |

- `.web.tsx` 派生での `#208AEF`/`#3c87f7` 参照: **無し**（grep ヒットゼロ）。`animated-icon.web.tsx` は CSS module 経由で色を持つ（`animated-icon.module.css`、ハードコード hex は無し）。
- 補足（事実）: `animated-icon.tsx:122` に `experimental_backgroundImage: 'linear-gradient(180deg, #3C9FFE, #0274DF)'`、`.web` の `dark` tint は `#3C9FFE`（theme には未集約のグラデ色）。design スコープ外だが tint 近縁色として存在することを記録。

---

## §9-5. トークン追加の型安全性（ThemeColor が広がらない保証）

### 事実
- `src/constants/theme.ts:10-25` `Colors = { light:{...5keys...}, dark:{...5keys...} } as const`。キーは `text/background/backgroundElement/backgroundSelected/textSecondary` の 5 つのみ。
- `src/constants/theme.ts:27` `export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;` → **`Colors` の light∩dark キーから導出**。
- `src/hooks/use-theme.ts:9-13` `useTheme()` は `Colors[theme]` を返すだけ。戻り値型 = `Colors.light | Colors.dark`（5 キー）。
- `themed-text.tsx:8` `themeColor?: ThemeColor;` / `themed-text.tsx:17` `theme[themeColor ?? 'text']`。
- `themed-view.tsx:9` `type?: ThemeColor;` / `themed-view.tsx:15` `theme[type ?? 'background']`。

### 結論（保証）
- `Tint` を **`Colors` とは別の独立 export**（`export const Tint = {...}`）にすれば、`ThemeColor`（=`keyof Colors`）にも `useTheme()` 戻り値にも一切影響しない。`themed-view`/`themed-text` の `themeColor: ThemeColor` の許容キーは **5 のまま不変**。
- 同様に新規 `Radius` / `Shadow` ヘルパ / `Glass` も独立 export なら型・既存 import に無影響。
- **`Tint` を `Colors` に混ぜると `ThemeColor` が `tint/tintPressed/...` まで広がり、`themed-*` の prop 型が破壊される** → design の「別 export」判断は正しい。Implementer は絶対に `Colors` オブジェクトに足さないこと（落とし穴③）。

---

## 既存の実装パターン（Implementer が踏襲すべき書き方）

1. **scheme 取得**: `useTheme()`（`src/hooks/use-theme.ts:9`）→ `Colors[theme]` を返す。`Tint`/`shadow()` には **scheme 自体**が要る。scheme は `useThemeScheme()`（`src/hooks/use-color-scheme`、use-theme.ts:7 で import）から取れる。Tint/Shadow 用に scheme を別途取る or `useTheme` を拡張せず新フック追加が素直。（推測: 既存 `useTheme` は壊さず、scheme は `useThemeScheme()` 直接利用が安全。）
2. **Pressable 押下フィードバック**: `({ pressed }) => [...]` で `opacity` を切替える既存形（`ui-button.tsx:36-44`、`trip-card.tsx:23-26`、`reaction-bar.tsx:37-43`、`best-nine-grid.tsx:43-47`）。design の scale 化はこの style 関数に `transform:[{scale: pressed?0.97:1}]` を足すだけで踏襲可能。
3. **borderRadius は数値直書き**: `ui-button.tsx:60`(14)、`trip-card.tsx:62`(16)、`color-chip.tsx:42`(999)、`best-nine-grid.tsx:116`(10) / `:154`(4)、`reaction-bar.tsx:72`(14)、`hint-row.tsx:31`(`Spacing.two`)。→ `Radius` トークンに置換する対象。
4. **色の淡い下地**: `${hex}22` / `${hex}33` 透過の既存慣習（`best-nine-grid.tsx:38` `${color.hex}22`、`:86` `${color.hex}33`）。design「`${hex}1F`〜`${hex}33`」はこの延長。
5. **`color` prop 優先**: `ui-button.tsx:29` `color ?? '#208AEF'`。置換後も `color ?? Tint[scheme].tint` の順序を維持（呼び出し側が色チップ連動で背景色を渡す API）。

---

## 依存関係 / 影響箇所

- **`src/constants/theme.ts` への追加 export** の影響先 import（全 18 ファイル、grep 確定）: 既存は `Colors`(`(tabs)/index.tsx:4`)・`Spacing`(9 screens + `hint-row.tsx:7`)・`BottomTabInset`/`Fonts`/`ThemeColor`/`MaxContentWidth` を **named import**。新規 export 追加は named import を壊さない（後方互換）。
- **screens が直接使うのは `Spacing`/`Colors`/`BottomTabInset` のみ**。restyle 対象の共有コンポーネント経由で見た目は変わるが、screens 側のコード変更は不要（design §6「screens はトークン/部品適用以外触らない」と整合）。
- **`themed-text` の `linkPrimary` 変更**は `type="linkPrimary"` 利用箇所すべてに波及。利用箇所を要確認（grep 推奨）。`themed-text.tsx:24`/`:63-67` が当該。
- **`animated-icon.tsx:129` の splash 色** は app.json:34 splash と視覚連動。tint 集約で迂闊に変えると splash と不一致。

---

## 参考前例（リポジトリ内）

1. **ネイティブ任意機能の継ぎ目だけ作るパターン**: commit `bac55aa`（#13 匿名→Apple 連携、「native/Firebase は継ぎ目のみ」）/ `c9bfea4`（#11 ImageProcessor 抽象）。→ **GlassSurface も「対応端末では本物・それ以外はフォールバック」を 1 コンポーネントに閉じ込める**前例として近い。
2. **既存 reanimated+worklets 実装**: `src/components/animated-icon.tsx`（Keyframe / `'worklet'` / `scheduleOnRN`）。reanimated を新規に触る場合の現役サンプル。
3. **トークン純ロジックの追加様式**: `src/constants/theme.ts` の `Spacing`/`Colors` を `as const` で並べる既存形（theme.ts:10,54）。`Tint`/`Radius`/`Glass` も同形 `as const` で追加するのが踏襲。

---

## リスク箇所 3 件（必須）

### リスク① GlassView の iOS ネイティブ未リンクで「import/呼び出し時 throw」→ 全画面落ち
- 根拠: `node_modules/expo-glass-effect/build/GlassView.ios.js`（トップレベル `requireNativeViewManager('ExpoGlassEffect','GlassView')`）と `isLiquidGlassAvailable.ios.js` / `isGlassEffectAPIAvailable.ios.js`（lazy `requireNativeModule`）。`expo-dev-client` 未導入（Expo Go 前提）。
- 落とし穴: design §4 の「**import 時 try で囲む**」は **static import では実装不能**（import 巻き上げ・try 不可）。`isLiquidGlassAvailable()` 呼び出し自体も throw しうる。
- 対策: `Platform.OS==='ios'` ガード内で **動的 `require('expo-glass-effect')` を try**、`isGlassEffectAPIAvailable() && isLiquidGlassAvailable()` を try 内で評価、失敗時は即フォールバック View（上の実コード参照）。**ここを誤ると Expo Go で起動即クラッシュ**。最重要。

### リスク② splash 色の二重管理（`animated-icon.tsx:129` ⇄ `app.json:34`）の不整合
- 根拠: `animated-icon.tsx:129` `backgroundColor:'#208AEF'`（JS の splash オーバーレイ）と `app.json:34` `"backgroundColor":"#208AEF"`（ネイティブ splash）。design §6 は app.json を **値据え置き**と指示。
- 落とし穴: §9-4 の一括置換で `animated-icon.tsx:129` を `Tint[scheme].tint`（ライト `#208AEF`/ダーク `#3C9FFE`）にすると、**ダーク時に JS splash だけ色が変わり app.json のネイティブ splash と段差**が出る。また `animated-icon` は scheme フック未使用（現状 hex 直書き）で、ここに `useTheme`/scheme を持ち込むと splash の単純さが崩れる。
- 対策: `animated-icon.tsx:129` は **置換対象から外す or `#208AEF` 固定のまま**にし、app.json と一致を保つ。tint 集約は UI シャシー（ボタン/リンク/profile）に限定。

### リスク③ `Tint` を `Colors` に混ぜると `ThemeColor` 型が広がり `themed-view`/`themed-text` の prop が破壊（型崩れ）
- 根拠: `theme.ts:27` `ThemeColor = keyof Colors.light & keyof Colors.dark`、`themed-text.tsx:8`/`themed-view.tsx:9` が `ThemeColor` を prop 型に使用、`themed-text.tsx:17`/`themed-view.tsx:15` が `theme[key]` でアクセス。
- 落とし穴: 利便性で `Colors.light.tint=...` と足すと、`ThemeColor` に `tint` 等が混入 → `themed-*` が tint キーを受け付けてしまい、`useTheme()` 戻り値（5キー）には tint が無いため `theme[themeColor]` が `undefined` を返す **実行時バグ + 型の意味崩壊**。
- 対策: `Tint` は **必ず独立 export**。`shadow()` も独立関数。`Colors` オブジェクトは 5 キーのまま不変（design 方針どおり）。

---

## 既存テストの状況（参考）

- jest テストは **ドメイン/リポジトリのみ**（`src/domain/*.test.ts`, `src/repositories/mock/*.test.ts`、計 8 本 + rules 2 本）。`jest.config.js` は `testEnvironment:'node'`・component テストなし。
- **コンポーネントのスナップショット/レンダリングテストは存在しない**（`best-nine-grid` 等も含めゼロ。grep 確定）。→ **style 変更・StyleSheet 値変更は jest のアサート/スナップショットに一切触れない**。design の「tsc 0 / jest 79 を壊さない」は、**型を壊さなければ達成**（テストは振る舞いロジックのみ）。
- 注意（型側）: `themed-text` の `type` union に `display`/`hero` を **追加（削除/変更なし）**なら後方互換。既存 7 バリアントの string literal を変えると利用箇所の型エラー → union は **追加のみ**厳守（落とし穴: 既存 `linkPrimary` 等のリネーム禁止）。

---

## Implementer への落とし穴まとめ（§6 対応）

1. **glass の throw**: static import 不可。`Platform.OS==='ios'` + 動的 `require` + try + `isGlassEffectAPIAvailable()&&isLiquidGlassAvailable()`。Android/Web/非対応 iOS は常にフォールバック View。（リスク①）
2. **reanimated 未設定の心配は不要**: babel-preset-expo 54 で稼働実績あり（animated-icon.tsx）。ただし design 方針どおり **Pressable transform scale を第一**にし、reanimated 新規導入はしない。
3. **ThemeColor 型の広がり**: `Tint`/`Radius`/`Glass`/`shadow()` は **すべて `Colors` と別 export**。（リスク③）
4. **ダーク影**: iOS は影が見えにくい。design の `shadow(level,scheme)` で dark は `opacity×1.5`。Android は `elevation`。フォールバック Glass の border も dark/light で別値（design §2 Glass）。
5. **`color` prop 優先の維持**: `ui-button.tsx:29` は `color ?? Tint[scheme].tint` の順序厳守。
6. **display/hero 追加時の union 後方互換**: `themed-text.tsx:7` の `type` union は **追加のみ**。既存リテラルのリネーム/削除禁止。`linkPrimary` の hex は StyleSheet(themed-text.tsx:66) から外し描画時 tint を当てる（`color` style 競合に注意: themed-text.tsx:17 で `{color: theme[...]}` を先頭に置くので、linkPrimary 用 tint は後段で上書きする順序にする）。
7. **splash 色二重管理**: `animated-icon.tsx:129` と `app.json:34` の一致維持（リスク②）。
