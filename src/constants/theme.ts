/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform, type ViewStyle } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/* ------------------------------------------------------------------ *
 * UI/UX 刷新トークン（#17）
 * いずれも Colors とは独立 export。ThemeColor（= keyof Colors）を広げない。
 * themed-view/themed-text の themeColor 許容キーは 5 のまま不変。
 * ------------------------------------------------------------------ */

/**
 * 単一のアクセント色（tint）。アプリのシャシー（ボタン/リンク/アバター下地）に使う。
 * COLOR_POOL（所有者アイデンティティ色）とは役割が別。`#208AEF` をここへ集約する。
 * Colors に混ぜない（混ぜると ThemeColor 型が広がり themed-* の prop が壊れる）。
 */
export const Tint = {
  light: {
    tint: '#208AEF',
    tintPressed: '#1A6FBF',
    tintText: '#FFFFFF',
    tintSubtle: 'rgba(32,138,239,0.12)',
  },
  dark: {
    tint: '#3C9FFE',
    tintPressed: '#2E7FD6',
    tintText: '#FFFFFF',
    tintSubtle: 'rgba(60,159,254,0.18)',
  },
} as const;

/** 角丸トークン。数値直書きの borderRadius をここへ寄せる。 */
export const Radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** ガラス風フォールバック描画値（非対応端末・Expo Go 用）。 */
export const Glass = {
  light: {
    fill: 'rgba(255,255,255,0.55)',
    border: 'rgba(255,255,255,0.6)',
    borderHairline: 'rgba(0,0,0,0.08)',
  },
  dark: {
    fill: 'rgba(30,30,32,0.55)',
    border: 'rgba(255,255,255,0.12)',
    borderHairline: 'rgba(255,255,255,0.08)',
  },
} as const;

/**
 * 影ヘルパ。level 0=なし / 1=chip / 2=card / 3=modal。
 * iOS は shadow*、Android は elevation。dark は柔影が消えやすいので opacity を 1.5 倍にする。
 */
export function shadow(level: 0 | 1 | 2 | 3, scheme: 'light' | 'dark' = 'light'): ViewStyle {
  if (level === 0) return {};
  const mult = scheme === 'dark' ? 1.5 : 1;
  const ios: Record<1 | 2 | 3, ViewStyle> = {
    1: { shadowColor: '#000', shadowOpacity: 0.06 * mult, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
    2: { shadowColor: '#000', shadowOpacity: 0.1 * mult, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
    3: { shadowColor: '#000', shadowOpacity: 0.14 * mult, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } },
  };
  const android: Record<1 | 2 | 3, ViewStyle> = {
    1: { elevation: 2 },
    2: { elevation: 5 },
    3: { elevation: 10 },
  };
  return Platform.OS === 'android' ? android[level] : ios[level];
}
