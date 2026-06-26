# Issue #33 コードレビュー — Stage 4/5 Reviewer

対象: `src/components/ui-button.tsx`（reanimated 4.1）

## 1. 設計準拠

AnimatedPressable のトップ生成 / shared value 2本 / interpolate・interpolateColor / 同色 no-op ガード / 静的・animated style 分離 / Props 不変 / babel 不変 / テスト非追加 — **すべて準拠**。スコープ逸脱なし。

## 2. バグ・正しさ

### [must] useAnimatedStyle に明示依存配列がない（worklet 再生成の保証）
worklet 内で `animateBg`/`bg`/`pressedBg`（JS クロージャ値）を参照。Babel の自動依存収集に暗黙依存しており、テーマ切替・color 変化時に古い色へ固定されるリスク。コンポーネントテストが無く CI で検知不能なため安全側に倒す。
→ 修正: `useAnimatedStyle(() => {...}, [animateBg, bg, pressedBg])`

### [should] backgroundColor の静的フォールバックがない
`animateBg===true` 時は背景を animated 側が単独供給。worklet 再構築の瞬間にフォールバックが無い。
→ 修正: 常に静的 `backgroundColor: bg` を残す（animated が上書きするので二重指定の害なし）。条件付きスプレッド `...(animateBg ? null : {...})` も解消できる。

### [should] onPressOut に disabled/loading ガードがなく press 状態が固着しうる
押下中（pressProgress≒1）に onPress 内で loading=true にすると、Pressable が disabled 化して onPressOut が不発火 → 縮小状態のまま固着。ローディングボタンという主用途で起きうる。
→ 修正: disabled/loading 遷移時に press 状態を復元する effect を追加。
```ts
useEffect(() => {
  if (disabled || loading) {
    pressProgress.value = withSpring(0, SPRING);
    colorProgress.value = withTiming(0, { duration: 120 });
  }
}, [disabled, loading]);
```

### [nit] colorProgress が no-op ケースでも駆動される
無害（UI 未反映）。最適化はやらない方針につき修正不要。

## 3. 可読性

- [nit] spring 設定 `{damping:18,stiffness:220,mass:0.7}` が press In/Out で重複 → `const SPRING = {...} as const` に括り出し推奨。
- [nit] 条件付きスプレッドは可読性低 → 上記 should 修正で解消。

## 4. セキュリティ

該当なし（新規依存・外部入力・認可いずれも無関係）。

## 5. テスト評価

設計通りコンポーネントテスト非追加は妥当。`tsc`/`npm test` は本変更を未カバー（合意済みの割り切り）。must/should は自動検知不能なため、マージ前に手動確認推奨：
1. ライト/ダーク切替で押下時背景が新テーマ tintPressed になるか（must 検証）
2. ローディング primary 連打で縮小状態が残らないか（should 検証）
3. color 指定 primary / secondary で押下時に背景色が変わらないこと（no-op 検証）

## 総評（初回）: 要修正（Implementer へ差し戻し）

- must 1件: useAnimatedStyle 明示依存配列
- should 2件: backgroundColor 静的フォールバック / loading・disabled 遷移時の press 状態復元
- nit 3件: 任意（SPRING 定数化など）

設計は妥当。差し戻しは実装層の軽微な堅牢化で完結。

---

## 再レビュー（修正後・1往復目）: approve

| # | 指摘 | 反映 |
|---|------|------|
| must | useAnimatedStyle 依存配列 `[animateBg, bg, pressedBg]` | ○ |
| should1 | backgroundColor 静的フォールバック常設（条件付きスプレッド廃止） | ○ |
| should2 | disabled/loading 遷移時の press 状態復元 useEffect | ○ |
| nit | SPRING/TIMING 定数化（4箇所で参照） | ○ |

- リグレッション検証: style 重ね順・useEffect 依存・handlePressOut 無条件実行・`as const` 型適合いずれも問題なし。前回 must の stale closure 懸念は解消。
- `tsc --noEmit` exit 0 / `npm test` 108件全通過。diff は ui-button.tsx 1ファイルのみ。

**結論: approve（must/should/nit すべて 0件）。マージ可。**
