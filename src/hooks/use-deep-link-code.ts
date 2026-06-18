import * as Linking from 'expo-linking';
import { useMemo } from 'react';

import { normalizeInviteCode } from '@/domain/invite-code';

/**
 * ディープリンク（`colorlog://join?code=XXXX` 等）で開かれたときの招待コードを返す。
 * Expo Router の自動ナビゲーションには依存せず、画面が能動的に useURL を読む方式。
 * url から毎回直接導出する（state を持たない）ため、code 無しリンクやフォアグラウンド復帰で
 * 前回の code が残らない。code が無いリンクや通常起動では null を返す。
 */
export function useDeepLinkCode(): string | null {
  const url = Linking.useURL();
  return useMemo(() => {
    if (!url) return null;
    const normalized = normalizeInviteCode(Linking.parse(url).queryParams?.code);
    return normalized || null;
  }, [url]);
}
