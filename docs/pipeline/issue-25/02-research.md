# 02 Investigator — アバターのカスタマイズ

Issue: #25
Stage: 2/5 Investigator

調査対象リポジトリ: `/Users/kotasakatsume/colorlog/colorlog54`。すべて静的調査（`node -e` での型/出力確認は含むが、アプリ実行・テスト実行はしていない）。事実は `file:line` / 実物引用付き。推測は「推測」欄に分離。

---

## §9 確認事項への回答（先に結論）

| # | 確認事項 | 結論 |
|---|---------|------|
| 1 | helper シグネチャ・戻り値 | `getPartsForSlot(manifest, slotId): PartOption[]` / `createPartPreview(manifest, part, opts?): { toString(): string; toDataUri(): string }`。preview は **SVG 文字列**（object ラッパ経由）。単一パーツ描画。`getPartsForUiGroup(manifest, groupId): PartOption[]`。 |
| 2 | ID 型は union か brand か | **全て素の `string` エイリアス**（brand ではない）。`Partial<Record<SelectionSlotId, PartOptionId>>` は型・実行とも成立する。設計の型はそのまま採用可。 |
| 3 | preview に `var(` が残るか | **残る（要 `bakeColorVars`）**。`createPartPreview(...).toString()` 実出力に `var(--hm-*, #hex)` を確認。設計の「ラッパで必ず通す」は必須。 |
| 4 | `createAvatar` の `selections`/`colors` 名・形・seed 補完 | オプション名は `selections` / `colors`（`Record<slotId, partId/hex>`）で正しい。**部分指定 OK・未指定スロットは seed が埋める・未指定 color は manifest default**。実行確認済み。 |
| 5 | `updateProfile`/`ProfileUpdate`/`AuthUser` 現状と定義場所 | 定義 `src/repositories/types.ts:21-27`(AuthUser)/`:94`(ProfileUpdate)/`:97-108`(AuthService)。実装 2 箇所（Mock + Firebase）。`avatarConfig?` optional 追加で既存無傷。 |
| 6 | プロフィール画面の遷移構造 | `src/app/(tabs)/profile.tsx` → `router.push('/profile/edit')`。ルートは `src/app/_layout.tsx:20` の `Stack.Screen name="profile/edit"` で登録。新規 `avatar.tsx` は `app/profile/avatar.tsx` を置き、`_layout.tsx` に `Stack.Screen name="profile/avatar"` を 1 行追加。 |

---

## 1. 型の確定（最重要）

### 1-1. ID 型は brand ではなく素の `string`（=設計どおりで OK）

`node_modules/@humation/core/dist/types.d.ts:1-7`:

```ts
export type SelectionSlotId = string;
export type PartOptionId = string;
export type ColorSlotId = string;
export type LayerSlotId = string;
export type UiGroupId = string;
export type HexColor = string;
```

- brand 型（`string & { __brand }`）ではない。よって設計 §2-1 の `Partial<Record<SelectionSlotId, PartOptionId>>` / `Partial<Record<ColorSlotId, string>>` は **そのまま成立**。型再設計は不要。
- ただし「素の string union ですらない（=任意 string が代入可能）」。`AvatarConfig.selections` のキー/値はコンパイラ上の制約がほぼ無いので、不正キーはコンパイルで弾けない。安全性は domain 定数（`AVATAR_SELECTION_SLOTS` 等）を回す UI 設計で担保する（§3 参照）。

### 1-2. `CreateAvatarOptions`（`selections`/`colors`/`background` の正確な型）

`node_modules/@humation/core/dist/types.d.ts:113-131`:

```ts
export type CreateAvatarOptions = {
    seed?: string;
    selections?: Record<SelectionSlotId, PartOptionId | string>; // 部分指定OK・seedが残りを埋める
    colors?: Record<ColorSlotId, HexColor>;                      // 部分指定OK・# 有無どちらも可
    background?: HexColor | 'transparent';
    crop?: CropId;
};
```

- `selections` の値は `PartOptionId | string`。**canonical part id（`hm1-p-000005`）/ global alias / slot-scoped name（`{ head: 'braids' }`）いずれも受ける**（docコメント `types.d.ts:122-125`）。設計は part id を保存する前提なので canonical id 採用が安全。
- `selections` を `Record<...>`（非 Partial）として宣言しているが、**実行時は部分指定で問題なく動く**（下記実証）。`AvatarConfig` 側を `Partial<Record<...>>` にして `createAvatar` に渡しても TS は構造的に互換（`Partial` → `Record` 代入は TS では通る／必要なら `as` 不要）。

