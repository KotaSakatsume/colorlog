import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing, shadow } from '@/constants/theme';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/** ルート名 → セグメントの表示ラベル。 */
const LABELS: Record<string, string> = {
  index: 'ホーム',
  profile: 'プロフィール',
};

/**
 * 下部タブバーの代わりに、上部の iOS 風セグメンテッドコントロールで画面を切り替える。
 * expo-router の `Tabs` に `tabBar` として渡す（`tabBarPosition: 'top'` と併用）。
 * ルーティング状態は navigator が持つため、ここは描画と tabPress の発火だけを担う。
 */
export function SegmentedTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top + Spacing.two,
          backgroundColor: theme.background,
          borderBottomColor: theme.backgroundElement,
        },
      ]}>
      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = LABELS[route.name] ?? route.name;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              onPress={onPress}
              style={[
                styles.segment,
                focused ? [shadow(1, scheme), { backgroundColor: theme.background }] : null,
              ]}>
              <ThemedText
                type={focused ? 'smallBold' : 'small'}
                themeColor={focused ? 'text' : 'textSecondary'}>
                {label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
  },
});
