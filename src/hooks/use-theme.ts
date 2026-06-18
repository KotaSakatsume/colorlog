/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const theme = useThemeScheme();

  return Colors[theme];
}
