# 02-research.md

- Issue: #23
- Stage: 2/5 Investigator
- 対象: メンバーアバター — Humation で配布色に染まる `MemberAvatar`
- 調査方法: 静的調査のみ（実行なし）。`@humation/*` は colorlog 未インストール。実体は `/tmp/humation-test/node_modules/@humation/` を Read して確認。

---

## 0. 設計§9 確認事項への回答（要約）

| # | 確認事項 | 結論 |
|---|---------|------|
| 1 | assets export 名 / color slot / viewBox | export は **`humation1`**（`manifest`/`default` も同一実体）。color slot は `stroke/hair/skin/clothes/bottom`（＋`background`）。viewBox は **`-4 -4.5 88 88`**（crop=`avatar`）。 |
| 2 | core の型シグネチャ | `createAvatar(manifest, options?)` → `{ toString, toDataUri, toJSON, toRenderData }`。options は `{ seed, selections, colors, background, crop }`。`toRenderData(): { viewBox, background, colors, content }`。 |
| 3 | Metro / jest の ESM 解決 | **jest は現状落ちる**（`transformIgnorePatterns` 既定 = `/node_modules/`、`@humation/*` は ESM）。`@humation` を whitelist 必須（§3 に正しい書き方）。Metro(SDK54) は ESM exports 対応で OK。 |
| 4 | `SvgXml` | `react-native-svg@15.12.1` で **export 済み**。props は `xml` / `width` / `height` / `onError` / `fallback`。**`var()` は解決しない**（R1 確定）。 |
| 5 | 現状アバター箇所 | members.tsx `styles.swatch`(色丸 View, L39-44)、profile.tsx photoURL/頭文字分岐(L41-49)、trip-card.tsx は colorBar+ColorChip で**画像アバター無し**(余力枠)、color-chip.tsx は対象外。 |
| 6 | 焼き込み正規表現の実パターン | 実出力は **`var(--hm-KEY, #HHHHHH)`**＝lowercase key・**カンマ+半角スペース1個**・**6桁大文字 hex**。設計の正規表現で拾える（後述、軽微注意あり）。 |

**重要な設計補正（§2 の "background slot にメンバー色"）**: `background` はマニフェストの色 slot 一覧には居るが、`createAvatar({ background })` を渡すと **`var()` ではなく `<rect fill="#HEX">`（実 hex 直書き）** としてレンダされる（`create-avatar.js:109-111`）。つまり**メンバー色（背景）は最初から実 hex で出力され、R1（var 非解決）の影響を受けない**。R1 が効くのは `hair/skin/clothes/stroke/bottom`（キャラ造形色）だけ。この事実は Implementer のテスト assert 設計に直結する（§9 リスク参照）。

---

## 1. assets パッケージの実体

### package.json（`/tmp/humation-test/node_modules/@humation/assets-humation-1/package.json`）
- `"type": "module"`（ESM）、`"main": "./dist/index.js"`、`"sideEffects": false`（assets-humation-1/package.json:4,28,69）。
- `exports`: `"."` → `./dist/index.js`、ほか `./embedded`/`./manifest`/`./manifest-json`/`./manifest.json`/`./assets/*`（同 30-49 行）。
- **dependencies は `@humation/core` のみ。peerDependencies 無し**（同 70-72 行）。

### export 名（`assets-humation-1/dist/index.js:4`）
```js
export { default, manifest as humation1, manifest } from './embedded.js';
export { default as manifestJson, manifestJson as rawManifest } from './manifest-json.js';
```
→ **`import { humation1 } from '@humation/assets-humation-1'` が正しい**（設計の想定どおり）。`humation1` / `manifest` / `default` は**同一の埋め込みマニフェストオブジェクト**（`embedded.js` 由来、SVG 文字列が inline 済み）。`manifestJson`/`rawManifest` は SVG パス参照のみの生 JSON で**今回は使わない**（`createAvatar` には SVG inline 済みの `humation1` を渡す）。

