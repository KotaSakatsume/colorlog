import { Tabs } from 'expo-router';

import { SegmentedTabBar } from '@/components/segmented-tab-bar';

export default function TabsLayout() {
  return (
    <Tabs
      // 下部のセグメンテッドコントロールで切り替える（tabBarPosition 既定 = bottom）。
      tabBar={(props) => <SegmentedTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: 'bottom',
      }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