実証（部分 selections を渡し、未指定スロットは seed が補完される）:

```
$ createAvatar(humation1, { seed:'me', selections:{ head:'hm1-p-000005' } }).toJSON().selections
{"head":"hm1-p-000005","body":"hm1-p-000032","bottom":"hm1-p-000033","item":"hm1-p-000064","glasses":"hm1-p-000056"}

$ createAvatar(humation1, { seed:'me', colors:{ hair:'FF0000' } }).toJSON().colors
{"stroke":"000000","hair":"FF0000","skin":"FFFFFF","clothes":"FFFFFF","bottom":"000000"}

$ 同一 seed 2回 → selections 完全一致（決定的）: true
```

→ **§9-4 確定**: オプション名は `selections`/`colors` で正しい。slot→part / slot→hex の map。未指定スロットは seed、未指定 color は manifest default。`AvatarConfig = { selections?, colors?, background? }`（全 optional）は後方互換の核として妥当。

### 1-3. `AvatarConfig` の型設計（推奨）

設計 §2-1 のままで成立。re-export は `@humation/core` の index が型を出している（`index.d.ts:6` に `ColorSlotId, PartOptionId, SelectionSlotId` 等あり）ので domain で `export type { SelectionSlotId, PartOptionId, ColorSlotId } from '@humation/core'` が可能。

---

## 2. ピッカー用ヘルパのシグネチャ

`node_modules/@humation/core/dist/ui-helpers.d.ts:1-12`:

```ts
export type CreatePartPreviewOptions = {
    colors?: Record<ColorSlotId, HexColor>;
    background?: HexColor | 'transparent';
};
export declare function createPartPreview(
  manifest: HumationManifest, part: PartOption | PartOptionId, options?: CreatePartPreviewOptions
): { toString(): string; toDataUri(): string };
export declare function getPartsForSlot(manifest: HumationManifest, slotId: SelectionSlotId): PartOption[];
export declare function getPartsForUiGroup(manifest: HumationManifest, groupId: UiGroupId): PartOption[];
```

- **`createPartPreview` は単一パーツのプレビュー**（合成アバターではない）。`part` は `PartOption` オブジェクトでも `PartOptionId` 文字列でも可。戻りは `{ toString, toDataUri }` ラッパ（SvgXml に渡すのは `.toString()`）。
- `getPartsForSlot(manifest, slotId)` で各スロットのパーツ一覧（`PartOption[]`、deprecated 除外・id 昇順）が取れる（実装 `ui-helpers.js:46-55`）。part の id は `PartOption.id`、ラベルは `PartOption.name`（`types.d.ts:79-86`、全 head パーツで `name` 充足を確認: `fluffy-bob`/`round-bob`/...）。

### 2-1. `createPartPreview` は `var(` を含む → `bakeColorVars` 必須（§9-3 確定）

実装 `ui-helpers.js:8-12` は色を **root の `style="--hm-...:#hex"` として宣言**し、フラグメント内部は asset SVG 由来の `fill="var(--hm-hair, #000000)"` 形を**そのまま埋め込む**（`ui-helpers.js:18-26`、`fragment.svg` を `<svg>` 剥がして `<g>` でラップするのみ・var 置換なし）。

実測:

```
$ createPartPreview(humation1, headParts[0]).toString()
preview length: 11812, contains var(:  true
snippet: <svg ... style="--hm-bottom:#000000;...--hm-stroke:#000000"><g transform="translate(0, -0.5)"><path d="..." fill="var(--hm-...)">...
```

react-native-svg は CSS custom property を解決しないため、`var(` が残ると黒/白化けする（既存 `src/domain/avatar.ts:9-17` のコメントが同じ罠を記載）。**設計 §3-2 の「返す SVG は必ず `bakeColorVars` を通す」は必須**。既存 `bakeColorVars`（`avatar.ts:46-48`、正規表現 `HM_VAR_PATTERN` = `/var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g`）がそのまま再利用可能。root の `style="--hm-x:#hex"` は `var(` を含まないので誤爆しない（既存コメント `avatar.ts:35-36` に明記）。