### manifest 中身（`assets-humation-1/manifest.json` を Python で抽出）
- `schemaVersion: "1.0"`、`template.id: "humation-1"`、`shortId: "hm1"`。
- **crops**: `{ "avatar": { x: -4, y: -4.5, width: 88, height: 88 } }`（crop は `avatar` 1種のみ）。
- **defaults.colors**: `{ stroke:"000000", hair:"000000", skin:"FFFFFF", clothes:"FFFFFF", bottom:"000000" }`（※ `background` は **defaults.colors に含まれない**）。
- **defaults.background**: `"F6F5F4"`、**defaults.crop**: `"avatar"`。
- **color slot 一覧（manifest.colors[]、id / cssVariable / default）**:
  | id | cssVariable | default | allowTransparent |
  |----|------------|---------|-----------------|
  | background | `--hm-background` | F6F5F4 | true |
  | stroke | `--hm-stroke` | 000000 | – |
  | hair | `--hm-hair` | 000000 | – |
  | skin | `--hm-skin` | FFFFFF | – |
  | clothes | `--hm-clothes` | FFFFFF | – |
  | bottom | `--hm-bottom` | 000000 | – |
- **selectionSlots**: `["bottom","body","head","item","glasses"]`、parts 86 個（seed はこの5 slot を fnv1a で決定的選択）。

→ メンバー色の当て先は **`background`（rect・実 hex 直書き）が第一候補**（設計どおり、視認性最大・R1 非該当）。キャラ造形を色付けしたい場合は `colors:{ clothes: hex }` 等を使うが、その色は `var()` 出力になり **R1 の置換が必須**。

---

## 2. 色焼き込みの実パターン（`@humation/core/dist/create-avatar.js`）

### `createAvatar` の戻り（create-avatar.js:1-40, 型は create-avatar.d.ts）
```ts
createAvatar(manifest: HumationManifest, options?: CreateAvatarOptions): {
  toString(): string;           // 完成 SVG 文字列（root <svg> + bgRect + 各 <g>）
  toDataUri(): string;
  toJSON(): AvatarJson;
  toRenderData(): { viewBox, background, colors, content };  // root 無し fragment のみ
}
```
`CreateAvatarOptions = { seed?, selections?, colors?, background?, crop? }`（types.d.ts:113-131）。`colors`/`background` は `#` 有無どちらも可（内部で `normalizeHex` → 大文字6桁化, create-avatar.js:171-173）。

### 色がどう出力されるか（最重要・R1 の根拠）
`renderSvg`（create-avatar.js:105-116）:
1. **root `<svg style="...">`** に **CSS 変数**を焼く: `formatCssVariables` が `--hm-KEY:#HEX;...` を生成（同 165-170）。例: `style="--hm-bottom:#000000;--hm-clothes:#FFFFFF;..."`。この hex は `colors` オプションで上書きした実 hex。
2. **背景**は `<rect ... fill="#HEX" />` で**実 hex 直書き**（`background` オプション or default、同 109-111）。`transparent` 指定で rect 省略。
3. **各パーツ fragment** は SVG ソース内に **`fill="var(--hm-KEY, #fallback)"` のまま**埋め込まれる（`renderFragment`, 同 144-164。`stripSvgWrapper` で `<svg>` を剥いで `<g>` に包むだけ。**`var()` を実 hex に置換しない**）。

つまり **正規ルート（`colors` オプション）はブラウザの CSS cascade 前提**で、root `style` の `--hm-*` を子 fragment の `var()` が参照する設計。`create-avatar.js:139-143` のコメントが明言:
> "Color binding lives in the SVG sources themselves: recolorable regions reference CSS variables with default-color fallbacks ... the renderer has no marker-color or substitution knowledge."

→ **react-native-svg は CSS custom property cascade を実装しない**（§4 で確認）ので、`colors:{clothes:hex}` を渡しても **fragment の `var(--hm-clothes, #FFFFFF)` は fallback の白のまま**になる。**設計§2 の二段焼き込み（出力に残る `var()` を fallback hex に潰す正規表現）が R1 解決に必須**。

