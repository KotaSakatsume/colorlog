import { router } from 'expo-router';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TripCard } from '@/components/trip-card';
import { UIButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { useCurrentUser } from '@/repositories/context';
import { useUserTrips } from '@/hooks/use-trips';

export default function HomeScreen() {
  const { trips, loading } = useUserTrips();
  const user = useCurrentUser();

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <View style={styles.header}>
          <ThemedText type="title" style={styles.logo}>
            Colorlog
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            旅の色を、みんなで撮る。
          </ThemedText>
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
          contentContainerStyle={styles.list}
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, paddingHorizontal: Spacing.three },
  header: { paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: 4 },
  logo: { fontSize: 36, lineHeight: 42 },
  actions: { flexDirection: 'row', gap: Spacing.two, marginBottom: Spacing.three },
  action: { flex: 1 },
  list: { paddingBottom: Spacing.four },
  empty: { textAlign: 'center', marginTop: Spacing.five },
});
