/**
 * Humation アバター焼き込みアダプタの node テスト。
 *
 * 最重要回帰: 「最終 SVG に var( が 1 個も残らない」(リスク#1)。
 * react-native-svg は CSS custom property を解決しないため、var() 残留 =
 * 造形が黒/白に化ける罠。この assert がそれを検出する。
 */
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_SELECTION_SLOTS,
  bakeColorVars,
  buildMemberAvatarSvg,
  buildPartPreviewSvg,
  listPartsForSlot,
} from './avatar';

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

describe('buildMemberAvatarSvg（config 拡張・Issue #25）', () => {
  it('config 省略時は従来（config なし）と完全一致（後方互換）', () => {
    const withoutConfig = buildMemberAvatarSvg({ userId: 'compat', colorHex: '#1D6FE0' });
    const withEmptyConfig = buildMemberAvatarSvg({
      userId: 'compat',
      colorHex: '#1D6FE0',
      config: {},
    });
    const withUndefined = buildMemberAvatarSvg({
      userId: 'compat',
      colorHex: '#1D6FE0',
      config: undefined,
    });
    expect(withoutConfig).not.toBeNull();
    expect(withEmptyConfig).toBe(withoutConfig);
    expect(withUndefined).toBe(withoutConfig);
  });

  it('config.colors を渡すと SVG に反映され決定的（同入力→同出力）', () => {
    const base = buildMemberAvatarSvg({ userId: 'c-user', colorHex: '#A7C957' });
    const recolored = buildMemberAvatarSvg({
      userId: 'c-user',
      colorHex: '#A7C957',
      config: { colors: { hair: '#FF0000' } },
    });
    expect(recolored).not.toBeNull();
    // 色を変えれば出力も変わる（反映されている）。
    expect(recolored).not.toBe(base);
    // 焼き込んだ髪色 hex が最終 SVG に現れる。
    expect((recolored as string).toUpperCase()).toContain('#FF0000');
    // 決定的。
    const again = buildMemberAvatarSvg({
      userId: 'c-user',
      colorHex: '#A7C957',
      config: { colors: { hair: '#FF0000' } },
    });
    expect(again).toBe(recolored);
  });

  it('config.selections を渡すと造形が変わる（反映）', () => {
    const headParts = listPartsForSlot('head');
    const base = buildMemberAvatarSvg({ userId: 'sel-user' });
    // base と異なる head パーツを選ぶ。
    const candidate = headParts.find((p) => !(base as string).includes(p.id)) ?? headParts[0];
    const customized = buildMemberAvatarSvg({
      userId: 'sel-user',
      config: { selections: { head: candidate.id } },
    });
    expect(customized).not.toBeNull();
    expect(customized as string).not.toContain('var(');
  });

  it('config.selections は seed 既定と異なる SVG を生む（ゴール6 反映の担保）', () => {
    // profile/members の自分行は config={user.avatarConfig} を MemberAvatar に渡し、
    // 保存後に seed 既定と「見た目が変わる」ことで反映を体感させる。その差分を domain で固定する。
    const seedDefault = buildMemberAvatarSvg({ userId: 'goal6-user' });
    const headParts = listPartsForSlot('head');
    const distinctPart = headParts.find((p) => !(seedDefault as string).includes(p.id));
    expect(distinctPart).toBeDefined();
    const customized = buildMemberAvatarSvg({
      userId: 'goal6-user',
      config: { selections: { head: (distinctPart as { id: string }).id } },
    });
    expect(customized).not.toBeNull();
    expect(customized).not.toBe(seedDefault);
  });

  it('config.background を渡すと背景に焼き込まれ colorHex より優先される', () => {
    const svg = buildMemberAvatarSvg({
      userId: 'bg-user',
      colorHex: '#A7C957',
      config: { background: '#123456' },
    });
    expect(svg).not.toBeNull();
    expect((svg as string).toUpperCase()).toContain('#123456');
  });

  it('config 適用後も var( を一切残さない（リスク#1 回帰）', () => {
    const svg = buildMemberAvatarSvg({
      userId: 'risk1',
      colorHex: '#E63946',
      config: { colors: { hair: '#00FF00', skin: '#FFCC99' }, selections: { glasses: undefined } },
    });
    expect(svg).not.toBeNull();
    expect(svg as string).not.toContain('var(');
  });

  it('不正な slot/part キーを含む config でも throw せず null フォールバックする', () => {
    expect(() =>
      buildMemberAvatarSvg({
        userId: 'bad',
        config: { selections: { head: 'not-a-real-part-id-xxx' } },
      }),
    ).not.toThrow();
  });
});

describe('listPartsForSlot / buildPartPreviewSvg（ピッカー・Issue #25）', () => {
  it('item スロットは 43 パーツを返し各サムネに var( を残さない', () => {
    const parts = listPartsForSlot('item');
    expect(parts).toHaveLength(43);
    for (const part of parts) {
      expect(part.id).toBeTruthy();
      expect(part.name).toBeTruthy();
      expect(part.previewSvg).toContain('<svg');
      expect(part.previewSvg).not.toContain('var(');
    }
  });

  it('列挙は決定的（同入力→同 id 順）', () => {
    const a = listPartsForSlot('head').map((p) => p.id);
    const b = listPartsForSlot('head').map((p) => p.id);
    expect(a).toEqual(b);
  });

  it('colors を渡すとサムネに焼き込まれる', () => {
    const svg = buildPartPreviewSvg('head', listPartsForSlot('head')[0].id, {
      colors: { hair: '#FF0000' },
    });
    expect(svg).not.toBeNull();
    expect((svg as string).toUpperCase()).toContain('#FF0000');
    expect(svg as string).not.toContain('var(');
  });

  it('buildPartPreviewSvg は var( を残さない（焼き込み必須・リスク#3）', () => {
    const partId = listPartsForSlot('head')[0].id;
    const svg = buildPartPreviewSvg('head', partId);
    expect(svg).not.toBeNull();
    expect(svg as string).toContain('<svg');
    expect(svg as string).not.toContain('var(');
  });

  it('不正な slot は空配列・不正な part id は null（null 安全）', () => {
    expect(listPartsForSlot('no-such-slot-xxx')).toEqual([]);
    expect(buildPartPreviewSvg('head', 'no-such-part-xxx')).toBeNull();
  });

  it('bottom は表示に映らないため selection/color の編集 UI 双方から除外', () => {
    const selIds = AVATAR_SELECTION_SLOTS.map((s) => s.id);
    const colorIds = AVATAR_COLOR_SLOTS.map((s) => s.id);
    expect(selIds).not.toContain('bottom');
    expect(colorIds).not.toContain('bottom');
    // background は色オプションで別管理するため color スロット一覧に含めない。
    expect(colorIds).not.toContain('background');
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