### `var()` の正確な実出力パターン（置換正規表現が拾うべき形）
実生成 SVG ではなく**埋め込み済み fragment（`assets-humation-1/dist/embedded.js`）を grep** して実体を確認:
```
fill="var(--hm-bottom, #000000)"     ×8
fill="var(--hm-clothes, #FFFFFF)"    ×25
fill="var(--hm-hair, #000000)"       ×26
fill="var(--hm-skin, #FFFFFF)"       ×60
fill="var(--hm-stroke, #000000)"     ×504
stroke="var(--hm-stroke, #000000)"   （stroke 属性にも出る）
```
**確定した形（事実）**:
- プレフィックス `var(--hm-` + lowercase slot 名（`stroke/hair/skin/clothes/bottom`）。
- カンマの後は **半角スペース1個固定**（`, `）。スペース無し版 `,#` は**0件**（grep 確認）。
- fallback hex は **常に `#` + 6桁大文字**（3/4/8桁は実体に存在しない）。
- `fill=` だけでなく **`stroke=` 属性にも出る**（合計 600件超、うち stroke slot が支配的）。

→ 設計の正規表現 `/var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g` → `$1` は**この実体を全て拾える**（`\s*` がスペース1個を吸収、`{3,8}` が6桁を含む）。**注意（軽微）**: `[\w-]` は `-` を含むので OK。ただし置換は `fill=`/`stroke=` の**属性値内**に限らず素朴な全文置換で問題ない（root `style` 内の `--hm-bottom:#000000` は `var(` を含まないので誤爆しない）。

### `toRenderData()` の戻り（create-avatar.js:27-38）
```js
toRenderData() {
  return {
    viewBox: { x:-4, y:-4.5, width:88, height:88 },  // resolveViewBox
    background: state.background,                      // "F6F5F4" or 実hex or "transparent"
    colors: { stroke, hair, skin, clothes, bottom },  // 実hex マップ（オプション反映済み）
    content: fragments.map(renderFragment).join(''),  // root <svg>無し。中の var() は残る
  };
}
```
**`content` にも `var(--hm-*)` が残る**（root style が無いぶん、`toRenderData` を使うなら自前で `colors` マップを使って置換する必要がある）。
→ **推奨は `toString()` を使い、その出力に対し二段目の正規表現置換を1回かける**実装（root に bgRect の実 hex 背景 + style 変数 + content の var を一括処理できる）。`toRenderData()` を使う場合は content の var を `colors` マップで自前解決する手間が増える。**事実として両者とも置換は必要**。

---

## 3. jest / Metro の ESM 解決（最重要・R2）

### 現状 `jest.config.js`（全文・/Users/.../colorlog54/jest.config.js）
```js
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/rules/'],
};
```
- `transformIgnorePatterns` の**指定なし** → jest 既定の `["/node_modules/", "\\.pnp\\.[^\\/]+$"]` が効く。
- `babel.config.js` は**存在しない**（リポジトリルートに無し）。babel 設定は jest 内 inline の `presets:['babel-preset-expo']` のみ。`babel-preset-expo` は `node_modules` に存在（確認済み）。

### 落ちるか → **落ちる（高確度）**
- `@humation/core` / `@humation/assets-humation-1` は `"type":"module"` の純 ESM、dist は `export {...} from '...'` 構文（実ファイル確認済み）。
- 既定 `transformIgnorePatterns: /node_modules/` は **node_modules 内を babel 変換しない** → ESM の `export`/`import` が CJS の `testEnvironment:'node'` でそのまま実行され **`SyntaxError: Unexpected token 'export'`**（または "Cannot use import statement outside a module"）で落ちる。
- 現状 8 テストファイルはいずれも **node_modules の ESM を import していない**（domain は全て `./` ローカル import。`assign-colors.test.ts:1-13` 等で確認）。**`@humation/*` が初の node_modules ESM import** になるため、ここで初めて顕在化する。

