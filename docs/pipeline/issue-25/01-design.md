# 01 Architect — アバターのカスタマイズ

Issue: #25
Stage: 1/5 Architect

## 1. 方針サマリー（1行）

`AvatarConfig` 型を domain に新設し、`AuthUser.avatarConfig?` に持たせて既存 `updateProfile` で保存。`buildMemberAvatarSvg` は config（selections/colors）を `createAvatar` に渡すだけに拡張（`var(` 焼き込みは不変）、ピッカー用の純関数ラッパ 2 本を domain に足し、画面（`app/profile/avatar.tsx`）は domain/`MemberAvatar` 経由でのみ Humation を触る。members マップ反映は **follow-up（今回やらない）**。

## 2. AvatarConfig 型 と 保存先（確定事項）

### 2-1. 型（`src/domain/avatar.ts` に追加・全 optional / 部分上書き）

```ts
// SelectionSlotId / PartOptionId / ColorSlotId は @humation/core の型を re-export して使う。
// （domain でのみ humation を import する制約を守るため、画面に型を漏らすときは domain 経由 re-export）
export type AvatarConfig = {
  /** スロット→パーツ。未指定スロットは seed 由来のデフォルトに委ねる。 */
  selections?: Partial<Record<SelectionSlotId, PartOptionId>>;
  /** 色スロット→hex。未指定は createAvatar 既定（=配布色文脈の var fallback）。 */
  colors?: Partial<Record<ColorSlotId, string>>;
  /** 背景。未指定なら従来どおり配布色 / DEFAULT_BACKGROUND を使う。 */
  background?: string | 'transparent';
};
```

- `Partial<Record<...>>` で「部分上書き・全 optional」を表現。`{}` や `undefined` は完全に従来挙動と等価（後方互換の核）。
- `SelectionSlotId`/`PartOptionId`/`ColorSlotId` が string union か brand 型かは Investigator 確認事項（→ §9）。union 前提で `Partial<Record>` が成立するか要検証。

### 2-2. 保存先（確定）

- **正となる置き場 = `AuthUser.avatarConfig?: AvatarConfig`**。アバターはユーザーのグローバルな見た目なので trip ではなく user に属する。
- 保存経路 = 既存 `AuthService.updateProfile`。`ProfileUpdate`（更新 DTO 型・現状は displayName/photoURL 想定）に `avatarConfig?` を**追加**。Mock は in-memory で保持し既存 subscribe で `useCurrentUser` に反映。Firebase 実装は将来 users ドキュメント（本 Issue は Mock で完結・実機検証ゲートC後）。
- **members マップ反映 = follow-up（今回やらない）**。判断理由: trip の members は配布色・表示名中心の軽量スナップショット想定で、avatarConfig（selections/colors の入れ子）を全 member 行に焼くと書き込み経路・Mock/Firebase 双方の members 構造変更が必要＝ cheap でない。自分のアバターは `useCurrentUser` 経由で即反映でき Issue ゴール 6 を満たすため、他メンバー視点の反映は別 PR に切る（§7）。

## 3. avatar.ts 拡張

### 3-1. `buildMemberAvatarSvg` 拡張（後方互換）

```ts
export type BuildMemberAvatarSvgInput = {
  userId: string;
  colorHex?: string;
  config?: AvatarConfig;   // 追加・optional
};
```

- 実装: `createAvatar(humation1, { seed: userId, background: config?.background ?? colorHex ?? DEFAULT_BACKGROUND, selections: config?.selections, colors: config?.colors })` → `bakeColorVars(avatar.toString())`。
- **`bakeColorVars`（`var(` 焼き込み）は不変**。selections/colors を渡しても最終 SVG に `var(` を残さない。
- `config` 省略時は現行と完全一致（seed 決定的・配布色背景）。失敗時 `null` フォールバックも不変。
- `createAvatar` のオプション名が `selections`/`colors` で正しいか、未指定スロットを seed が埋めるかは Investigator 確認事項。

### 3-2. ピッカー用 domain ラッパ（純関数・node テスト可）

```ts
export type AvatarPart = { id: PartOptionId; previewSvg: string };

/** スロットの選択肢を列挙。createPartPreview のサムネ SVG を var() 焼き込み済みで返す。 */
export function listPartsForSlot(slot: SelectionSlotId, opts?: {
  colors?: Partial<Record<ColorSlotId, string>>;
  background?: string;
}): AvatarPart[];

/** 単一パーツのプレビュー SVG（焼き込み済み）。リスト外の単発描画用。 */
export function buildPartPreviewSvg(slot: SelectionSlotId, partId: PartOptionId, opts?: {
  colors?: Partial<Record<ColorSlotId, string>>;
  background?: string;
}): string | null;
```

- `getPartsForSlot`（列挙）+ `createPartPreview`（サムネ SVG 生成）の薄いラッパ。返す SVG は必ず `bakeColorVars` を通す（`createPartPreview` が var() を含むかは Investigator 確認・含まなければ no-op で安全）。
- `ColorSlotId`/`SelectionSlotId` 列挙の元（色パレット用スロット一覧）も domain 定数として公開する（例 `AVATAR_COLOR_SLOTS`/`AVATAR_SELECTION_SLOTS`）。画面が humation を import しないため。

