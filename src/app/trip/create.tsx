import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Calendar, LocaleConfig, type DateData } from 'react-native-calendars';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Spacing } from '@/constants/theme';
import { formatDateRange } from '@/domain/format';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useTheme } from '@/hooks/use-theme';

const DAY_MS = 24 * 60 * 60 * 1000;

LocaleConfig.locales.ja = {
  monthNames: [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
  ],
  monthNamesShort: [
    '1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月',
  ],
  dayNames: ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'],
  dayNamesShort: ['日', '月', '火', '水', '木', '金', '土'],
  today: '今日',
};
LocaleConfig.defaultLocale = 'ja';

/** Date -> ローカル日付の 'YYYY-MM-DD'（タイムゾーンずれを避けるため UTC は使わない）。 */
function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 'YYYY-MM-DD' -> ローカル 0時の Date。 */
function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function CreateTripScreen() {
  const theme = useTheme();
  const { trips: tripRepo } = useRepositories();
  const host = useCurrentUser();

  const todayKey = toKey(new Date());

  const [name, setName] = useState('');
  const [startKey, setStartKey] = useState(todayKey);
  const [endKey, setEndKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const startDate = fromKey(startKey);
  const endDate = fromKey(endKey ?? startKey);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;

  // 期間内の各日に period マーキングを付ける。
  const markedDates = useMemo(() => {
    const last = endKey ?? startKey;
    const marks: Record<string, object> = {};
    for (let t = fromKey(startKey).getTime(); t <= fromKey(last).getTime(); t += DAY_MS) {
      const key = toKey(new Date(t));
      marks[key] = {
        color: theme.text,
        textColor: theme.background,
        startingDay: key === startKey,
        endingDay: key === last,
      };
    }
    return marks;
  }, [startKey, endKey, theme.text, theme.background]);

  function handleDayPress(day: DateData) {
    const pressed = day.dateString;
    if (endKey) {
      // 期間が確定済み → 新しく開始日から選び直す。
      setStartKey(pressed);
      setEndKey(null);
      return;
    }
    if (pressed < startKey) {
      // 開始日より前を押したら開始日を更新。
      setStartKey(pressed);
    } else if (pressed > startKey) {
      setEndKey(pressed);
    }
    // 開始日と同じ日を押した場合は単日（endKey は null のまま）。
  }

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('トリップ名を入力してください');
      return;
    }
    setSubmitting(true);
    try {
      const { trip } = await tripRepo.createTrip({ name, startDate, endDate, host });
      router.replace({ pathname: '/trip/[id]', params: { id: trip.id } });
    } catch (e) {
      Alert.alert('作成に失敗しました', String(e instanceof Error ? e.message : e));
      setSubmitting(false);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedText type="smallBold" style={styles.label}>
          トリップ名
        </ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="例: おきなわ2026"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          maxLength={40}
          autoFocus
        />

        <ThemedText type="smallBold" style={styles.label}>
          期間
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          カレンダーで開始日と終了日をタップして選択してください。
        </ThemedText>

        <View style={[styles.calendarWrap, { backgroundColor: theme.backgroundElement }]}>
          <Calendar
            minDate={todayKey}
            markingType="period"
            markedDates={markedDates}
            onDayPress={handleDayPress}
            theme={{
              calendarBackground: theme.backgroundElement,
              monthTextColor: theme.text,
              dayTextColor: theme.text,
              textDisabledColor: theme.textSecondary,
              textSectionTitleColor: theme.textSecondary,
              arrowColor: theme.text,
              todayTextColor: theme.text,
            }}
          />
        </View>

        <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{days}日間</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDateRange(startDate, endDate)}
          </ThemedText>
        </View>

        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          作成すると招待コードが発行されます。色は参加者が揃ってから配布します。
        </ThemedText>

        <UIButton
          title="作成する"
          onPress={handleCreate}
          loading={submitting}
          style={styles.submit}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  label: { marginTop: Spacing.three, marginBottom: 4 },
  hint: { marginBottom: Spacing.one },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
  },
  calendarWrap: {
    borderRadius: 12,
    padding: 8,
    overflow: 'hidden',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: Spacing.two,
  },
  note: { marginTop: Spacing.two },
  submit: { marginTop: Spacing.four },
});
