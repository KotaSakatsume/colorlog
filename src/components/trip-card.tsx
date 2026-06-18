import { Pressable, StyleSheet, View } from 'react-native';

import { ColorChip } from '@/components/color-chip';
import { ThemedText } from '@/components/themed-text';
import { formatDateRange, STATUS_LABEL, memberCount } from '@/domain/format';
import type { Trip } from '@/domain/types';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  trip: Trip;
  currentUserId: string;
  onPress: () => void;
};

/** ホームのトリップ一覧カード。自分の色・期間・人数・状態を表示する。 */
export function TripCard({ trip, currentUserId, onPress }: Props) {
  const theme = useTheme();
  const myColor = trip.members[currentUserId]?.color;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.9 : 1 },
      ]}>
      {/* 左の色バー（未配布はグレー） */}
      <View
        style={[styles.colorBar, { backgroundColor: myColor?.hex ?? theme.backgroundSelected }]}
      />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <ThemedText type="smallBold" style={styles.name} numberOfLines={1}>
            {trip.name}
          </ThemedText>
          <View style={[styles.statusPill, { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type="small" themeColor="textSecondary">
              {STATUS_LABEL[trip.status]}
            </ThemedText>
          </View>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDateRange(trip.startDate, trip.endDate)} ・ {memberCount(trip)}人
        </ThemedText>
        <View style={styles.chipRow}>
          {myColor ? (
            <ColorChip color={myColor} size="sm" />
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              色は未配布
            </ThemedText>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: 16,
    overflow: 'hidden',
  },
  colorBar: {
    width: 8,
  },
  body: {
    flex: 1,
    padding: 14,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 16,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
});
