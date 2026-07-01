import { Tabs } from 'expo-router';

import { SegmentedTabBar } from '@/components/segmented-tab-bar';

export default function TabsLayout() {
  return (
    <Tabs
      // 下部タブバーの代わりに上部のセグメンテッドコントロールで切り替える。
      tabBar={(props) => <SegmentedTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: 'top',
      }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
