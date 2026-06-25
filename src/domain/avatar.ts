/**
 * Humation アバターの SVG 焼き込みアダプタ（純関数・node テスト可）。
 *
 * `@humation/core` は純 JS（runtime deps 0）なので domain 層で直接 import できる。
 * 画面側（member-avatar.tsx）はこのアダプタが返す SVG 文字列を `react-native-svg`
 * の `SvgXml` に渡すだけ。色の決定・置換ロジックは全てここに寄せ、node 上で
 * jest によりテストする。
 *
 * ## 色焼き込みの二段構え（Issue #23 リスク#1 対策）
 * 1. `createAvatar` の `background`/`colors` オプションで正規ルートを通す。
 *    背景（メンバー配布色）は `<rect fill="#HEX">` として実 hex で出力される。
 * 2. それでもキャラ造形パーツは `fill="var(--hm-KEY, #fallback)"` の形で SVG に
 *    残る（createAvatar は CSS cascade 前提で var() を置換しない）。
 *    react-native-svg は CSS custom property を解決しないため、最終 SVG に var() が
 *    残ると造形が黒/白に化ける。よって最終出力の `var(--hm-*, #hex)` を fallback hex
 *    に正規表現で置換し、SVG に `var(` を一切残さない。
 */
import { createAvatar, createPartPreview, getPartsForSlot } from '@humation/core';
import { humation1 } from '@humation/assets-humation-1';

// ID 型は @humation/core では素の string エイリアス（brand ではない）。
// domain でのみ humation を import する制約を守るため、画面/型へ漏らすときは
// ここから re-export して使う（Investigator §1-3）。
export type { SelectionSlotId, PartOptionId, ColorSlotId } from '@humation/core';
import type { SelectionSlotId, PartOptionId, ColorSlotId } from '@humation/core';

/**
 * ユーザーが選んだアバターの見た目（全 optional・部分上書き）。
 *
 * - `selections`: 造形スロット→パーツ。未指定スロットは seed 由来のデフォルトに委ねる。
 * - `colors`: 色スロット→hex。未指定は createAvatar 既定（manifest default）。
 * - `background`: 背景。未指定なら従来どおり配布色 / DEFAULT_BACKGROUND を使う。
 *
 * `{}` や `undefined` は完全に従来挙動と等価（後方互換の核）。ID 型は素 string
 * なのでコンパイラでキーを縛れない。UI 側は下記 `AVATAR_*_SLOTS` 定数を回して
 * 不正キーの混入を実行時に防ぐ（Investigator §1-1 / リスク2）。
 */
export type AvatarConfig = {
  selections?: Partial<Record<SelectionSlotId, PartOptionId>>;
  colors?: Partial<Record<ColorSlotId, string>>;
  background?: string;
};

/**
 * UI に並べる造形スロット（manifest.selectionSlots 順）。
 * 画面が @humation を import せずスロットを駆動するための domain 定数。
 * `bottom`（造形・色とも）は表示上映らないため編集 UI からは除外している。
 * 未指定スロットは createAvatar が seed/manifest 既定で補完する。
 */
export const AVATAR_SELECTION_SLOTS: readonly { id: SelectionSlotId; label: string }[] = [
  { id: 'body', label: 'からだ' },
  { id: 'head', label: 'あたま' },
  { id: 'item', label: 'アイテム' },
  { id: 'glasses', label: 'メガネ' },
] as const;

/**
 * UI に並べる色スロット（hair/skin/clothes/stroke の 4 つ）。
 * `background` は色スロットとして manifest に存在するが、背景は createAvatar の
 * `background` オプションで別経路管理するため、ここには含めない（既存挙動と整合）。
 * `bottom`（ボトム色）は表示上映らないため編集 UI からは除外している。
 */
export const AVATAR_COLOR_SLOTS: readonly { id: ColorSlotId; label: string }[] = [
  { id: 'hair', label: '髪' },
  { id: 'skin', label: '肌' },
  { id: 'clothes', label: '服' },
  { id: 'stroke', label: '線' },
] as const;

/**
 * `var(--hm-KEY, #HEX)` を fallback hex（または `colors` で上書きされた実 hex）に潰す。
 *
 * 実出力パターン（Investigator 確認）: `var(--hm-` + lowercase slot 名 +
 * `, ` (カンマ+半角スペース) + `#` + hex。`\s*` で空白の揺れを吸収し、`{3,8}` で
 * 3/4/6/8 桁いずれの hex も拾う。root の `style="--hm-bottom:#000000;..."` は
 * `var(` を含まないので誤爆しない。`fill=` だけでなく `stroke=` 属性にも出るが、
 * 全文一括置換で問題ない。
 */
const HM_VAR_PATTERN = /var\(\s*--hm-[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8})\s*\)/g;

