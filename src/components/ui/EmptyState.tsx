/**
 * EmptyState — lista/sección sin datos. Generaliza el bloque inline que
 * ya existía duplicado en ProductPicker (emptyCard) y variantes ad-hoc en
 * otras pantallas. "Sin dato" nunca es un hueco en blanco.
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import { typography } from '../../theme/typography';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
}

export function EmptyState({ icon = '📭', title, message, actionLabel, onAction, style }: EmptyStateProps) {
  return (
    <View style={[styles.card, style]}>
      <Text style={typography.stateIcon}>{icon}</Text>
      <Text style={[typography.body, styles.title]}>{title}</Text>
      {message ? <Text style={[typography.dim, styles.message]}>{message}</Text> : null}
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} small style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', marginTop: 4 },
  action: { marginTop: 14 },
});
