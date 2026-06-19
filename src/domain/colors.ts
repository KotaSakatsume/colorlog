/**
 * 色プール（SPEC セクション6）
 *
 * - 見分けやすい12色。色相だけでなく明度でも差をつける。
 * - 色覚多様性対応として、各色に必ず日本語名ラベルを併記する。
 * - 配布・表示は常に「色 + 名前」のペアで扱う。
 */

export type AssignedColor = {
  /** 表示・塗りに使う 16進カラー (#RRGGBB) */
  hex: string;
  /** 画面に必ず併記する日本語名 */
  name: string;
};

/**
 * 配布に使う色プール。要素数 = メンバー上限（= 12）。
 * 1か所でだけ定義し、UI でもこの配列を参照する。
 *
 * SPEC §6 準拠の確定12色。色相を一周させつつ、近接色相は知覚輝度で離し、
 * 色覚多様性（赤緑・青黄混同）下でも名前ラベルと併せて判別できるように選定。
 * 配布順は意味論的な色相順（配布アルゴリズムは順序に非依存）。
 */
export const COLOR_POOL: readonly AssignedColor[] = [
  { hex: '#E63946', name: 'あか' },
  { hex: '#F3722C', name: 'だいだい' },
  { hex: '#FFD23F', name: 'きいろ' },
  { hex: '#A7C957', name: 'きみどり' },
  { hex: '#2A9D4A', name: 'みどり' },
  { hex: '#1D9A8D', name: 'あおみどり' },
  { hex: '#4CC9F0', name: 'みずいろ' },
  { hex: '#1D6FE0', name: 'あお' },
  { hex: '#3F3D9E', name: 'あいいろ' },
  { hex: '#8E44AD', name: 'むらさき' },
  { hex: '#F072B6', name: 'もも' },
  { hex: '#8B5E34', name: 'ちゃいろ' },
] as const;

/** メンバー上限（= 色プールの数）。SPEC: 12人。 */
export const MAX_MEMBERS = COLOR_POOL.length;

/**
 * 背景色 hex に対して読みやすい文字色（黒 or 白）を返す。
 * 相対輝度の簡易計算（sRGB の知覚輝度近似）で判定する。
 */
export function contrastTextColor(hex: string): '#000000' | '#FFFFFF' {
  const { r, g, b } = hexToRgb(hex);
  // 知覚輝度（0〜255）。明るい背景には黒、暗い背景には白。
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 150 ? '#000000' : '#FFFFFF';
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}
