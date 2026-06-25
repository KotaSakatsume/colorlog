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
import { createAvatar } from '@humation/core';
import { humation1 } from '@humation/assets-humation-1';

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

export type BuildMemberAvatarSvgInput = {
  /** 決定的シード。同一 userId → 同一造形（fnv1a）。 */
  userId: string;
  /** メンバー配布色 hex（#RRGGBB）。背景に焼き込む。未配布なら省略。 */
  colorHex?: string;
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
    const background = input.colorHex ?? DEFAULT_BACKGROUND;
    const avatar = createAvatar(humation1, {
      seed: input.userId,
      background,
    });
    return bakeColorVars(avatar.toString());
  } catch {
    return null;
  }
}
