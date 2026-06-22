# Issue: #17 / Stage 3/5 Implementer — UI/UX 刷新（色を主役・Gen Z 2026）

入力: `01-design.md` + `02-research.md`。ブランチ `pipeline/issue-17`（main 直 commit なし・未 commit）。
実 SDK 54。`tsc --noEmit` = 0 / `jest` = 79 全 pass / `expo config --json` = exit 0 を確認済み。

---

## 1. 変更/新規ファイル一覧（各 1 行・変更意図）

| ファイル | 種別 | 変更意図 |
|---|---|---|
| `src/constants/theme.ts` | 変更 | 既存 export の後ろに `Tint`/`Radius`/`Glass`/`shadow()` を追記（既存 Colors/Spacing/Fonts 不変・独立 export）。 |
| `src/components/themed-text.tsx` | 変更 | `type` union に `display`/`hero` 追加（既存 7 不変）、`linkPrimary` の `#3c87f7` を描画時 tint 参照に。 |
| `src/components/glass-surface.tsx` | 新規 | Liquid Glass サーフェス。Expo Go 安全な動的 require + try でフォールバック描画。 |
| `src/components/ui-button.tsx` | 変更 | `#208AEF`→tint、pressed=tintPressed+scale0.97、`Radius.md`、primary に `shadow(1)`。`color` prop 優先維持。 |
| `src/components/color-chip.tsx` | 変更 | `Radius.pill` 維持＋`shadow(1)` で艶。`contrastTextColor` 不変・Pressable 化しない。 |
| `src/components/trip-card.tsx` | 変更 | `Radius.lg`＋`shadow(2)`、色バー 8→10、pressed scale0.98。背景 backgroundElement 維持。 |
| `src/components/best-nine-grid.tsx` | 変更 | タイル `Radius.md`、埋まりセルに所有者色 1.5px フレーム。 |
| `src/components/reaction-bar.tsx` | 変更 | chip `Radius.md`、selected を `tintSubtle`+`shadow(1)`、押下 scale0.94。 |
| `src/components/hint-row.tsx` | 変更 | `borderRadius` を `Spacing.two`→`Radius.sm`（微調整のみ）。 |
| `src/app/(tabs)/profile.tsx` | 変更 | アバター下地 `#208AEF`→`Tint[scheme].tint`（StyleSheet hex 撤去・inline 適用）。 |
| `src/app/profile/edit.tsx` | 変更 | avatarFallback / changePhoto の `#208AEF`→`Tint[scheme].tint`。 |

**触っていない（意図的）**: `src/components/animated-icon.tsx:129`（splash 単色）/ `app.json:34`（splash）＝リスク② splash 二重管理の据え置き。screens は上記 profile 系 hex 置換以外ノータッチ。ドメイン/Repository/テスト/`contrastTextColor`/`COLOR_POOL` 不変。

---

## 2. トークンの実値（`theme.ts` 追記分・すべて Colors と独立 export）

```ts
Tint = {
  light: { tint:'#208AEF', tintPressed:'#1A6FBF', tintText:'#FFFFFF', tintSubtle:'rgba(32,138,239,0.12)' },
  dark:  { tint:'#3C9FFE', tintPressed:'#2E7FD6', tintText:'#FFFFFF', tintSubtle:'rgba(60,159,254,0.18)' },
} as const;

Radius = { sm:8, md:14, lg:20, xl:28, pill:999 } as const;

Glass = {
  light:{ fill:'rgba(255,255,255,0.55)', border:'rgba(255,255,255,0.6)', borderHairline:'rgba(0,0,0,0.08)' },
  dark: { fill:'rgba(30,30,32,0.55)',    border:'rgba(255,255,255,0.12)', borderHairline:'rgba(255,255,255,0.08)' },
} as const;

shadow(level:0|1|2|3, scheme:'light'|'dark'='light'): ViewStyle
// 0:{} / iOS は shadow*（dark は opacity×1.5）/ Android は elevation 2/5/10
//   1(chip):  opacity 0.06, radius 6,  offset h2  | elevation 2
//   2(card):  opacity 0.10, radius 14, offset h6  | elevation 5
//   3(modal): opacity 0.14, radius 24, offset h10 | elevation 10
```

