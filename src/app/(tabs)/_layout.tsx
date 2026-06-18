import { Tabs } from 'expo-router';
import { Image, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { useCurrentUser } from '@/repositories/context';

const ICONS = {
  index: require('@/assets/images/tabIcons/home.png'),
  profile: require('@/assets/images/tabIcons/profile.png'),
} as const;

function TabIcon({ source, color }: { source: number; color: string }) {
  return (
    <Image
      source={source}
      resizeMode="contain"
      style={{ width: 26, height: 26, tintColor: color }}
    />
  );
}

/** Instagram と同じく、プロフィール写真があれば丸いアバター、無ければ人物アイコン。 */
function ProfileTabIcon({
  photoURL,
  color,
  focused,
}: {
  photoURL?: string;
  color: string;
  focused: boolean;
}) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          borderWidth: focused ? 2 : 1,
          borderColor: focused ? color : 'transparent',
        }}
      />
    );
  }
  return <TabIcon source={ICONS.profile} color={color} />;
}

export default function TabsLayout() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];
  const user = useCurrentUser();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.backgroundElement,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ color }) => <TabIcon source={ICONS.index} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ color, focused }) => (
            <ProfileTabIcon photoURL={user.photoURL} color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
