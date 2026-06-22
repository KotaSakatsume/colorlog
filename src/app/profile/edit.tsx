import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Spacing, Tint } from '@/constants/theme';
import { useCurrentUser, useRepositories } from '@/repositories/context';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

export default function EditProfileScreen() {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const { auth } = useRepositories();
  const user = useCurrentUser();

  const [displayName, setDisplayName] = useState(user.displayName);
  const [photoURL, setPhotoURL] = useState<string | undefined>(user.photoURL);

  async function pickImage() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('写真へのアクセスを許可してください');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoURL(result.assets[0].uri);
    }
  }

  function handleSave() {
    const name = displayName.trim();
    if (!name) {
      Alert.alert('表示名を入力してください');
      return;
    }
    auth.updateProfile({ displayName: name, photoURL });
    router.back();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.avatarSection}>
          <Pressable onPress={pickImage}>
            {photoURL ? (
              <Image source={{ uri: photoURL }} style={styles.avatar} contentFit="cover" />
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.avatarFallback,
                  { backgroundColor: Tint[scheme].tint },
                ]}>
                <ThemedText type="title" style={styles.avatarText}>
                  {displayName.slice(0, 1) || '?'}
                </ThemedText>
              </View>
            )}
          </Pressable>
          <Pressable onPress={pickImage} hitSlop={8}>
            <ThemedText
              type="smallBold"
              style={[styles.changePhoto, { color: Tint[scheme].tint }]}>
              写真を変更
            </ThemedText>
          </Pressable>
          {photoURL ? (
            <Pressable onPress={() => setPhotoURL(undefined)} hitSlop={8}>
              <ThemedText type="small" themeColor="textSecondary">
                写真を削除
              </ThemedText>
            </Pressable>
          ) : null}
        </View>

        <ThemedText type="smallBold" style={styles.label}>
          表示名
        </ThemedText>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="例: あなたの名前"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          maxLength={20}
        />
        <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
          表示名はこれから作成・参加するトリップに反映されます。
        </ThemedText>

        <UIButton title="保存する" onPress={handleSave} style={styles.submit} />
      </ScrollView>
    </ThemedView>
  );
}

const AVATAR = 96;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  avatarSection: { alignItems: 'center', gap: 8, paddingVertical: Spacing.three },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#FFFFFF', fontSize: 40 },
  changePhoto: {},
  label: { marginTop: Spacing.three, marginBottom: 4 },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
  },
  note: { marginTop: Spacing.two },
  submit: { marginTop: Spacing.four },
});