注意: `createPartPreview` の `background` 既定は **`'transparent'`**（`ui-helpers.js:30-32`：`options.background === undefined ? 'transparent'`）で、`createAvatar`/manifest の `F6F5F4` 既定とは異なる。サムネは透過背景がグリッド上で自然なので、ラッパで background を明示しない設計で良い。

---

## 3. manifest（`humation1`）の実キー

`@humation/assets-humation-1` の主要 export は `humation1`（= 埋め込み済み manifest）。`dist/index.d.ts:1`:
`export { default, manifest as humation1, manifest } from './embedded.js';`

**重要**: 生 `manifest.json` は layer が `svgPath`（外部ファイル参照）で `svg` が空のため `createPartPreview` が空 SVG を返す。一方 `humation1`（embedded）は **86 layer すべてに inline `svg` を持つ**（実測: inline svg 86 / svgPath 86 が併存）。既存 `avatar.ts:19` も `import { humation1 } from '@humation/assets-humation-1'` を使っており、ラッパはこの `humation1` を渡すこと（生 manifest.json は使わない）。

### 3-1. selection slots（UI に並べる 5 スロット）

`manifest.selectionSlots`（id 昇順は manifest 順）:

| slot id | label | defaultPart | parts 数 |
|---------|-------|-------------|---------|
| `bottom` | Bottom | hm1-p-000033 | 8 |
| `body` | Body | hm1-p-000025 | 8 |
| `head` | Head | hm1-p-000001 | 24 |
| `item` | Item | hm1-p-000041 | 43 |
| `glasses` | Glasses | hm1-p-000056 | 3 |

合計 **86 parts**。`item` が 43 と突出（パフォ注意・§7 リスク）。

### 3-2. color slots（実 id）

`manifest.colors`（`ColorSlot[]`、`types.d.ts:37-43`）:

| color slot id | label | default | cssVariable | allowTransparent |
|---------------|-------|---------|-------------|-----------------|
| `background` | Background | F6F5F4 | --hm-background | true |
| `stroke` | Stroke | 000000 | --hm-stroke | – |
| `hair` | Hair | 000000 | --hm-hair | – |
| `skin` | Skin | FFFFFF | --hm-skin | – |
| `clothes` | Clothes | FFFFFF | --hm-clothes | – |
| `bottom` | Bottom | 000000 | --hm-bottom | – |

設計 §3-2 / §5 が挙げた `hair/skin/clothes/stroke/bottom` は実在。**注意 2 点**:
- (a) `background` も color slot として存在するが、配布色背景は `createAvatar` の `background` オプションで別経路管理（既存 `avatar.ts:58-62`）。`AVATAR_COLOR_SLOTS` には `background` を含めず hair/skin/clothes/stroke/bottom の 5 つにするのが既存挙動と整合。
- (b) `bottom` という id が **selection slot にも color slot にも存在する**（別空間）。`AVATAR_SELECTION_SLOTS` と `AVATAR_COLOR_SLOTS` を別定数として明確に分けること。混同すると `colors.bottom` と `selections.bottom` を取り違える。

### 3-3. UI groups（`getPartsForUiGroup`）

`manifest.uiGroups`（`types.d.ts:51-57`）は 5 グループで、各々 selectionSlot 1 個と 1:1 対応（bottom/body/head/item/glasses, order 1〜5）。本 Issue では **`getPartsForSlot(humation1, slotId)` で十分**（slot=group が 1:1 のため `getPartsForUiGroup` を使う必要はない）。設計は `AVATAR_SELECTION_SLOTS` を回す方針で、`getPartsForSlot` 採用が素直。

---

## 4. AuthService / AuthUser / ProfileUpdate 現状

### 4-1. 型定義（`src/repositories/types.ts`）

`AuthUser`（`types.ts:21-27`）:

```ts
export type AuthUser = {
  uid: string;
  displayName: string;
  photoURL?: string;
  isAnonymous: boolean;
};
```

`ProfileUpdate`（`types.ts:94`）:

```ts
export type ProfileUpdate = Partial<Pick<AuthUser, 'displayName' | 'photoURL'>>;
```

`AuthService.updateProfile`（`types.ts:99-100`）: `updateProfile(patch: ProfileUpdate): void;`

