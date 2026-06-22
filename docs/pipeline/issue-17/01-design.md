# Issue #17 / Stage 1/5 Architect — UI/UX 刷新（色を主役・Gen Z 2026）

## 方針（1行）
`theme.ts` に Radius / Elevation(Shadow) / Glass / Tint の4トークン群を**既存 Colors/Spacing を壊さず追加**し、`#208AEF` を `tint` に集約、共有コンポーネントを**props API 据え置きのまま**新トークンで restyle、`GlassSurface` を Expo Go フォールバック付きで新設する。

## 1. デザイン言語
地（背景）はモノクロ維持＝情報の静かな器。彩度は**12色（COLOR_POOL）と単一の tint だけ**が担い、色は「面」でなく「アクセント・縁・バー・チップ」として差し込む（過剰刺激回避）。角丸は一段チャンキー（カード16→20・ボタン14→md・タイル10→14）、影は黒の極薄・大ボケ（柔影）で浮遊感のみ。Liquid Glass は映える1〜2箇所限定（ヘッダー・主要カード上層・モーダル土台）。本文/リストはソリッド `backgroundElement` 維持。モーションは押下スケール0.97程度。タイポは display/hero で大きな数字・短い見出しを担当。色は SPEC §6 尊重（名前ラベル必須・`contrastTextColor` 不変）。

## 2. トークン（theme.ts に追記・既存 export 不変）
### Tint（Colors とは別 export。ThemeColor 型を広げないため）
```
Tint = {
  light: { tint:'#208AEF', tintPressed:'#1A6FBF', tintText:'#FFFFFF', tintSubtle:'rgba(32,138,239,0.12)' },
  dark:  { tint:'#3C9FFE', tintPressed:'#2E7FD6', tintText:'#FFFFFF', tintSubtle:'rgba(60,159,254,0.18)' },
}
```
### Radius
`{ sm:8, md:14, lg:20, xl:28, pill:999 }`
### Shadow ヘルパ `shadow(level:0|1|2|3, scheme)` → ViewStyle（dark は opacity×1.5）
```
1 (chip): iOS {shadowColor:'#000',shadowOpacity:0.06,shadowRadius:6, shadowOffset:{w:0,h:2}}  / Android {elevation:2}
2 (card): iOS {shadowOpacity:0.10,shadowRadius:14,shadowOffset:{w:0,h:6}}                       / Android {elevation:5}
3 (modal):iOS {shadowOpacity:0.14,shadowRadius:24,shadowOffset:{w:0,h:10}}                      / Android {elevation:10}
0: {}
```
### Glass（フォールバック描画値）
```
Glass = {
  light:{ fill:'rgba(255,255,255,0.55)', border:'rgba(255,255,255,0.6)', borderHairline:'rgba(0,0,0,0.08)' },
  dark: { fill:'rgba(30,30,32,0.55)',    border:'rgba(255,255,255,0.12)', borderHairline:'rgba(255,255,255,0.08)' },
}
```
### 12色の運用指針
COLOR_POOL は所有者アイデンティティ専用（色バー/chip/best-nine フレーム/＋記号）。UIシャシー（ボタン/ヘッダー）には使わない。淡い下地は `${hex}1F`〜`${hex}33` 透過で統一。

## 3. タイポ（themed-text に追加・既存7バリアント不変）
`type` union に追加（削除/変更なし）。iOS は `Fonts.rounded`。
```
display: { fontSize:64, lineHeight:64, fontWeight:'800', letterSpacing:-1.5 }  // 大きな数字
hero:    { fontSize:28, lineHeight:34, fontWeight:'800', letterSpacing:-0.4 }  // 見出し
```
`linkPrimary` の `#3c87f7` を削除し描画時に `Tint[scheme].tint` を当てる（ハードコード解消）。

## 4. GlassSurface（新規 src/components/glass-surface.tsx）
```ts
type Props = { children: ReactNode; intensity?: 'regular'|'clear'; radius?: keyof typeof Radius; style?: ViewStyle };
```
- 対応時: expo-glass-effect の GlassView（`isLiquidGlassAvailable()` 判定）。
- フォールバック（Expo Go/Android/非対応iOS）: View に `Glass[scheme].fill` + `borderWidth:hairline` + `borderHairline` + Radius + `shadow(2)`。
- **機能検知は import 時 try で囲み、未リンクでも throw しない**（必須）。
- 適用: 主要カード上層・モーダル土台・将来ヘッダー。本文リストは不可。

## 5. 共有コンポーネント restyle（API据え置き）
- ui-button: `#208AEF`→`tint`、pressed は `tintPressed` 背景+scale0.97、`Radius.md`、primary に `shadow(1)`。`color` prop 優先は維持。
- color-chip: `Radius.pill` 維持、`shadow(1)` で艶。`contrastTextColor` 不変。Pressable 化しない。
- trip-card: `Radius.lg` + `shadow(2)`、色バー 8→10、pressed scale0.98、背景は backgroundElement 維持（ガラス化しない）。
- best-nine-grid: タイル `Radius.md`、埋まりセルに色フレーム1.5px、空き＋を tint/淡色で質感UP。
- reaction-bar: chip `Radius.md`、selected を `tintSubtle`+`shadow(1)`、押下 scale0.94。
- hint-row: `Radius.sm` 微調整のみ。
- マイクロインタラクション: **Pressable の `transform:[{scale}]` を第一推奨**（Expo Go安全・依存ゼロ）。reanimated は babel 設定確認できた箇所のみ限定。必須経路にしない。

## 6. 影響ファイル
新規: `src/components/glass-surface.tsx`
変更: `theme.ts` / `themed-text.tsx` / `ui-button.tsx` / `color-chip.tsx` / `trip-card.tsx` / `best-nine-grid.tsx` / `reaction-bar.tsx` / `hint-row.tsx` / `animated-icon.tsx`(+.web 確認) / `profile.tsx`(L106) / `profile/edit.tsx`(L107,112) の `#208AEF`→tint。app.json splash は値据え置き・注記のみ。screens はトークン/部品適用以外触らない。~300行/1PR。

## 7. やらないこと
画面の情報設計/フロー改造（別Issue）/ expo-linear-gradient 導入見送り / ドメイン・Repository・テスト・contrastTextColor・COLOR_POOL 値 不変。

## 8. リスク
API破壊なし（style内部のみ・union追加は後方互換）/ Expo Go で expo-glass-effect が throw したら全画面落ち→try＋即フォールバック必須 / dark の柔影消え→opacity×1.5 / 色覚多様性維持。

## 9. Investigator 確認事項
1. expo-glass-effect ~0.1.10 / SDK54 の実 API（GlassView/GlassEffectView・isLiquidGlassAvailable・glassEffectStyle/tintColor/interactive）。
2. Expo Go で import/レンダリングして throw しないか、フォールバック分岐条件（Platform か availability か）。
3. reanimated 4 の babel 設定（plugin 有無）と Expo Go で withSpring 動作。無ければ Pressable のみ。
4. `#208AEF` 全参照の確定列挙（ui-button:29 / animated-icon:129 / profile:106 / profile/edit:107,112 / app.json:34 splash）+ themed-text:66 `#3c87f7` + .web 派生。
5. 既存 screens の Spacing/Colors/useTheme 参照箇所と、Tint 別 export が `ThemeColor`（themed-view/themed-text の themeColor 型）に影響しないことの保証。
