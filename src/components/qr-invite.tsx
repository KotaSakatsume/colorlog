import * as Linking from 'expo-linking';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

type Props = {
  /** 招待コード（数字）。これを含むディープリンクを QR にする。 */
  code: string;
  /** QR の一辺サイズ（px）。 */
  size?: number;
};

/**
 * 招待コードを `colorlog://join?code=XXXX` のディープリンクにして QR 描画する。
 * dev client では scheme が変わるため、文字列連結せず Linking.createURL に委譲する。
 * パスは設計どおり `join`（router 自動遷移に依存せず join 画面が能動的に useURL を読む前提）。
 * 受信側（join 画面）は useDeepLinkCode で能動的に code を読み取り、入力欄へ自動投入する。
 * QR は読み取り精度のため白地・黒モジュール固定（テーマに依らない）。
 */
export function QrInvite({ code, size = 160 }: Props) {
  const url = useMemo(() => Linking.createURL('join', { queryParams: { code } }), [code]);

  return (
    <View style={styles.container}>
      <View style={[styles.qrFrame, { backgroundColor: '#FFFFFF' }]}>
        <QRCode value={url} size={size} backgroundColor="#FFFFFF" color="#000000" />
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.caption}>
        このQRから参加リンクを開けます
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: Spacing.two },
  qrFrame: {
    padding: Spacing.two,
    borderRadius: 12,
  },
  caption: { textAlign: 'center' },
});