**差し込み**:
- `AuthUser` に `avatarConfig?: AvatarConfig` を追加（`types.ts:26` 付近）。
- `ProfileUpdate` を `Partial<Pick<AuthUser, 'displayName' | 'photoURL' | 'avatarConfig'>>` に拡張すれば、`Pick` 経由で自動的に `avatarConfig?` も拾える（型を 1 箇所変えるだけ）。
- `AvatarConfig` 型は domain（`src/domain/avatar.ts`）にあり、`types.ts` は `@/domain/avatar` から import する（既存 `types.ts:8-15` は `@/domain/types` を import済みなので循環に注意。`avatar.ts` は `repositories/types` を import していないので循環しない）。

### 4-2. Mock 実装（`src/repositories/mock/mock-auth-service.ts:31-44`）

```ts
updateProfile(patch: ProfileUpdate): void {
  const next: AuthUser = { ...this.user };
  const displayName = patch.displayName?.trim();
  if (displayName) next.displayName = displayName;
  if ('photoURL' in patch) next.photoURL = patch.photoURL || undefined;
  this.user = next;
  this.listeners.forEach((fn) => fn(this.user));
}
```

- **部分更新方式**: `{ ...this.user }` をベースに、渡されたキーだけ上書き。`avatarConfig` も `if ('avatarConfig' in patch) next.avatarConfig = patch.avatarConfig;` の 1 行で追加可能。
- **上書き/マージ**: 既存は完全上書き（マージしない）。設計 §5 は「保存時 `draft` 全体を渡す（`draft = currentUser.avatarConfig ?? {}` で初期化し編集）」なので、画面側で完全な config を組み立ててから渡す＝上書きで整合。avatarConfig 内部の部分マージは画面の `useState` が担う。
- subscribe（`mock-auth-service.ts:60-66`）が更新後 user を即流す → `useCurrentUser` で画面反映（設計 §5 と整合）。

### 4-3. Firebase 実装（`src/repositories/firebase/firebase-auth-service.ts:82-96`）も実装漏れに注意

`updateProfile` は Firebase Auth profile（displayName/photoURL）のみ更新（`firebase-auth-service.ts:93-94`）。`avatarConfig` は Firebase Auth profile に乗らない（users ドキュメント行き＝設計上 follow-up）。**今回 Firebase 側は `avatarConfig` を無視 or in-memory 保持**で良いが、`AuthService` interface に `avatarConfig` が乗る以上、Firebase 実装が型エラーにならないこと（patch を受けて捨てるだけ）を確認すること。`mapFirebaseUserToAuthUser`（`firebase-auth-service.ts:37-45`）は `avatarConfig` を埋めない→ `AuthUser.avatarConfig` が optional なら型 OK。

### 4-4. ProfileUpdate 利用箇所（全件）

- `src/app/profile/edit.tsx:47`: `auth.updateProfile({ displayName: name, photoURL })`。
- `src/repositories/mock/mock-auth-service.test.ts:26,73,89`: displayName のみのテスト（avatarConfig 追加で非回帰）。
- `use-color-scheme` は **ProfileUpdate と無関係**（調査の結果ヒットせず。`use-color-scheme.web.ts:24` の "hydration" 文言が grep に混ざっただけ）。

---

## 5. プロフィール画面の遷移構造

### 5-1. 既存遷移

- `src/app/(tabs)/profile.tsx`（プロフィールタブ）: `router.push('/profile/edit')`（`profile.tsx` 内 `UIButton onPress`）。`MemberAvatar` を `size={88}` で表示中（ここに「アバターを編集」導線を 1 つ足す）。
- `src/app/profile/edit.tsx`: 編集画面。`router.back()` で戻る（`edit.tsx:48`）。`useCurrentUser`/`useRepositories`（`@/repositories/context`）から auth を取得し `auth.updateProfile` を呼ぶ（`edit.tsx:18,47`）。

### 5-2. ルート登録（expo-router）

`src/app/_layout.tsx:20`:

```tsx
<Stack.Screen name="profile/edit" options={{ title: 'プロフィール編集', presentation: 'modal' }} />
```

→ ファイルベースルーティング。**新規 `src/app/profile/avatar.tsx` を作り、`_layout.tsx` に 1 行追加**:

```tsx
<Stack.Screen name="profile/avatar" options={{ title: 'アバターを編集' /* presentation: 'modal' は任意 */ }} />
```

遷移は `router.push('/profile/avatar')`。導線は `profile.tsx` の「プロフィールを編集」ボタン付近（avatar 直下）に「アバターを編集」を追加するのが自然。画面内構成・state は設計 §5 のまま実装可。

---

## 6. 現状 avatar.ts / member-avatar.tsx と差し込み点

