import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ColorChip } from '@/components/color-chip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { BottomTabInset, Spacing, Tint } from '@/constants/theme';
import { COLOR_POOL } from '@/domain/colors';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useUserTrips } from '@/hooks/use-trips';

export default function ProfileScreen() {
  const user = useCurrentUser();
  const { trips } = useUserTrips();
  const { auth } = useRepositories();
  const scheme = useThemeScheme();
  const [linking, setLinking] = useState(false);

  // 匿名ユーザーを Apple アカウントへ連携させる。状態は useCurrentUser の購読で再描画される。
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

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.profileHeader}>
            {user.photoURL ? (
              <Image source={{ uri: user.photoURL }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View style={[styles.avatar, { backgroundColor: Tint[scheme].tint }]}>
                <ThemedText type="title" style={styles.avatarText}>
                  {user.displayName.slice(0, 1)}
                </ThemedText>
              </View>
            )}
            <ThemedText type="subtitle">{user.displayName}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              参加中・過去のトリップ {trips.length} 件
            </ThemedText>
            <UIButton
              title="プロフィールを編集"
              onPress={() => router.push('/profile/edit')}
              style={styles.editBtn}
            />
            {user.isAnonymous ? (
              <>
                <ThemedText type="small" themeColor="textSecondary" style={styles.accountStatus}>
                  ゲスト（未連携）のアカウントです
                </ThemedText>
                <UIButton
                  title="Apple と連携"
                  variant="secondary"
                  onPress={handleLinkApple}
                  loading={linking}
                  style={styles.linkBtn}
                />
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary" style={styles.accountStatus}>
                Apple アカウントと連携済み
              </ThemedText>
            )}
          </View>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            色プール（12色）
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.sectionDesc}>
            配布で割り当てられる色。色覚に頼らず名前でも見分けられます。
          </ThemedText>
          <View style={styles.palette}>
            {COLOR_POOL.map((c) => (
              <ColorChip key={c.hex} color={c} style={styles.chipBordered} />
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  profileHeader: { alignItems: 'center', gap: 6, paddingVertical: Spacing.four },
  editBtn: { marginTop: Spacing.two, alignSelf: 'stretch' },
  accountStatus: { marginTop: Spacing.two },
  linkBtn: { marginTop: Spacing.one, alignSelf: 'stretch' },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 40 },
  sectionTitle: { marginTop: Spacing.three, fontSize: 16 },
  sectionDesc: { marginBottom: Spacing.two },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chipBordered: { borderWidth: 1, borderColor: '#000000' },
});