### 正しい修正（`transformIgnorePatterns` に whitelist）
```js
// jest.config.js に追加
transformIgnorePatterns: [
  'node_modules/(?!(?:@humation)/)',
],
```
- 意味: `node_modules/` 配下で **`@humation` 以外**は無変換、`@humation/*` だけ babel-jest（`babel-preset-expo`）で CJS にトランスパイル → `export` が解決される。
- `@humation/assets-humation-1` も `@humation/` 配下なので**この1パターンで両方カバー**。
- 既存の他 node_modules は従来どおり無変換のまま（影響なし）。
- `extensionsToTreatAsEsm` は**不要**（babel で CJS 化する方針のため。ESM ネイティブ実行はしない）。

### Metro（実機 / Expo Go）側
- SDK54 の Metro は **package `exports` フィールド対応**（`import` 条件を解決）かつ ESM を扱える。`@humation/*` は `exports."."` に `import: ./dist/index.js` を持ち、Metro はこれを解決可能。`"type":"module"` でも Metro は問題なし（SDK52+ で `package.json#exports` 既定有効）。
- **念のための保険**: 万一 Metro が exports 解決でつまずく場合、`metro.config.js` で `unstable_enablePackageExports: true` を明示。ただし**現状リポジトリに metro.config.js は無く、SDK54 既定で有効**なので**追加不要の見込み**（事実: 設定ファイル不在 → デフォルト動作）。
- **色焼き込みアダプタを `src/domain/avatar.ts` に置き node テストする**には、jest 側の whitelist が**必須**。Metro 側は実機描画のみで、テストには無関係。

---

## 4. react-native-svg `SvgXml`（v15.12.1）

- バージョン: `node_modules/react-native-svg/package.json` → **15.12.1**（設計記載どおり）。
- export: `SvgXml` は `node_modules/react-native-svg/src/xml.tsx` の `export declare function SvgXml(props: XmlProps)`（lib/typescript/xml.d.ts で確認）。package index `src/index.ts:3` が `export * from './ReactNativeSVG'` 経由で再 export。→ **`import { SvgXml } from 'react-native-svg'` で利用可**。
- props 型（lib/typescript/xml.d.ts）:
  ```ts
  type XmlProps = SvgProps & { xml: string | null } & AdditionalProps;
  type AdditionalProps = { onError?: (e:Error)=>void; override?: object; onLoad?: ()=>void; fallback?: JSX.Element };
  ```
  → `xml`（必須相当）、`width`/`height`（SvgProps 由来）、`onError`/`fallback`（フォールバックに使える）。
- **`var()` 非解決の確定根拠**: `lib/module/xml.js:158 getStyle()` は root の `style` 文字列を `;`/`:` split して `{ "--hmStroke": "#000000", ... }` にするだけ（`camelCase` で `--hm-stroke`→`--hmStroke` に変形すらする）。**子要素の `fill="var(--hm-*, ...)"` を root の custom property で解決する処理は存在しない**（`grep var(--` がヒットせず）。→ native では `fill` に `var(...)` 文字列がそのまま渡り、色が出ない/既定化する。**設計§2 の正規表現置換で `var()` を消すのが正しい唯一の対策**。

---

## 5. 現状アバター表示箇所（置換点の確定・file:line）