### 6-1. `buildMemberAvatarSvg` の現シグネチャ（`src/domain/avatar.ts:25-66`）

```ts
export type BuildMemberAvatarSvgInput = {
  userId: string;
  colorHex?: string;
};
export function buildMemberAvatarSvg(input: BuildMemberAvatarSvgInput): string | null {
  try {
    const background = input.colorHex ?? DEFAULT_BACKGROUND;   // DEFAULT_BACKGROUND = '#E9E8E6' (avatar.ts:42)
    const avatar = createAvatar(humation1, { seed: input.userId, background });
    return bakeColorVars(avatar.toString());
  } catch { return null; }
}
```

差し込み（設計 §3-1）: `Input` に `config?: AvatarConfig` を足し、`createAvatar` に `selections: config?.selections, colors: config?.colors`、`background: config?.background ?? input.colorHex ?? DEFAULT_BACKGROUND` を渡すだけ。`bakeColorVars` は不変。`config` 省略時は現行と完全一致（`selections: undefined` は createAvatar が seed 補完）。

### 6-2. `MemberAvatar` の config 受け渡し（`src/components/member-avatar.tsx:47-50`）

```ts
const svg = useMemo(
  () => (photoURL ? null : buildMemberAvatarSvg({ userId, colorHex: color?.hex })),
  [photoURL, userId, color?.hex],
);
```

差し込み（設計 §4）: `buildMemberAvatarSvg({ userId, colorHex: color?.hex, config })` にし、依存配列に `config` を足す。**`Props` に `config?: AvatarConfig` 追加**（`member-avatar.tsx:26-38`）。既存呼び出し（`profile.tsx`/その他 MemberAvatar 利用箇所）は config 無しなので無変更。

### 6-3. ライブプレビュー画面での利用

設計 §5 のとおり `<MemberAvatar userId={user.uid} color={...} size={160} config={draft} />`。`MemberAvatar` は `photoURL` があると SVG を描かない（`member-avatar.tsx:59-65`）ので、プレビューでは `photoURL` を渡さないこと（写真設定済みでもアバター編集はできる必要がある）。

---

## 7. Implementer の落とし穴（リスク 3 件以上）

### リスク 1【最重要・パフォ】`item` スロット 43 パーツ + var 焼き込み済み 11.8KB/枚の同時描画

- 事実: `getPartsForSlot(humation1,'item')` は **43 件**（manifest 実測）。`createPartPreview(...).toString()` は **1 枚 ≈ 11.8KB の SVG 文字列**（head パーツ実測 11812 字）。`bakeColorVars` の正規表現置換も 43 回。
- 壊しうる点: 設計 §5 末尾の「表示中スロットのパーツのみ列挙描画」を守らず全 86 枚を一度に `SvgXml` で描くと Expo Go で確実に重い/フリーズ。さらに `listPartsForSlot` を `useMemo` で囲わず毎レンダー再計算すると 43×置換が毎フレーム走る。
- 対策: スロット単位の遅延描画（タブ切替時のみ生成）+ `listPartsForSlot` 結果を slot/colors 依存で `useMemo` 化。`createPartPreview` の戻りは `.toDataUri()` も使えるが、既存は `SvgXml` 経路なので `.toString()` + `bakeColorVars` で統一。

### リスク 2【型の罠だが §9-2 で回避済み】`avatarConfig` の型が画面に humation を漏らす / `ProfileUpdate` 拡張の循環 import

- 事実: 設計は「画面は @humation/core を import しない」(§5)。`AvatarConfig` は domain（`avatar.ts`）に置き、`repositories/types.ts` がそれを import する（`types.ts:8-15` は既に `@/domain/types` を import）。
- 落とし穴: `src/domain/avatar.ts` が `@/repositories/types` を import すると循環。現状 `avatar.ts` は repositories を import していない（`avatar.ts:18-19` は humation のみ）ので **`types.ts → avatar.ts` の一方向に保つ**こと。逆向き import を足さない。
- ID 型 re-export: `string` 素エイリアスなので `Partial<Record>` は成立（§1-1）。brand 型による Record 不成立リスクは **無い**（設計 §8 の懸念は解消）。ただし型がゆるいぶん、不正な slot キーをコンパイルで弾けない＝ UI を `AVATAR_SELECTION_SLOTS`/`AVATAR_COLOR_SLOTS` 定数で駆動して実行時の正しさを担保する。

