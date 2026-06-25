/**
 * メンバーアバター表示コンポーネント（Issue #23）。
 *
 * 優先順位:
 *   1. photoURL があれば自前写真を `expo-image` で表示（profile の既存挙動を尊重）。
 *   2. 無ければ `buildMemberAvatarSvg`（domain）で生成した Humation SVG を
 *      `react-native-svg` の `SvgXml` で描画。配布色は背景に焼き込み済み。
 *   3. 生成失敗 / SvgXml の描画失敗 / fallbackName のみ → 既存表現（色 swatch or
 *      頭文字 + tint 背景）に縮退。UI は決して空にしない。
 *
 * 色焼き込み・seed 決定性・var() 置換のロジックは全て domain/avatar.ts に寄せ
 * node テスト済み。本コンポーネントは薄い try/catch ラッパに留める。
 */
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Tint } from '@/constants/theme';
import { buildMemberAvatarSvg } from '@/domain/avatar';
import { contrastTextColor, type AssignedColor } from '@/domain/colors';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  /** 決定的シード。同一 userId → 同一造形。 */
  userId: string;
  /** 配布色。背景に焼き込み、リング色の決定にも使う。未配布なら省略。 */
  color?: AssignedColor;
  /** 一辺のサイズ（px）。円形にクリップする。 */
  size: number;
  /** あれば写真を最優先で表示（自前アバター）。 */
  photoURL?: string;
  /** フォールバック頭文字の元になる表示名（無ければ userId）。 */
  fallbackName?: string;
  style?: ViewStyle;
};

/** 配布色に染まる Humation アバター。失敗時は頭文字 / 色 swatch に縮退する。 */
export function MemberAvatar({ userId, color, size, photoURL, fallbackName, style }: Props) {
  const theme = useTheme();
  const scheme = useThemeScheme();
  // SvgXml の onError で描画失敗を検知したら頭文字フォールバックへ切り替える。
  const [svgFailed, setSvgFailed] = useState(false);

  const svg = useMemo(
    () => (photoURL ? null : buildMemberAvatarSvg({ userId, colorHex: color?.hex })),
    [photoURL, userId, color?.hex],
  );

  const dimension = { width: size, height: size, borderRadius: size / 2 };
  // 配布色がある場合だけ、可読性のためのリング（縁取り）を付ける。
  const ringStyle: ViewStyle = color
    ? { borderWidth: Math.max(1, Math.round(size / 36)), borderColor: contrastTextColor(color.hex) }
    : {};

  // 1. 写真優先。
  if (photoURL) {
    return (
      <View style={[styles.clip, dimension, ringStyle, style]}>
        <Image source={{ uri: photoURL }} style={styles.fill} contentFit="cover" />
      </View>
    );
  }

  // 2. Humation SVG（生成成功 かつ 描画失敗していない）。
  if (svg && !svgFailed) {
    return (
      <View style={[styles.clip, dimension, ringStyle, style]}>
        <SvgXml
          xml={svg}
          width={size}
          height={size}
          onError={() => setSvgFailed(true)}
          fallback={renderInitial(userId, fallbackName, color, theme, scheme, dimension, style)}
        />
      </View>
    );
  }

  // 3. フォールバック（頭文字 + tint or 色 swatch）。
  return renderInitial(userId, fallbackName, color, theme, scheme, dimension, style);
}

/** 生成 / 描画失敗時のフォールバック表現（色あり=swatch調 / 無し=頭文字 + tint）。 */
function renderInitial(
  userId: string,
  fallbackName: string | undefined,
  color: AssignedColor | undefined,
  theme: ReturnType<typeof useTheme>,
  scheme: ReturnType<typeof useThemeScheme>,
  dimension: ViewStyle,
  style?: ViewStyle,
) {
  const initial = (fallbackName ?? userId).slice(0, 1).toUpperCase();
  const background = color?.hex ?? Tint[scheme].tint;
  const textColor = color ? contrastTextColor(color.hex) : '#FFFFFF';
  return (
    <View style={[styles.center, dimension, { backgroundColor: background }, style]}>
      <ThemedText type="smallBold" style={{ color: textColor }}>
        {initial}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
