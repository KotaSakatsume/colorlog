# Issue #33 調査結果 — Stage 2/5 Investigator

対象: `src/components/ui-button.tsx`（Pressable → AnimatedPressable + Reanimated 化）

## 1. Reanimated の既存使用例

リポジトリ内で `react-native-reanimated` を import している箇所は **2ファイルのみ**。設計が使う API（`useSharedValue`/`useAnimatedStyle`/`withSpring`/`withTiming`/`interpolateColor`）は**一切未使用**。前例なし。

- `src/components/animated-icon.tsx:4` — `import Animated, { Easing, Keyframe } from 'react-native-reanimated'`。Keyframe entering のみ。worklet 内で `scheduleOnRN`（`react-native-worklets`, `:5`）使用（`:36-41`）。
- `src/components/ui/collapsible.tsx:4` — `import Animated, { FadeIn } from 'react-native-reanimated'`。`FadeIn.duration(200)` のみ（`:33`）。

**慣習**: named import を `Animated` default と同じ文に混ぜる書き方。spring/timing パラメータの前例は**コードベースに無い** → 設計の `damping:18, stiffness:220, mass:0.7` / `withTiming 120ms` をそのまま採用してよい（突き合わせ対象が存在しない）。

## 2. babel 設定

- **`babel.config.js` も `metro.config.js` も存在しない**。babel-preset-expo デフォルトに依存。
- `babel-preset-expo` は `react-native-worklets` があれば `react-native-worklets/plugin` を自動適用（`node_modules/babel-preset-expo/build/index.js:284-291`）。
- `react-native-worklets@0.5.1` 導入済み。→ **`babel.config.js` を新規作成して plugin を手動追加する必要なし**（作ると二重適用リスク）。
- web: `metro.config.js` 不在で標準 expo パイプライン。worklet の web 動作は未実機検証。

## 3. export 元（reanimated 4.1.7、`~4.1.1` 指定）

`node_modules/react-native-reanimated/lib/typescript/index.d.ts`:
- `interpolateColor` ✅ / `withSpring`,`withTiming` ✅ / `createAnimatedComponent` ✅ / `Easing` ✅
- すべて `'react-native-reanimated'` トップレベルから import 可能。

## 4. Pressable アニメ化の前例

- `createAnimatedComponent|AnimatedPressable|useSharedValue|useAnimatedStyle|interpolateColor` の grep → **src 配下ヒットゼロ**。前例なし。
- reanimated プリビルド済みは `View/Text/Image/ScrollView/FlatList` のみ。**`Animated.Pressable` は存在しない** → `createAnimatedComponent(Pressable)` が唯一の正解。`Animated.Pressable` 期待コードは crash。

## 5. テスト

- `ui-button` のテストは**存在しない**。テストは `src/domain/**`（純ロジック）と `tests/rules/**`（Firebase emulator）のみ。コンポーネントテストの前例ゼロ。
- `jest.config.js`: `testEnvironment: 'node'`（jsdom でない）、reanimated mock なし、`@testing-library/react-native` は devDeps にあるが未使用。
- → **コンポーネントテストを足すと testEnvironment 変更 + reanimated mock + RN preset 導入が必要で、本改修のスコープを大きく超える。** 既存テストは ui-button を import していないため現状は壊れない。

## 6. theme 色形式

`src/constants/theme.ts`:
- `Tint[scheme].tint`/`tintPressed`/`tintText` は全て **6桁 hex**（`:79-90`）。interpolateColor OK。
- **`bg='transparent'` ケース**: `ui-button.tsx:33` の `secondary`。この時 `pressedBg=bg='transparent'`（同色 no-op）。
- `color` prop は `COLOR_POOL` の hex（`src/domain/colors.ts`）。compose/index で `color={myColor.hex}`。
- → interpolateColor 入力は「6桁 hex」or「`'transparent'`」。transparent×hex の混在補間は設計上発生しない。

## 7. リスク（落とし穴）

### リスク1【テスト環境】
`jest.config.js` は node 環境 + reanimated mock 無し。ui-button を import するテストを安易に足すと環境ごと作り直し。現状は誰も import していないので壊れない。→ **ui-button にコンポーネントテストを足さない判断が無難**（domain 層の慣習に従う）。

### リスク2【同色 no-op の分岐漏れ — 最重要】
`secondary` は `bg=pressedBg='transparent'`、`color` 指定 primary も `pressedBg=bg`（`:33,35`）。`interpolateColor` を**無条件に animated style へ入れると secondary / color指定primary の現状挙動を変える恐れ**。→ **`bg === pressedBg` の早期分岐で animated backgroundColor 自体を出さない実装が安全側**。

### リスク3【静的 style と animated style の分離】
`ui-button.tsx:42-52` で pressed/bg 依存値は `backgroundColor(:46)`/`borderColor(:47)`/`opacity(:48)`/`transform(:49)`。
- `borderColor` は pressed 非依存だが `bg`（動的 color/theme）依存。`opacity` は disabled 依存。`shadow(1,scheme)` は scheme 依存。
- → **これらは「非アニメだが動的」。`StyleSheet.create` へ移すと壊れる。インライン style に残し、animated style には入れない**。

### リスク4【web】
web 動作未検証。`ui-button.web.tsx` 不在で単一ファイルが web も担う。worklet style が web で反映されない可能性は残る（推測）。

## 依存 / 影響箇所

callers は全て `src/app/**`（props 経由なので内部実装変更の影響を基本受けない）。
- `color` prop（hex）: `compose.tsx:218`, `trip/[id]/index.tsx:171` → 同色 no-op ケース。
- `variant="secondary"`: `(tabs)/index.tsx:33`, `profile.tsx:57,68`, `join.tsx:85`, `avatar.tsx:189`, `create.tsx:181` → transparent no-op ケース。
- `loading`: `join.tsx:91` 等 → disabled 中 onPressIn/Out 不発火の検証対象。

## 事実 / 推測

**事実（コード確認済み）**: 上記の各ファイル:行。babel/metro config 不在、worklets plugin 自動適用、reanimated 4.1.7 export 群、`Animated.Pressable` 不在、ui-button テスト不在、jest node 環境かつ mock 無し、theme 色が hex/transparent。

**推測（未検証）**:
- web で `createAnimatedComponent(Pressable)` + worklet style が動くか未検証。
- spring 定数の体感整合は前例なしで比較不能。
- transparent 補間が完全 no-op かは未実行確認 → `bg===pressedBg` 早期分岐で animated backgroundColor を出さない実装が安全側。
