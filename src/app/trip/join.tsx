import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useDeepLinkCode } from '@/hooks/use-deep-link-code';
import { useTheme } from '@/hooks/use-theme';

export default function JoinTripScreen() {
  const theme = useTheme();
  const { trips: tripRepo, auth } = useRepositories();
  const user = useCurrentUser();

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [linking, setLinking] = useState(false);
  const deepLinkCode = useDeepLinkCode();

  // QR/ディープリンク経由で開かれたら、招待コードを入力欄へ自動投入する。
  useEffect(() => {
    if (deepLinkCode) setCode(deepLinkCode);
  }, [deepLinkCode]);

  // 匿名ユーザー向けの非ブロッキング導線。連携の成否は参加フローに連動させない。
  async function handleLinkApple() {
    setLinking(true);
    try {
      await auth.linkWithApple();
    } catch (e) {
      Alert.alert('連携に失敗しました', String(e instanceof Error ? e.message : e));
    } finally {
      setLinking(false);
    }
  }

  async function handleJoin() {
    // 招待コードは数字のみ。入力中は加工せず、送信時にだけ数字へ正規化する。
    const normalized = code.replace(/[^0-9]/g, '');
    if (!normalized) {
      Alert.alert('招待コードを入力してください');
      return;
    }
    setSubmitting(true);
    try {
      const trip = await tripRepo.joinTrip({ code: normalized, user });
      router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
    } catch (e) {
      Alert.alert('参加できませんでした', String(e instanceof Error ? e.message : e));
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <ThemedText type="smallBold" style={styles.label}>
          招待コード
        </ThemedText>
        <TextInput
          value={code}
          // 数字キーボードなので変換(composition)は発生しない。正規化は送信時に実施。
          onChangeText={setCode}
          placeholder="例: 123456"
          placeholderTextColor={theme.textSecondary}
          keyboardType="number-pad"
          autoCorrect={false}
          maxLength={6}
          autoFocus
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          お試し: 123456（未参加トリップに新規参加）/ 111111・222222（参加済み）
        </ThemedText>
        {user.isAnonymous ? (
          <View style={styles.linkCta}>
            <ThemedText type="small" themeColor="textSecondary">
              Apple と連携すると端末を変えてもアルバムを引き継げます。
            </ThemedText>
            <UIButton
              title="Apple と連携してアルバムを守る"
              variant="secondary"
              onPress={handleLinkApple}
              loading={linking}
            />
          </View>
        ) : null}
        <UIButton title="参加する" onPress={handleJoin} loading={submitting} style={styles.submit} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  label: { marginTop: Spacing.three },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 22,
    letterSpacing: 4,
    fontWeight: '700',
  },
  hint: { marginTop: 4 },
  linkCta: { marginTop: Spacing.two, gap: Spacing.one },
  submit: { marginTop: Spacing.four },
});
