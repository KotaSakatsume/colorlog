/**
 * Humation アバター焼き込みアダプタの node テスト。
 *
 * 最重要回帰: 「最終 SVG に var( が 1 個も残らない」(リスク#1)。
 * react-native-svg は CSS custom property を解決しないため、var() 残留 =
 * 造形が黒/白に化ける罠。この assert がそれを検出する。
 */
import { bakeColorVars, buildMemberAvatarSvg } from './avatar';

describe('buildMemberAvatarSvg', () => {
  it('最終 SVG に var( を一切残さない（リスク#1 回帰）', () => {
    const svg = buildMemberAvatarSvg({ userId: 'user-1', colorHex: '#E63946' });
    expect(svg).not.toBeNull();
    expect(svg as string).not.toContain('var(');
  });

  it('同一 seed なら同一 SVG（決定的）', () => {
    const a = buildMemberAvatarSvg({ userId: 'same-seed', colorHex: '#1D6FE0' });
    const b = buildMemberAvatarSvg({ userId: 'same-seed', colorHex: '#1D6FE0' });
    expect(a).toBe(b);
  });

  it('seed が違えば SVG も変わる（識別性）', () => {
    const a = buildMemberAvatarSvg({ userId: 'seed-a', colorHex: '#E63946' });
    const b = buildMemberAvatarSvg({ userId: 'seed-b', colorHex: '#E63946' });
    expect(a).not.toBe(b);
  });

  it('背景に配布色 hex が焼き込まれる', () => {
    const svg = buildMemberAvatarSvg({ userId: 'user-2', colorHex: '#A7C957' });
    expect(svg).not.toBeNull();
    // background は <rect fill="#HEX"> として実 hex 直書き（大文字 6 桁に正規化）。
    expect((svg as string).toUpperCase()).toContain('#A7C957');
  });

  it('colorHex 未指定でも壊れず SVG を返す（未配布メンバー）', () => {
    const svg = buildMemberAvatarSvg({ userId: 'user-no-color' });
    expect(svg).not.toBeNull();
    expect(svg as string).toContain('<svg');
    expect(svg as string).not.toContain('var(');
  });

  it('不正入力（空 userId）でも throw せず生成を試みる', () => {
    expect(() => buildMemberAvatarSvg({ userId: '' })).not.toThrow();
  });
});

describe('bakeColorVars', () => {
  it('var(--hm-KEY, #HEX) を fallback hex に置換する', () => {
    const input = '<path fill="var(--hm-stroke, #000000)" stroke="var(--hm-hair, #1A2B3C)" />';
    expect(bakeColorVars(input)).toBe('<path fill="#000000" stroke="#1A2B3C" />');
  });

  it('var( を含まない文字列はそのまま返す（root style 誤爆なし）', () => {
    const input = '<svg style="--hm-bottom:#000000;--hm-clothes:#FFFFFF;">';
    expect(bakeColorVars(input)).toBe(input);
  });

  it('カンマ後のスペース有無どちらも吸収する', () => {
    expect(bakeColorVars('fill="var(--hm-skin,#ABCDEF)"')).toBe('fill="#ABCDEF"');
    expect(bakeColorVars('fill="var(--hm-skin, #ABCDEF)"')).toBe('fill="#ABCDEF"');
  });
});
