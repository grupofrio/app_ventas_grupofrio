/**
 * ErrorState — resultado fallido de una carga/acción, con reintentar.
 * Distinto de EmptyState: "hubo un error" no es lo mismo que "no hay
 * datos" (regla de estados honestos — null ≠ 0 ≠ error).
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, radii, spacing, state } from '../../theme/tokens';
import { typography, fonts } from '../../theme/typography';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  style?: ViewStyle;
}

export function ErrorState({
  title = 'Algo salió mal',
  message,
  retryLabel = 'Reintentar',
  onRetry,
  style,
}: ErrorStateProps) {
  const token = state.error;
  return (
    <View style={[styles.card, style]}>
      <Text style={[typography.stateIcon, styles.glifo]}>{token.glifo}</Text>
      <Text style={[typography.body, styles.title]}>{title}</Text>
      {message ? <Text style={[typography.dim, styles.message]}>{message}</Text> : null}
      {onRetry ? (
        <Button label={retryLabel} onPress={onRetry} variant="danger" small style={styles.action} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.errorAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.2)',
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
  },
  glifo: { marginBottom: 8, color: colors.error },
  title: { textAlign: 'center', color: colors.error, fontFamily: fonts.bodyBold, fontWeight: '700' },
  message: { textAlign: 'center', marginTop: 4 },
  action: { marginTop: 14 },
});