タイポ追加（`themed-text`・iOS は `Fonts.rounded`）:
```
display: { fontSize:64, lineHeight:64, fontWeight:'800', letterSpacing:-1.5, fontFamily:Fonts.rounded }
hero:    { fontSize:28, lineHeight:34, fontWeight:'800', letterSpacing:-0.4, fontFamily:Fonts.rounded }
```
`linkPrimary` は StyleSheet から `color:'#3c87f7'` を削除し、style 配列の後段で `{ color: Tint[scheme].tint }` を当てて上書き（先頭の `theme[...]` より後ろ＝確実に勝つ）。

scheme は全コンポーネントで `useThemeScheme()`（`src/hooks/use-color-scheme.ts`）から取得。既存 `useTheme()` は壊さず併用（調査の既存パターン §既存1 踏襲）。

---

## 3. GlassSurface のフォールバック実装方針（Expo Go 安全性）

`src/components/glass-surface.tsx`。props: `{ children, intensity?:'regular'|'clear', radius?:keyof Radius, style? }`（design §4 のまま）。

**安全機構（調査 §9-2・リスク① 厳守）**:
- `expo-glass-effect` を **static import しない**（import 巻き上げで try が効かないため）。
- モジュールトップで `Platform.OS === 'ios'` ガード内に限り **動的 `require('expo-glass-effect')` を try**。
- availability は **`isGlassEffectAPIAvailable?.() && isLiquidGlassAvailable?.()`** を try 内で評価（より厳密な API 不在チェックを先に AND）。
- 失敗・非対応・Android・Web は `glassUsable=false`／`NativeGlassView=null` で**即フォールバック描画**。
- フォールバック: `View` に `Glass[scheme].fill` + `borderWidth:StyleSheet.hairlineWidth` + `Glass[scheme].borderHairline` + `Radius[radius]` + `shadow(2,scheme)`。
- 対応時は `GlassView`（`glassEffectStyle=intensity` / `colorScheme=scheme`）でレンダリング。

→ **Expo Go で `ExpoGlassEffect` ネイティブ未リンクでも throw しない**（require の throw も availability 呼び出しの throw も try で握る）。dev-client 未導入の現状でも起動即クラッシュは起きない。本コンポーネントは新規追加のみで既存画面からは未参照（design §4「適用先は将来のヘッダー/カード上層」＝今回は土台のみ提供）。

---

## 4. 各コンポーネントの restyle 要点（props API 据え置き厳守）

- **ui-button**: `bg = color ?? Tint[scheme].tint`（**`color` 優先の順序維持**）。pressed は「明示 color 未指定の primary」だけ `tintPressed` に沈める（色指定時は渡された色を尊重）。`opacity` の押下フィードバックを廃し **`transform:[{scale: pressed?0.97:1}]`** に。primary に `shadow(1,scheme)`。`Radius.md`。`tintText` を白文字に。
- **color-chip**: `Radius.pill`、`shadow(1,scheme)` を追加。`contrastTextColor` 不変・Pressable 化しない・name ラベル必須維持（SPEC §6）。
- **trip-card**: `Radius.lg`、`shadow(2,scheme)`、色バー幅 8→10、押下 `scale 0.98`。背景は `backgroundElement` 維持（ガラス化しない）。
- **best-nine-grid**: タイル `Radius.md`。**埋まりセル**（uri あり）かつ `color` 有りのとき `borderWidth:1.5 / borderColor:color.hex` で所有者色フレーム。空き＋の色は既存どおり owner color（質感）。`miniSlot` は対象外（design §5 列挙外）。
- **reaction-bar**: chip `Radius.md`、selected を `Tint[scheme].tintSubtle` 背景＋`shadow(1,scheme)`、押下 `scale 0.94`。
- **hint-row**: `Radius.sm` への微調整のみ。

マイクロインタラクションは **Pressable の `transform:[{scale}]` のみ**（reanimated 新規導入なし＝調査 §9-3 の方針）。

---

## 5. Investigator リスク 3 件への対応

### リスク① GlassView の iOS ネイティブ未リンクで import/呼び出し時 throw → 全画面落ち
**対応済み（最重要）**。`glass-surface.tsx` で static import を排し、`Platform.OS==='ios'` ガード内の **動的 require + try**、availability(`isGlassEffectAPIAvailable && isLiquidGlassAvailable`)も try 内評価、失敗時は即フォールバック View。design §4 が言う「import 時 try」は static import では実装不能という調査の落とし穴①を反映し、**動的 require 方式**を採用。Android/Web は分岐に入らずフォールバック。

