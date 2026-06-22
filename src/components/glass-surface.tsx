import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';

import { Glass, Radius, shadow } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';

type Props = {
  children: ReactNode;
  /** ガラスの強さ。expo-glass-effect の glassEffectStyle にマップ。 */
  intensity?: 'regular' | 'clear';
  radius?: keyof typeof Radius;
  style?: ViewStyle;
};

/* ------------------------------------------------------------------ *
 * expo-glass-effect の安全な解決
 *
 * iOS の GlassView は「モジュール評価時」に requireNativeViewManager を走らせ、
 * availability 関数も呼び出し時に requireNativeModule を lazy 実行する。
 * Expo Go（ExpoGlassEffect ネイティブ未リンク）では import / 呼び出し時に throw しうる。
 *
 * → static import は使わず、Platform.OS === 'ios' ガード内で動的 require + try。
 *   availability も try 内で評価し、失敗・非対応は即フォールバック描画にする。
 *   Android / Web / 非対応 iOS は分岐に入らず常にフォールバック View。
 *   （調査 §9-1/§9-2・リスク① 対応。Expo Go で絶対 throw させない。）
 * ------------------------------------------------------------------ */
let NativeGlassView: any = null;
let glassUsable = false;

if (Platform.OS === 'ios') {
  try {
    // 動的 require: モジュール評価時の throw をここで握る。
    const mod = require('expo-glass-effect');
    // availability 関数の呼び出し自体も throw しうるので try 内で評価する。
    // isGlassEffectAPIAvailable（より厳密）→ isLiquidGlassAvailable の AND。
    glassUsable = !!mod?.isGlassEffectAPIAvailable?.() && !!mod?.isLiquidGlassAvailable?.();
    if (glassUsable) NativeGlassView = mod.GlassView;
  } catch {
    glassUsable = false;
    NativeGlassView = null;
  }
}

/**
 * ガラス風サーフェス。対応端末では本物の Liquid Glass、それ以外はフォールバック描画。
 * 適用: 主要カード上層・モーダル土台・将来ヘッダー。本文リストには使わない。
 */
export function GlassSurface({ children, intensity = 'regular', radius = 'lg', style }: Props) {
  const scheme = useThemeScheme();
  const borderRadius = Radius[radius];

  if (glassUsable && NativeGlassView) {
    return (
      <NativeGlassView
        glassEffectStyle={intensity}
        colorScheme={scheme}
        style={[{ borderRadius, overflow: 'hidden' }, style]}>
        {children}
      </NativeGlassView>
    );
  }

  // フォールバック: 半透明塗り + hairline border + 角丸 + 柔影（card）。
  const g = Glass[scheme];
  return (
    <View
      style={[
        {
          backgroundColor: g.fill,
          borderRadius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: g.borderHairline,
          overflow: 'hidden',
        },
        shadow(2, scheme),
        style,
      ]}>
      {children}
    </View>
  );
}