## 4. MemberAvatar 拡張

```ts
type Props = { /* 既存はそのまま */ config?: AvatarConfig; };
```

- `useMemo` の生成呼び出しに `config` を渡し依存配列に追加（`[photoURL, userId, color?.hex, config]`／config は参照安定を呼び出し側で担保 or 中身を JSON 化して比較しない方針は Implementer 判断）。
- 既存呼び出し（config 無し）は一切変更不要。フォールバック 3 段（写真>SVG>頭文字）も維持。

## 5. カスタマイズ画面設計（`app/profile/avatar.tsx`）

- 遷移: プロフィール画面から「アバターを編集」で push（expo-router）。遷移構造は Investigator 確認（§9）。
- 画面構成:
  - 上部 = **ライブプレビュー**: `MemberAvatar` を大きく（例 size=160）+ `config={draft}` で即反映。`userId`=現ユーザー、`color`=配布色。
  - 中部 = **スロットタブ/セクション**: `AVATAR_SELECTION_SLOTS` を回し、各スロットで `listPartsForSlot(slot, { colors: draft.colors, background })` のサムネ一覧をグリッド表示・タップで `draft.selections[slot]` 更新。
  - 色 = `AVATAR_COLOR_SLOTS`（hair/skin/clothes/stroke/bottom）ごとにパレット（`COLOR_POOL` か専用パレット）を出し `draft.colors[slot]` 更新。
  - 下部 = **保存**（`updateProfile({ avatarConfig: draft })`）/ **リセット**（`draft = {}` で seed デフォルトへ）。
- 状態管理: ローカル `useState<AvatarConfig>(currentUser.avatarConfig ?? {})`。保存まで永続化しない。保存後は `useCurrentUser` subscribe で反映。
- **画面は @humation/core を import しない**（domain ラッパ + `MemberAvatar` のみ）。
- パフォ: サムネは selections × 86 parts を一度に全描画しない。表示中スロットのパーツのみ列挙描画（タブ単位の遅延 / 上限）。

## 6. 影響ファイル

新規:
- `app/profile/avatar.tsx`（編集画面）
- `src/domain/__tests__/avatar.*.test.ts`（config 適用・var 不残・決定性・パーツ列挙）

変更:
- `src/domain/avatar.ts`（`AvatarConfig` 型・`buildMemberAvatarSvg` 拡張・`listPartsForSlot`/`buildPartPreviewSvg`・スロット定数・型 re-export）
- `src/components/member-avatar.tsx`（`config?` prop）
- `AuthUser` 型 + `ProfileUpdate`/`updateProfile`（mock-auth-service.ts と interface）に `avatarConfig?` 追加
- プロフィール画面（編集画面への導線 1 行）

想定: domain 中規模・画面 1 枚新規・型拡張薄。後方互換のため既存呼び出し変更ゼロ。

## 7. やらないこと（3点）

1. **members マップへの avatarConfig 反映**（他メンバー視点のリアルタイム反映）— 書き込み経路・Mock/Firebase の members 構造変更が必要で cheap でない。別 PR。
2. **Firebase での avatarConfig 永続の実機検証** — ゲートC後。今回は Mock 完結。
3. **複数アセットパック / アバターアニメーション** — 単一 `humation1` 固定・静止 SVG のみ。

## 8. リスク

- `var(` 焼き込み漏れ: `createPartPreview` のサムネ SVG が var() を含む場合、`bakeColorVars` 未通過だと黒/白化け → ラッパで必ず通す。
- パーツ列挙の型: `SelectionSlotId`/`PartOptionId` が string union でなく brand 型だと `Partial<Record>` 不成立 → 型再設計が要る（§9 で先に確定）。
- サムネ多数描画のパフォ: 86 parts を全スロット同時に描くと Expo Go で重い → スロット単位の描画に絞る。
- `updateProfile`/`ProfileUpdate` 型拡張で既存破壊: `avatarConfig?` を optional で足す限り既存呼び出しは無傷。interface 実装漏れ（Mock 側）に注意。
- members 反映の有無: 今回 follow-up に切るため「他人のアバターは seed のまま」になる。Issue ゴールと矛盾しない旨を PR 説明に明記。

## 9. Investigator 確認事項

1. `getPartsForSlot` / `createPartPreview` / `getPartsForUiGroup` の正確なシグネチャ・引数・戻り値（特に `createPartPreview` が単パーツか合成か, 戻りが SVG 文字列か object か）。
2. `SelectionSlotId` / `PartOptionId` / `ColorSlotId` の実型（string union か brand か）→ `AvatarConfig` の `Partial<Record>` 可否を決定。
3. `createPartPreview` のサムネ SVG が `var(--hm-*, #hex)` を含むか（= `bakeColorVars` 焼き込み要否）。
4. `createAvatar` の `selections`/`colors` オプション名・形（slot→part の map か）、未指定スロットを seed が埋めるかの挙動。
5. `updateProfile` / `ProfileUpdate`（更新 DTO）と `AuthUser` の現状フィールドと interface 定義場所（`auth-service` interface と `mock-auth-service.ts`）。
6. プロフィール画面の遷移構造（expo-router のルート構成・どこから push するか）。