| 箇所 | file:line | 現状表現 | 置換方針 |
|------|----------|---------|---------|
| メンバー一覧の色丸 | `src/app/trip/[id]/members.tsx:39-44` | `<View style={[styles.swatch, {backgroundColor: member.color?.hex ?? theme.backgroundSelected}]} />`（`styles.swatch` = 36×36 円, L80） | `<MemberAvatar userId={uid} color={member.color} size={36} />` に置換。右の ColorChip/未配布(L54-60) は維持。 |
| プロフィール頭 | `src/app/(tabs)/profile.tsx:41-49` | `user.photoURL ? <Image .../> : <View>{user.displayName.slice(0,1)}</View>`（`styles.avatar` L104, `avatarText` L111） | `<MemberAvatar userId={user.uid} photoURL={user.photoURL} color={先頭配布色?} size={88} />`。photoURL 優先で既存挙動維持（R5）。 |
| トリップカード | `src/components/trip-card.tsx:21,36,54` | `myColor = trip.members[currentUserId]?.color`、左 `colorBar`(L36) + ColorChip(L54)。**画像アバター無し** | **余力枠**（設計どおり任意・別対応可）。 |
| ColorChip | `src/components/color-chip.tsx` 全体 | 色名ラベル責務 | **触らない**（対象外）。 |

- `AssignedColor` 定義: `src/domain/colors.ts:9-14`（`{ hex:string; name:string }`）。`color.hex` をそのまま `createAvatar` の `background`/`colors` に渡せる。
- `contrastTextColor`: `src/domain/colors.ts:46-51`（`#000000`|`#FFFFFF` を返す。リング/縁取り色決定に使える）。
- `COLOR_POOL` の hex は全て `#RRGGBB` 6桁（colors.ts:24-37）→ `createAvatar` の hex 入力要件と一致。

---

## 6. 依存追加の健全性

- **`@humation/core` の runtime deps = 0**（dependencies/peerDependencies ともに null。core/package.json:53 は devDeps の typescript のみ）。
- **`@humation/assets-humation-1` の deps = `@humation/core@1.0.1` のみ**、peer 無し（assets/package.json:70-72）。
- **芋づる依存は無い**（事実: feasibility install 後の `/tmp/humation-test/node_modules/` には `@humation/core` と `@humation/assets-humation-1` の2つだけ。他パッケージ0）。→ **headroom-ai のような巨大依存連鎖は発生しない**。健全。
- **バンドルサイズ目安（事実値）**:
  - `@humation/assets-humation-1` 全体: **1.7M**（うち `dist/embedded.js` = **714KB**＝SVG inline、`dist/manifest-json.js` = 67KB、`assets/` 配下に生 SVG 86枚 ≈ 残り）。
  - `@humation/core`: **116KB**（dist のみ）。
  - **実バンドルに乗るのは `humation1`（embedded.js 714KB）+ core**。`assets/*.svg`（生ファイル）と `manifest-json.js` は import しなければバンドルされない。→ **アプリバンドル増分の主因は embedded.js の ~714KB（圧縮前）**。設計 R3 のとおり Implementer が `npm ls`/`du` で記録すべき。

---

## 7. Implementer の落とし穴（リスク3件＋補足）

### リスク#1（最重要・確定）: `var()` 焼き込み漏れ → キャラ造形色が出ない
- **根拠**: `create-avatar.js:139-164` は fragment の `fill="var(--hm-*, #fallback)"` を**置換しない**（CSS cascade 前提）。`react-native-svg xml.js:158` は custom property を解決しない（§4）。
- **壊れ方**: `colors:{clothes:hex}` を渡しても native では fragment が fallback 白/黒のまま。**テストが root の `colors` マップだけ見て pass し、実機で色が出ない**罠。
- **対策（Implementer 必須）**: アダプタ出力に二段目の正規表現置換 `/var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g → $1` をかける。**かつテストで「最終 SVG 文字列に `var(` が 1 個も残らない」を assert**（`expect(svg).not.toContain('var('`)。root style の `--hm-*:#...` は `var(` を含まないので残ってよい）。
- **設計の補正点**: メンバー色を `background`（rect）に当てるルートは**最初から実 hex** なので R1 非該当 → **メンバー色だけなら置換不要でも色は出る**。だが `var()` 残留 SVG を react-native-svg に渡すと**パース警告やキャラ本体の黒/白化**が起きるので、**置換は造形色を当てない場合でも実施すべき**。

