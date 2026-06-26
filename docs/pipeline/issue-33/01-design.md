# Issue #33 設計方針: UIButton の押下フィードバックを Reanimated でなめらかにする

**Issue: #33**
**Stage: 1/5 Architect**

## 1. 課題の要約と前提

`UIButton`（`src/components/ui-button.tsx`）は `Pressable` の `style={({ pressed }) => ...}` 内で `transform: [{ scale: pressed ? 0.97 : 1 }]` と `backgroundColor` を瞬時切り替えしており、補間がないためカクつく。これを Reanimated 4.1 の spring/timing で滑らかにする。

確認した事実:
- 本体は 73 行の単一関数コンポーネント。`*.web.tsx` の別実装は**存在しない**（`ui-button.tsx` のみ）。
- 色ロジックは `bg`（line 33）、`pressedBg`（line 35）、`textColor`（line 36）で確定済み。
- `pressedBg` が `bg` と異なるのは「primary かつ `color` 未指定」のときだけ（line 35）。それ以外は `pressedBg === bg`。
- `disabled || loading` 時は `Pressable` が `disabled` になる（line 41）→ そもそも `onPressIn/Out` が発火しない。
- Reanimated / gesture-handler は導入済み（追加インストール不要）。

## 2. 設計方針

`Pressable` を `Animated.createAnimatedComponent(Pressable)` でラップした `AnimatedPressable` に置き換える。`useSharedValue(0)` を1本だけ持ち（`progress`: 0=解放, 1=押下）、`onPressIn` で `withSpring(1)`、`onPressOut` で `withSpring(0)` を代入。`useAnimatedStyle` 内で `progress` から `scale`（`interpolate(progress, [0,1], [1, 0.97])`）と `backgroundColor`（`interpolateColor`）を導出する。静的スタイル（角丸・影・borderColor・opacity）は従来どおり通常 style 配列に残し、アニメ対象のみ animated style に切り出す。spring は跳ね返り過多を避け `damping: 18, stiffness: 220, mass: 0.7` 程度（弾みすぎないキビキビ系）を初期値とし、Investigator が他コンポーネントの既存 spring 設定を確認して合わせる。

## 3. backgroundColor アニメーションの扱い

- **方針**: `useAnimatedStyle` 内で `interpolateColor(progress, [0,1], [bg, pressedBg])` で補間する。
- **条件分岐**: `pressedBg === bg` となるケース（secondary / `color` 明示指定 / primary+色指定）では始点終点が同色なので補間しても見た目は変化せず、現状の意図（色を尊重）が自動的に維持される。分岐を増やさず `interpolateColor` に一本化できる。
- **scale と background の分離**: Issue が「可能なら timing で滑らかに」と明記しているため、**shared value 2本（scale 用 spring / color 用 timing）を採用**する。色は `withTiming`（120ms 程度, ease）。
- **web/native 差異**: `interpolateColor` は web でも動作する。`bg`/`pressedBg` は `rgb`/`hex`/named color いずれも解釈可能。`'transparent'`（secondary 時の `bg`）も補間始点として有効。

## 4. web 版の扱い

`src/components/ui-button.web.tsx` は**存在しない**。よって web は同一 `ui-button.tsx` を bundle する。Reanimated 4.1 は web 対応のため `useAnimatedStyle` / `interpolateColor` / `withSpring` はそのまま動く。新規 web 専用ファイルは**作らない**。Investigator は web ビルドで Reanimated worklet が有効か（babel plugin 設定）だけ確認する。

## 5. スコープと「やらないこと」

**スコープ（影響範囲）**:
- 変更ファイル: `src/components/ui-button.tsx` の **1ファイルのみ**。
- 変更行数オーダー: 30〜40行（import 追加、shared value 2本、`useAnimatedStyle`、`onPressIn/Out`、`Pressable`→`AnimatedPressable` 置換、style 配列の分割）。
- Props / 公開 API は不変。呼び出し側の修正は発生しない。

**やらないこと**:
1. 色ロジック（`bg`/`pressedBg`/`textColor` の決定式, line 33-36）の意味は変えない。spring/timing の見た目変更に留める。
2. `ui-button.web.tsx` の新規作成・web 専用分岐は行わない（共通実装で完結させる）。
3. 他コンポーネントへの spring プリセット共通化・テーマへのアニメ定数切り出しは別 PR。今回は本コンポーネント内にローカル定数で持つ。

## 6. リスク・注意点

- **Pressable のアニメ化の落とし穴**: `Animated.createAnimatedComponent(Pressable)` はコンポーネント定義の外（モジュールトップ）で生成すること。コンポーネント内で生成すると毎レンダー別コンポーネント扱いになり再マウントする。
- **`disabled`/`loading` 時**: `Pressable` が `disabled` なので `onPressIn/Out` は発火せず、`progress` は 0 のまま。追加ガードは原則不要だが、念のため `onPressIn` 内で `disabled||loading` を早期 return する防御を入れてもよい。`opacity: 0.4` は静的 style 側に残す。
- **Reanimated 4 の API 差異**: v4 でも `useSharedValue` / `useAnimatedStyle` / `withSpring` / `withTiming` / `interpolate` / `interpolateColor` は維持。worklet 化は babel plugin（v4 では `react-native-worklets/plugin` に移行している可能性あり）の設定に依存 → Investigator が `babel.config.js` を要確認。
- **`pressedBg === bg` 同色補間**: `interpolateColor` の始点終点が同一でも no-op で安全。`'transparent'` を含む補間も secondary は元々同色なので影響なし。
- **style 配列と animated style の合成**: `transform`/`backgroundColor` は **animated style 側にのみ**置き、静的 style 配列側から削除する。`style` prop（呼び出し側上書き）は従来どおり最後段に合成する。
