import { useColorScheme } from 'react-native';

export { useColorScheme };

/**
 * Normalizes the platform color scheme (`'light' | 'dark' | null | undefined`)
 * to a concrete theme key. Anything other than `'dark'` falls back to `'light'`,
 * matching the existing tab layout logic.
 */
export function useThemeScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}