### リスク#2（確定）: jest ESM 解決漏れ → テストが起動時に SyntaxError
- **根拠**: `jest.config.js` に `transformIgnorePatterns` 無し（既定 `/node_modules/`）。`@humation/*` は ESM。現状 79 テストは node_modules ESM を一切 import していない（§3）。
- **壊れ方**: `src/domain/avatar.ts` が `@humation/*` を import した瞬間、**そのテストファイルだけでなく波及して落ちる**可能性。`transformIgnorePatterns` 修正を忘れると**既存 79 テストは無傷だが新規アバターテストが 0 件 pass**。
- **対策**: §3 の `transformIgnorePatterns: ['node_modules/(?!(?:@humation)/)']` を追加。修正後 `npm test` で**既存 79 + 新規**が緑になることを確認（既存 8 ファイルへの回帰がないことも併せて確認）。

### リスク#3（テスト手薄・実機固有）: SvgXml の RN 制約 / 巨大 assets / seed 偏り
- **テスト手薄箇所**: `member-avatar.tsx`（RN コンポーネント）は `testEnvironment:'node'` の現行 jest では**描画テストできない**（react-native-svg は native）。→ ロジック（SVG 生成・置換・seed 決定性・フォールバック分岐）は**全て `src/domain/avatar.ts` に寄せて node テスト**し、コンポーネント側は薄い try/catch ラッパに留めるのが安全。**コンポーネントの実描画は手動 / Expo Go 確認に依存**（自動テスト空白）。
- **SvgXml の RN 制約**: `var()` 残留 SVG / 不正 SVG を渡すと `onError` 経由 or サイレント失敗。**`onError`/`fallback` prop で必ず頭文字 or swatch に縮退**（UI を空にしない、設計§4 どおり）。
- **assets 巨大**: embedded.js 714KB（§6）。`import { humation1 }` は**モジュールトップで1回だけ**（コンポーネント内で都度 import しない）。
- **seed 偏り**: `createAvatar` の seed は `fnv1a(\`${seed}:${slotId}\`) % slotParts.length`（create-avatar.js:63-64）で 5 slot を独立選択。同 userId→同アバターは決定的（仕様どおり）。**メンバー間の見分けは背景色（メンバー配布色）で担保**されるので造形が似ても許容（設計 R4 受容と一致）。

### 補足（破壊しない確認）
- `MemberAvatar` は**新規追加コンポーネント**で既存 props 不変、`ColorChip`/`AssignedColor`/`contrastTextColor` の仕様変更なし（R5）。profile は photoURL 優先で既存写真挙動を維持。**DB スキーマ変更なし**。

---

## 8. 事実と推測の分離

**事実（file:line 付き）**:
- export は `humation1`（assets index.js:4）。color slot は manifest.json の colors[] で5+background。viewBox `-4 -4.5 88 88`（manifest.json crops）。
- `createAvatar` は fragment の `var()` を置換しない（create-avatar.js:139-164）。`var(--hm-KEY, #6桁大文字)` カンマ+スペース1個（embedded.js grep）。
- background は `<rect fill="#HEX">` 実 hex（create-avatar.js:109-111）。
- jest に transformIgnorePatterns 無し（jest.config.js）。`@humation/*` は ESM（両 package.json `"type":"module"`）。
- SvgXml export 済み・var 非解決（xml.tsx / xml.js:158）。
- humation deps は core 0 / assets→core のみ（両 package.json）。assets 1.7M（embedded.js 714KB）。

**推測（別欄・要 Implementer 検証）**:
- jest は「ほぼ確実に」SyntaxError で落ちる（静的調査での判断。実 import 未実行＝§タスク制約）。→ Implementer が install 後 `npm test` で初回確認すべき。
- Metro(SDK54) は metro.config.js 無しでも exports 解決できる「見込み」（SDK 既定が有効という一般事実に基づく推測。実機未検証）。→ 万一描画されなければ `unstable_enablePackageExports: true` を試す。
- `toString()` + 正規表現置換ルートが `toRenderData()` より実装が単純、という判断は推測（両方とも置換必要なのは事実）。
