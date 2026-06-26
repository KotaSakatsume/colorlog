/**
 * アバターカスタマイズ画面（Issue #25）。
 *
 * 上部 = 大きなライブプレビュー（`MemberAvatar` に `config={draft}` で即反映）。
 *   配布色（color）はトリップ横断で一意でなく、profile タブの自分アバターも color
 *   無しで表示するため、プレビューも color を渡さず profile 表示と背景条件を揃える
 *   （設計 §5 の配布色プレビューは「自分の確定配布色」が存在しないため follow-up）。
 * 中部 = 造形スロット切替 + 選択中スロットのパーツサムネ（横スクロール）。
 * 色 = 色スロットごとのパレット。下部 = 保存 / リセット。
 *
 * パフォ（調査リスク1）: 全 86 パーツを同時に描かない。`activeSlot` 1 つ分だけ
 * `listPartsForSlot` を `useMemo` で列挙し（slot/colors 依存）、横スクロールで描く。
 * 画面は @humation を直接 import せず、domain ラッパ + `MemberAvatar` のみ経由する。
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { MemberAvatar } from '@/components/member-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UIButton } from '@/components/ui-button';
import { Radius, Spacing, Tint } from '@/constants/theme';
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_SELECTION_SLOTS,
  listPartsForSlot,
  type AvatarConfig,
  type ColorSlotId,
  type SelectionSlotId,
} from '@/domain/avatar';
import { COLOR_POOL } from '@/domain/colors';
import { useThemeScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useCurrentUser, useRepositories } from '@/repositories/context';

const PREVIEW_SIZE = 160;
const THUMB_SIZE = 64;
/**
 * 色パレットは配布色プール（造形色にもそのまま使える hex 集合）に、無彩の
 * 黒・白を加えたもの。配布色プール自体（COLOR_POOL）はメンバー配布・上限に
 * 連動するため触らず、編集用パレットだけここで拡張する。
 */
const COLOR_PALETTE = [...COLOR_POOL.map((c) => c.hex), '#000000', '#FFFFFF'];

export default function EditAvatarScreen() {
  const theme = useTheme();
  const scheme = useThemeScheme();
  const { auth } = useRepositories();
  const user = useCurrentUser();

  // 保存まで永続化しないローカル下書き。初期値は現ユーザーの config（無ければ seed 既定）。
  const [draft, setDraft] = useState<AvatarConfig>(user.avatarConfig ?? {});
  const [activeSlot, setActiveSlot] = useState<SelectionSlotId>(AVATAR_SELECTION_SLOTS[0].id);

  // 選択中スロットのパーツのみ列挙（リスク1: 全 86 同時描画を避ける）。
  // colors を変えるとサムネ色も追従させるため draft.colors を依存に含める。
  const parts = useMemo(
    () => listPartsForSlot(activeSlot, { colors: draft.colors }),
    [activeSlot, draft.colors],
  );

  function selectPart(slot: SelectionSlotId, partId: string) {
    setDraft((prev) => ({
      ...prev,
      selections: { ...prev.selections, [slot]: partId },
    }));
  }

  function selectColor(slot: ColorSlotId, hex: string) {
    setDraft((prev) => ({
      ...prev,
      colors: { ...prev.colors, [slot]: hex },
    }));
  }

  function handleSave() {
    auth.updateProfile({ avatarConfig: draft });
    router.back();
  }

  function handleReset() {
    setDraft({});
  }

  return (
    <ThemedView style={styles.container}>
      {/* プレビューは固定ヘッダー。色やパーツを選ぶため下へスクロールしても
          アバターが画面外に消えず、変更を常に直接確認できる（UX 改善）。 */}
      <View style={[styles.previewHeader, { borderBottomColor: theme.backgroundSelected }]}>
        <MemberAvatar
          userId={user.uid}
          size={PREVIEW_SIZE}
          fallbackName={user.displayName}
          config={draft}
        />
        <ThemedText type="small" themeColor="textSecondary">
          選んだ見た目はすぐにプレビューへ反映されます。
        </ThemedText>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="smallBold" style={styles.sectionTitle}>
          パーツ
        </ThemedText>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.slotTabs}>
          {AVATAR_SELECTION_SLOTS.map((slot) => {
            const selected = slot.id === activeSlot;
            return (
              <Pressable
                key={slot.id}
                onPress={() => setActiveSlot(slot.id)}
                style={[
                  styles.slotTab,
                  {
                    backgroundColor: selected ? Tint[scheme].tint : theme.backgroundElement,
                  },
                ]}>
                <ThemedText
                  type="small"
                  style={{ color: selected ? Tint[scheme].tintText : theme.text }}>
                  {slot.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbRow}>
          {parts.map((part) => {
            const selected = draft.selections?.[activeSlot] === part.id;
            return (
              <Pressable
                key={part.id}
                onPress={() => selectPart(activeSlot, part.id)}
                style={[
                  styles.thumb,
                  {
                    borderColor: selected ? Tint[scheme].tint : theme.backgroundSelected,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}>
                <SvgXml xml={part.previewSvg} width={THUMB_SIZE} height={THUMB_SIZE} />
              </Pressable>
            );
          })}
        </ScrollView>

        <ThemedText type="smallBold" style={styles.sectionTitle}>
          色
        </ThemedText>
        {AVATAR_COLOR_SLOTS.map((slot) => (
          <View key={slot.id} style={styles.colorRow}>
            <ThemedText type="small" style={styles.colorLabel}>
              {slot.label}
            </ThemedText>
            <View style={styles.palette}>
              {COLOR_PALETTE.map((hex) => {
                const selected = draft.colors?.[slot.id] === hex;
                return (
                  <Pressable
                    key={hex}
                    onPress={() => selectColor(slot.id, hex)}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: hex,
                        borderColor: selected ? theme.text : '#00000022',
                        borderWidth: selected ? 3 : 1,
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        ))}

        <UIButton title="保存する" onPress={handleSave} style={styles.submit} />
        <UIButton
          title="デフォルトに戻す"
          variant="secondary"
          onPress={handleReset}
          style={styles.reset}
        />
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  // 固定ヘッダー（スクロールしない）。下端の区切り線で操作部と分ける。
  previewHeader: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { marginTop: Spacing.three, fontSize: 16 },
  slotTabs: { gap: Spacing.two, paddingVertical: Spacing.one },
  slotTab: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
  },
  thumbRow: { gap: Spacing.two, paddingVertical: Spacing.two },
  thumb: {
    width: THUMB_SIZE + 8,
    height: THUMB_SIZE + 8,
    borderRadius: Radius.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorRow: { marginTop: Spacing.two, gap: Spacing.one },
  colorLabel: {},
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  swatch: { width: 32, height: 32, borderRadius: Radius.sm },
  submit: { marginTop: Spacing.four },
  reset: { marginTop: Spacing.two },
});
