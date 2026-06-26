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
  inlineStyleClasses,
  listPartsForSlot,
} from './avatar';

/** SVG 文字列から fill/stroke 属性に現れる実 hex 色を集める（none は除外）。 */
function fillStrokeHexes(svg: string): string[] {
  const out = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8})"/g)) out.add(m[1].toLowerCase());
  return [...out];
}

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
    // 焼き込んだ髪色 hex が「実際の塗り属性」に載る（color 反映バグ回帰）。
    // root の style="--hm-hair:#FF0000" に現れるだけでは react-native-svg は描画しない。
    // 必ず fill=/stroke= 属性として焼き込まれていること（自前カスケード解決の担保）。
    expect(/(?:fill|stroke)="#FF0000"/i.test(recolored as string)).toBe(true);
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

  it('UI から外した bottom 値も config 経由なら生成に反映される（後方互換の核・Issue #27）', () => {
    // bottom は編集 UI（AVATAR_*_SLOTS）から除外したが、既存ユーザーの avatarConfig に
    // 保存済みの bottom 選択/色は buildMemberAvatarSvg に渡り続けねばならない。定数から
    // bottom が消えたことで「未使用キー」と誤認し toHumationRecord 等で弾く最適化が将来
    // 入るとサイレントに後方互換が壊れるため、ここで反映を固定する。
    const base = buildMemberAvatarSvg({ userId: 'compat-bottom' });
    const withBottomColor = buildMemberAvatarSvg({
      userId: 'compat-bottom',
      config: { colors: { bottom: '#FF00AA' } },
    });
    expect(withBottomColor).not.toBeNull();
    // 保存済みボトム色が最終 SVG に焼き込まれる（表示上は見えなくても生成には載る）。
    expect((withBottomColor as string).toUpperCase()).toContain('#FF00AA');
    expect(withBottomColor).not.toBe(base);
    // 造形側（selections.bottom）も同様に反映される。
    const bottomParts = listPartsForSlot('bottom');
    const altBottom = bottomParts.find((p) => !(base as string).includes(p.id)) ?? bottomParts[0];
    const withBottomSelection = buildMemberAvatarSvg({
      userId: 'compat-bottom',
      config: { selections: { bottom: altBottom.id } },
    });
    expect(withBottomSelection).not.toBeNull();
    expect(withBottomSelection).not.toBe(base);
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

  it('item サムネに <style> クラス塗りが残らない（シルエット化バグ回帰）', () => {
    // hm1-p-000070〜 は Illustrator 書き出しで <style>.stN{fill:#…} + class="stN"。
    // react-native-svg は <style> の CSS クラスを解決しないため、未処理だと全パスが
    // 既定の黒＝シルエットに化ける。インライン化で <style> が残らないことを固定する。
    for (const part of listPartsForSlot('item')) {
      expect(part.previewSvg).not.toContain('<style');
    }
  });

  it('以前シルエット化していた item パーツに実色の塗りが載る（バグ修正の核）', () => {
    // takoyaki(hm1-p-000073) は <style> クラス塗りのみで、未修正では fill 実色が 0 個
    // ＝黒一色のシルエット。インライン化後は複数の実色 fill/stroke を持つ。
    const takoyaki = listPartsForSlot('item').find((p) => p.id === 'hm1-p-000073');
    expect(takoyaki).toBeDefined();
    const hexes = fillStrokeHexes((takoyaki as { previewSvg: string }).previewSvg);
    // 黒(#000000)以外の実色が最低 1 つは載る（シルエットでない）。
    expect(hexes.some((h) => h !== '#000000')).toBe(true);
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

  it('色編集 UI は hair/clothes のみ（skin/stroke は除外）', () => {
    const colorIds = AVATAR_COLOR_SLOTS.map((s) => s.id);
    expect(colorIds).toEqual(['hair', 'clothes']);
    expect(colorIds).not.toContain('skin');
    expect(colorIds).not.toContain('stroke');
  });
});

describe('bakeColorVars', () => {
  it('var(--hm-KEY, #HEX) を fallback hex に置換する', () => {
    const input = '<path fill="var(--hm-stroke, #000000)" stroke="var(--hm-hair, #1A2B3C)" />';
    expect(bakeColorVars(input)).toBe('<path fill="#000000" stroke="#1A2B3C" />');
  });

  it('var( を含まない文字列はそのまま返す（root style 誤爆なし）', () => {
    const input = '<svg style="--hm-clothes:#000000;--hm-skin:#FFFFFF;">';
    expect(bakeColorVars(input)).toBe(input);
  });

  it('カンマ後のスペース有無どちらも吸収する', () => {
    expect(bakeColorVars('fill="var(--hm-skin,#ABCDEF)"')).toBe('fill="#ABCDEF"');
    expect(bakeColorVars('fill="var(--hm-skin, #ABCDEF)"')).toBe('fill="#ABCDEF"');
  });

  it('root style の上書き値を var() 使用箇所に伝播する（色反映バグ回帰）', () => {
    // createAvatar は上書き色を root の style="--hm-KEY:#VALUE" にしか載せず、
    // 各パーツの var() のインライン fallback は元色のまま残す。fallback へ単純に
    // 潰すと上書き色が捨てられる（= 旧バグ）。宣言マップで実値へ解決すること。
    const input =
      '<svg style="--hm-hair:#FF0000;--hm-skin:#FFFFFF">' +
      '<path fill="var(--hm-hair, #111111)" />' +
      '<path stroke="var(--hm-skin, #222222)" /></svg>';
    const out = bakeColorVars(input);
    // hair はインライン fallback(#111111) ではなく root の上書き値(#FF0000) になる。
    expect(out).toContain('fill="#FF0000"');
    expect(out).not.toContain('#111111');
    // 宣言のない揺れも整合（skin は root 値 #FFFFFF）。
    expect(out).toContain('stroke="#FFFFFF"');
    expect(out).not.toContain('var(');
  });

  it('root 宣言が無いスロットはインライン fallback を使う', () => {
    // root style が無い単発フラグメントでは従来どおり fallback へ畳む（後方互換）。
    expect(bakeColorVars('fill="var(--hm-hair, #1A2B3C)"')).toBe('fill="#1A2B3C"');
  });
});

describe('inlineStyleClasses', () => {
  it('<style> クラス塗りを図形のインライン属性へ畳み <style> を除去する', () => {
    const input =
      '<svg><style>.st2{fill:#9e540c;}.st3{fill:#1a6916;}</style>' +
      '<path class="st2" d="M0 0"/><path class="st3" d="M1 1"/></svg>';
    const out = inlineStyleClasses(input);
    expect(out).not.toContain('<style');
    expect(out).toContain('fill="#9e540c"');
    expect(out).toContain('fill="#1a6916"');
  });

  it('カンマ区切り複数セレクタとソース順カスケード（後勝ち）を解決する', () => {
    const input =
      '<svg><style>.st0{stroke:#000;}.st0,.st1{fill:none;stroke-width:1.47px;}.st1{stroke:#fff;}</style>' +
      '<path class="st0" d="M0 0"/><path class="st1" d="M1 1"/></svg>';
    const out = inlineStyleClasses(input);
    // st0: stroke は rule1、fill:none と stroke-width はグループ rule。
    expect(out).toContain('<path class="st0" d="M0 0" stroke="#000" fill="none" stroke-width="1.47"/>');
    // st1: グループ rule の fill:none/stroke-width に加え、後勝ちで stroke=#fff。
    expect(out).toContain('stroke="#fff"');
    // px は SVG ユーザー単位へ正規化（1.47px→1.47）。
    expect(out).not.toContain('1.47px');
  });

  it('既存のインライン属性は class より優先し上書きしない', () => {
    const input =
      '<svg><style>.st2{fill:#9e540c;}</style><path class="st2" fill="#FFFFFF" d="M0 0"/></svg>';
    const out = inlineStyleClasses(input);
    expect(out).toContain('fill="#FFFFFF"');
    expect(out).not.toContain('fill="#9e540c"');
  });

  it('クラス宣言値の var(--hm-*) は残し、後段 bakeColorVars が解決できる形にする', () => {
    const input =
      '<svg style="--hm-stroke:#000000"><style>.st0{stroke:var(--hm-stroke, #000000);}</style>' +
      '<path class="st0" d="M0 0"/></svg>';
    const inlined = inlineStyleClasses(input);
    expect(inlined).toContain('stroke="var(--hm-stroke, #000000)"');
    // パイプライン順（inline→bake）で var( は完全に消える。
    expect(bakeColorVars(inlined)).not.toContain('var(');
  });

  it('<style> を含まない SVG はそのまま返す（no-op・既存パーツへ無影響）', () => {
    const input = '<svg><path fill="#CF2323" d="M0 0"/></svg>';
    expect(inlineStyleClasses(input)).toBe(input);
  });
});
