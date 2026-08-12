/**
 * TopBar with optional back button, matching mockup .tb class.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, sizes, radii } from '../../theme/tokens';
import { typography } from '../../theme/typography';

interface TopBarProps {
  title: string;
  showBack?: boolean;
  onBack?: () => void;
  rightAction?: { label: string; onPress: () => void };
  rightIcon?: { name: keyof typeof Ionicons.glyphMap; onPress: () => void; accessibilityLabel?: string };
}

export function TopBar({ title, showBack = false, onBack, rightAction, rightIcon }: TopBarProps) {
  const router = useRouter();
  const handleBack = onBack ?? (() => router.back());

  return (
    <View style={styles.container}>
      {showBack ? (
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
        >
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: showBack ? sizes.backButton : 0 }} />
      )}

      <Text style={[typography.screenTitle, styles.title]} numberOfLines={1}>
        {title}
      </Text>

      {rightAction ? (
        <TouchableOpacity onPress={rightAction.onPress}>
          <Text style={styles.action}>{rightAction.label}</Text>
        </TouchableOpacity>
      ) : rightIcon ? (
        <TouchableOpacity
          onPress={rightIcon.onPress}
          accessibilityRole="button"
          accessibilityLabel={rightIcon.accessibilityLabel ?? 'Más opciones'}
        >
          <Ionicons name={rightIcon.name} size={20} color={colors.primary} />
        </TouchableOpacity>
      ) : (
        <View style={{ width: 34 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 10,
    gap: 10,
  },
  backBtn: {
    width: sizes.backButton,
    height: sizes.backButton,
    borderRadius: radii.circle,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  action: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
});