### リスク 3【テスト手薄・非回帰】`bakeColorVars` 焼き込み漏れ と Mock/Firebase 二重実装の片肺

- 事実: 既存テストは `src/domain/avatar.test.ts` の 1 ファイルのみ（`buildMemberAvatarSvg`/`bakeColorVars` 系。現状 jest 88 件はここ等に含まれる）。`createPartPreview` 経路（新規 `listPartsForSlot`/`buildPartPreviewSvg`）の var 不残テストは **存在しない**＝新規で必須。`createPartPreview` 出力に `var(` が残ることを実測済み（§2-1）なので、ラッパが通し忘れると黒/白化けが起きるがユニットテストが無いと検出できない。
- もう 1 つ: `updateProfile` の実装が Mock(`mock-auth-service.ts:31`)・Firebase(`firebase-auth-service.ts:82`)の **2 箇所**。interface に `avatarConfig` を足したら両方の実装が型整合する必要。Mock だけ直して Firebase を放置すると Firebase 実装が `AuthService` を満たさず tsc が落ちる（Firebase は patch を受けて捨てる/無視で良いが、型上は受理する形にする）。
- 対策: 新規テスト（`src/domain/__tests__/avatar.*.test.ts` 設計 §6）で (a) config 適用後の SVG に `var(` が残らない、(b) `listPartsForSlot('item')` が 43 件返る/決定的、(c) part preview が `var(` 不残 を必ず入れる。`mock-auth-service.test.ts` に avatarConfig 保存・subscribe 通知の非回帰ケースを 1 本追加。

### 補足リスク【影響軽微】jest moduleNameMapper は **追加不要**

- 事実: `jest.config.js:22-24` は **バレル指定子** `^@humation/core$` / `^@humation/assets-humation-1$` を dist エントリへマップ。新規 import（`createPartPreview`/`getPartsForSlot`/`getPartsForUiGroup`）は同じ `@humation/core` 指定子からの **named import** なので、既存マッパでそのまま解決される。`transformIgnorePatterns: ['node_modules/(?!(?:@humation)/)']`（`jest.config.js:16`）も @humation 全体を babel 変換対象にしているので変更不要。**moduleNameMapper の調整は不要**（設計 §7 の懸念は実機 import 名追加では発生しない）。

---

## 8. 既存テストの状況

- avatar 系の唯一のテスト: `src/domain/avatar.test.ts`（`buildMemberAvatarSvg`/`bakeColorVars`/seed 決定性）。`createPartPreview`/ピッカー列挙の経路はカバレッジ皆無 → 新規 §6 テストで埋める。
- auth: `src/repositories/mock/mock-auth-service.test.ts`（displayName 更新・subscribe 通知の非回帰あり、`:68` に「既存挙動・非回帰」ケース）。avatarConfig 保存の非回帰ケースをここに追加するのが自然。
- 画面（`avatar.tsx`）は jest 対象外（`testEnvironment: node`、RN コンポーネントテスト基盤なし）＝ロジックは全て domain 純関数に寄せてテストする設計 §3-2 が正しい。

---

## 推測（事実と分離）

- （推測）`AvatarConfig.selections` のキー/値は型がゆるい（素 string）ので、保存済み config に存在しない part id が入っても `createAvatar` は alias 解決を試み、解決不能なら throw する可能性がある → `buildMemberAvatarSvg` の `try/catch`（`avatar.ts:64`）が握って `null` フォールバックするはずだが、ピッカー直叩きの `buildPartPreviewSvg` 側も同様の `try/catch`/`null` フォールバックを入れておくと安全（根拠: `createPartPreview` は未知 id で `throw new Error('Unknown part')` する＝`ui-helpers.js:6-7`、これは事実。null 化が要るという判断が推測）。
- （推測）`presentation: 'modal'` を avatar 画面にも付けるかは UX 判断。edit が modal なので揃えると一貫するが、アバター編集はグリッド操作が多くフルスクリーン push の方が操作しやすい可能性。Architect/Implementer 判断。
- （推測）`config` の参照安定性（設計 §4 が Implementer 判断に委ねた点）: `useState<AvatarConfig>` の draft はタップ毎に新オブジェクトになるので `MemberAvatar` の `useMemo` 依存に生 `config` を入れると毎回再生成される。プレビューは再生成されてよい（むしろ即時反映が要件）ので問題にならない、というのが妥当。リストのサムネ側は `colors` のみ依存にして part 切替で再生成しないのが軽い。