### リスク② splash 色の二重管理（`animated-icon.tsx:129` ⇄ `app.json:34`）
**対応＝据え置き**。一括 hex 置換から `animated-icon.tsx:129` を**除外**し `#208AEF` 固定のまま、`app.json:34` も**未変更**で両者一致を維持。tint 集約は UI シャシー（ui-button / linkPrimary / profile / profile-edit アバター）に限定し、ダーク時に JS splash だけ色がズレる事故を回避。grep で残存 `#208AEF` がこの 2 箇所＋`theme.ts` の tint 定義のみであることを確認済み。

### リスク③ `Tint` を `Colors` に混ぜると `ThemeColor` 型が広がり themed-* の prop 破壊
**対応済み**。`Tint`/`Radius`/`Glass`/`shadow()` は**すべて `Colors` と別の独立 export**。`Colors` は 5 キーのまま不変＝`ThemeColor = keyof Colors` も `useTheme()` 戻り値も不変。`themed-view`/`themed-text` の `themeColor: ThemeColor` 許容キーは 5 のまま。`tsc=0` で型崩れなしを実証。

---

## 6. テスト方針（追加なし・79 維持の根拠）

- 本リポジトリの jest は `testEnvironment:'node'`・ドメイン/Repository ロジック専用（component/snapshot テストは**ゼロ**＝調査確定）。
- `theme.ts` は `@/global.css` と `react-native` を import するため **node env では import 不可**（probe で `import '@/global.css'` が失敗することを実測確認）。`shadow()`/`Tint` を直接ユニットテストするには CSS トランスフォーム mock＋RN setup の**新規テスト基盤**が必要で、これは design §7 のスコープ外（テスト不変）かつ「jest 79 のまま」制約に反する。
- 今回の変更は **StyleSheet 値・style 配列・union 追加（後方互換）のみ**で振る舞いロジックに非干渉。よって既存 79 のアサートに一切触れず、追加テストなしで `tsc 0 / jest 79` を達成。リスク 3 件はいずれも**コード構造**（動的 require ガード／splash 据え置き／独立 export）で担保しており、ランタイムテストの追加は scope を test 基盤改修へ広げるため見送る。

---

## 7. Reviewer 申し送り

1. **GlassSurface の Expo Go 安全性**: static import 不使用・`Platform.OS==='ios'` + 動的 require + try + availability AND（`isGlassEffectAPIAvailable && isLiquidGlassAvailable`）で、ネイティブ未リンクでも throw しない設計。実機 Expo Go 検証は dev-client 未導入のため未実施（調査も「同梱有無は未検証・保守的に throw しうる前提」）。**コード上は throw 経路を全て try で囲んだ**が、実機での最終確認は次段で可能なら推奨。現状 GlassSurface は**どの画面からも未参照**（土台提供のみ）なので、未対応端末でもレンダリング経路に乗らず安全側。
2. **trip-card の shadow(2) と `overflow:'hidden'` の併存**: 既存カードは色バーの角丸クリップのため `overflow:'hidden'` を持つ。iOS では同一ノードの `overflow:hidden` が `shadow*` をクリップするため、**iOS では柔影が出ない**可能性がある（Android は `elevation` なので影は出る）。design §5 が trip-card に `Radius.lg`+`shadow(2)` を明示指定しているためそのまま実装した。影を iOS でも出すにはラッパ View 分離が要るが、これは情報設計/レイアウト変更（design §7 で禁止）に踏み込むため**今回は実装せず申し送り**。レビューで「iOS でカードの影を効かせたい」なら別 PR でラッパ分離を提案。
3. **`profile/edit.tsx` の `changePhoto` style**: `color` を inline tint に移したため StyleSheet 側は `changePhoto: {}`（空）になった。`style={[styles.changePhoto, {...}]}` の参照構造を保つための空オブジェクト。気になる場合は参照ごと削除可だが、最小差分のため残置。
4. **reanimated 不使用**: design 方針どおり Pressable の `transform:[{scale}]` のみ。reanimated/worklets は本番稼働中（animated-icon）だが新規依存は増やしていない。
