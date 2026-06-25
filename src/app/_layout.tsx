import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { RepositoryProvider } from '@/repositories/context';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RepositoryProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="profile/edit" options={{ title: 'プロフィール編集', presentation: 'modal' }} />
              <Stack.Screen name="profile/avatar" options={{ title: 'アバターを編集' }} />
              <Stack.Screen name="trip/create" options={{ title: 'トリップ作成', presentation: 'modal' }} />
              <Stack.Screen name="trip/join" options={{ title: '参加', presentation: 'modal' }} />
              <Stack.Screen name="trip/[id]/index" options={{ title: '' }} />
              <Stack.Screen
                name="trip/[id]/compose"
                options={{ title: 'ベスト9に追加', presentation: 'modal' }}
              />
              <Stack.Screen name="trip/[id]/album" options={{ title: 'アルバム' }} />
              <Stack.Screen name="trip/[id]/members" options={{ title: 'メンバー' }} />
            </Stack>
          </ThemeProvider>
        </RepositoryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
