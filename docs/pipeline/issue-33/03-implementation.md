# Issue #33 実装サマリー — Stage 3/5 Implementer

ブランチ: `pipeline/issue-33`

## 変更ファイル
- `src/components/ui-button.tsx`（このファイルのみ。+47 / -5）

## 実装の要点（01-design.md 準拠）
- `Animated.createAnimatedComponent(Pressable)` を**モジュールトップ**で生成し `AnimatedPressable` に置換。
- shared value 2本: `pressProgress`（scale, withSpring）/ `colorProgress`（color, withTiming）。0=解放 / 1=押下。
- `onPressIn`: `withSpring(1,{damping:18,stiffness:220,mass:0.7})` + `withTiming(1,{duration:120})`。`onPressOut`: 同パラメータで 0 へ。
- `useAnimatedStyle`: `scale = interpolate(pressProgress,[0,1],[1,0.97])`、`backgroundColor = interpolateColor(colorProgress,[0,1],[bg,pressedBg])`。

## 調査由来ガードの遵守状況（02-research.md）
1. **同色 no-op 早期分岐** ✅ JS 側で `animateBg = isPrimary && !color`（= bg !== pressedBg）を判定。`useAnimatedStyle` 内は `animateBg` のときだけ backgroundColor を返す。no-op ケース（secondary 全般 / color 指定 primary）は静的 `backgroundColor: bg` をインラインに残し、interpolateColor を出さない。
2. **静的だが動的な値を StyleSheet に移さない** ✅ `borderColor` / `opacity` / `shadow(1,scheme)` はインライン style に据え置き。
3. **transform / アニメ背景は静的配列から削除** ✅ animated style 側にのみ配置。no-op ケースの静的背景のみインライン。
4. **babel.config.js は触らない** ✅ 作成・変更なし。
5. **コンポーネントテストは追加しない** ✅（jest=node 環境・reanimated mock 無し）。
6. **disabled/loading ガード** ✅ `handlePressIn` 冒頭に `if (disabled || loading) return;`。opacity は静的のまま。
7. **Props / 公開 API 不変** ✅ 呼び出し側の変更ゼロ。

## 検証結果
- `npx tsc --noEmit`: **exit 0（型エラーなし）**
- `npm test`（jest）: **9 suites / 108 tests 全通過**。ui-button 改修の影響なし（domain/rules テストのみ）。
- `npm run lint`: 環境に eslint 本体が未インストールで失敗（既存の環境不備、コード起因ではない）。lint が副作用で生成した `package.json`/`package-lock.json` の差分と `eslint.config.js` は復元・削除し、**diff を ui-button.tsx の1ファイルに限定**。

## 残課題 / 申し送り
- lint 環境（eslint 導入）整備はスコープ外 → 別途対応。
- worklet の挙動は jest で検証不可（ガード5）→ 実機/Expo 上での目視確認に委ねる。
