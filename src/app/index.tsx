import { router } from 'expo-router';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { MemberAvatar } from '@/components/member-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TripCard } from '@/components/trip-card';
import { UIButton } from '@/components/ui-button';
import { Radius, Spacing, Tint, shadow } from '@/constants/theme';
import { useCurrentUser } from '@/repositories/context';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useUserTrips } from '@/hooks/use-trips';

const SHUTTER_SIZE = 68;

export default function HomeScreen() {
  const { trips, loading } = useUserTrips();
  const user = useCurrentUser();
  const theme = useTheme();
  const scheme = useThemeScheme();
  const insets = useSafeAreaInsets();

  // シャッターの行き先＝開催中トリップ。複数ある場合は先頭を採る。
  const activeTrip = trips.find((t) => t.status === 'active');
  const myActiveColor = activeTrip?.members[user.uid]?.color;

  function handleShutter() {
    if (!activeTrip) {
      Alert.alert('開催中のトリップがありません', '旅がはじまると、ここから撮影できます。');
      return;
    }
    router.push({ pathname: '/trip/[id]/compose', params: { id: activeTrip.id } });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.logo}>
              Colorlog
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              旅の色を、みんなで撮る。
            </ThemedText>
          </View>
          {/* プロフィールは右上のアバターから（タブ廃止） */}
          <Pressable
            onPress={() => router.push('/profile')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="プロフィール">
            <MemberAvatar
              userId={user.uid}
              photoURL={user.photoURL ?? undefined}
              size={44}
              fallbackName={user.displayName}
              config={user.avatarConfig}
            />
          </Pressable>
        </View>

        <View style={styles.actions}>
          <UIButton title="＋ トリップを作る" onPress={() => router.push('/trip/create')} style={styles.action} />
          <UIButton
            title="コードで参加"
            variant="secondary"
            onPress={() => router.push('/trip/join')}
            style={styles.action}
          />
        </View>

        <FlatList
          data={trips}
          keyExtractor={(t) => t.id}
          contentContainerStyle={[styles.list, { paddingBottom: SHUTTER_SIZE + Spacing.five + insets.bottom }]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.three }} />}
          renderItem={({ item }) => (
            <TripCard
              trip={item}
              currentUserId={user.uid}
              onPress={() => router.push({ pathname: '/trip/[id]', params: { id: item.id } })}
            />
          )}
          ListEmptyComponent={
            !loading ? (
              <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
                まだトリップがありません。作るか、コードで参加しましょう。
              </ThemedText>
            ) : null
          }
        />

        {/* 下部中央のシャッター。開催中トリップがある時だけ配布色（未配布は tint）に点灯する。 */}
        <View
          style={[styles.shutterArea, { bottom: insets.bottom + Spacing.three }]}
          pointerEvents="box-none">
          <Pressable
            onPress={handleShutter}
            accessibilityRole="button"
            accessibilityLabel={activeTrip ? '撮影してベスト9に追加' : '開催中のトリップがありません'}
            style={({ pressed }) => [
              styles.shutter,
              shadow(3, scheme),
              {
                backgroundColor: activeTrip
                  ? (myActiveColor?.hex ?? Tint[scheme].tint)
                  : theme.backgroundSelected,
                borderColor: theme.background,
                transform: [{ scale: pressed ? 0.92 : 1 }],
              },
            ]}
          />
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.three,
  },
  headerText: { gap: 4, flex: 1 },
  logo: { fontSize: 36, lineHeight: 42 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  action: { flex: 1 },
  list: { paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  shutterArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shutter: {
    width: SHUTTER_SIZE,
    height: SHUTTER_SIZE,
    borderRadius: Radius.pill,
    borderWidth: 5,
  },
});