/**
 * 部分マップ（`Partial<Record<K, V>>`）を humation の `Record<K, V>` 引数へ橋渡しする。
 *
 * `AvatarConfig` は全 optional のため値型が `V | undefined` になり、humation の
 * `CreateAvatarOptions.selections/colors`（非 Partial の `Record`）へ直接渡すと
 * strict 下で代入不能になる。humation 実装は部分マップ・undefined 値を無害に扱う
 * （未指定スロットは seed/manifest 既定で補完）ため、undefined エントリを除いた
 * `Record` に整形して境界の型を合わせる。
 */
function toHumationRecord(
  map: Partial<Record<string, string>> | undefined,
): Record<string, string> | undefined {
  if (!map) return undefined;
  const out: Record<string, string> = {};
  for (const key of Object.keys(map)) {
    const value = map[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export type BuildMemberAvatarSvgInput = {
  /** 決定的シード。同一 userId → 同一造形（fnv1a）。 */
  userId: string;
  /** メンバー配布色 hex（#RRGGBB）。背景に焼き込む。未配布なら省略。 */
  colorHex?: string;
  /** ユーザーが選んだ見た目（selections/colors/background）。省略時は seed 既定。 */
  config?: AvatarConfig;
};

/** 未配布（colorHex 省略）時に背景へ当てる無彩のデフォルト。 */
const DEFAULT_BACKGROUND = '#E9E8E6';

/**
 * SVG 文字列内に残る `var(--hm-*, #hex)` を fallback hex に置換する。
 * react-native-svg が var() を解決しない罠（リスク#1）を確実に潰すための後段処理。
 */
export function bakeColorVars(svg: string): string {
  return svg.replace(HM_VAR_PATTERN, '$1');
}

/**
 * userId をシードに Humation アバターを生成し、配布色を背景に焼き込んだ SVG 文字列を返す。
 *
 * 生成に失敗した場合は throw せず `null` を返し、呼び出し側（MemberAvatar）が
 * 頭文字/色 swatch へフォールバックできるようにする。
 */
export function buildMemberAvatarSvg(input: BuildMemberAvatarSvgInput): string | null {
  try {
    const { config } = input;
    // 背景の優先順位: config.background > 配布色 > 無彩デフォルト。
    // selections/colors を渡しても未指定スロットは createAvatar が seed/manifest で補完する。
    const background = config?.background ?? input.colorHex ?? DEFAULT_BACKGROUND;
    const avatar = createAvatar(humation1, {
      seed: input.userId,
      background,
      selections: toHumationRecord(config?.selections),
      colors: toHumationRecord(config?.colors),
    });
    return bakeColorVars(avatar.toString());
  } catch {
    return null;
  }
}

/** ピッカー用パーツ。`previewSvg` は var( 焼き込み済み（SvgXml にそのまま渡せる）。 */
export type AvatarPart = {
  id: PartOptionId;
  /** ラベル（manifest の part.name。グリッドの a11y / キャプション用）。 */
  name: string;
  previewSvg: string;
};

/** ピッカー用プレビュー生成オプション（色を当てたサムネを出すため）。 */
export type AvatarPreviewOptions = {
  colors?: Partial<Record<ColorSlotId, string>>;
  background?: string;
};

/**
 * 造形スロットの選択肢を列挙し、各パーツのサムネ SVG（var( 焼き込み済み）を返す。
 *
 * `createPartPreview` の出力は `var(--hm-*, #hex)` を含む（Investigator §2-1）ので
 * 必ず `bakeColorVars` を通す（react-native-svg は var() を解決せず黒/白化けする）。
 * 不正 slot で `getPartsForSlot` が空配列を返すケースは自然に空配列になる。
 * 個別パーツの生成失敗（未知 id 等）は握って当該パーツだけ除外する。
 */
export function listPartsForSlot(
  slot: SelectionSlotId,
  opts?: AvatarPreviewOptions,
): AvatarPart[] {
  let parts;
  try {
    parts = getPartsForSlot(humation1, slot);
  } catch {
    return [];
  }
  const result: AvatarPart[] = [];
  for (const part of parts) {
    try {
      const preview = createPartPreview(humation1, part, {
        colors: toHumationRecord(opts?.colors),
        background: opts?.background,
      });
      result.push({
        id: part.id,
        name: part.name ?? part.id,
        previewSvg: bakeColorVars(preview.toString()),
      });
    } catch {
      // 単一パーツの描画失敗はサイレントに除外（リスト全体は壊さない）。
    }
  }
  return result;
}

/**
 * 単一パーツのプレビュー SVG（var( 焼き込み済み）。リスト外の単発描画用。
 * 未知 part id 等で `createPartPreview` が throw した場合は `null` を返す。
 */
export function buildPartPreviewSvg(
  slot: SelectionSlotId,
  partId: PartOptionId,
  opts?: AvatarPreviewOptions,
): string | null {
  // slot は createPartPreview の引数ではないが、API の対称性と将来の検証余地のため受ける。
  void slot;
  try {
    const preview = createPartPreview(humation1, partId, {
      colors: toHumationRecord(opts?.colors),
      background: opts?.background,
    });
    return bakeColorVars(preview.toString());
  } catch {
    return null;
  }
}
