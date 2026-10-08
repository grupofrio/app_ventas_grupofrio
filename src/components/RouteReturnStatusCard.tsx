import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Button } from './ui/Button';
import { colors, spacing, radii } from '../theme/tokens';
import { typography, fonts } from '../theme/typography';
import {
  formatSellerReturnStatus,
  routeReturnClosePresentation,
  type RouteLeftoverReceipt,
} from '../services/routeReturnStatus';

interface RouteReturnStatusCardProps {
  receipt: RouteLeftoverReceipt | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}

export function RouteReturnStatusCard({
  receipt,
  refreshing = false,
  onRefresh,
  refreshDisabled = false,
}: RouteReturnStatusCardProps) {
  const statusText = formatSellerReturnStatus(receipt);
  if (!statusText) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Recepción en Almacén</Text>
      <Text style={styles.status}>{statusText}</Text>
      <Text style={styles.hint}>
        Solo consulta. Quien cuenta el sobrante es Almacén.
      </Text>
      {onRefresh ? (
        <Button
          label={refreshing ? 'Actualizando…' : 'Actualizar estado'}
          variant="secondary"
          onPress={onRefresh}
          disabled={refreshing || refreshDisabled}
          loading={refreshing}
          fullWidth
        />
      ) : null}
    </View>
  );
}

interface RouteReturnCloseBannerProps {
  warning?: string | null;
  receipt?: RouteLeftoverReceipt | null;
}

export function RouteReturnCloseBanner({ warning, receipt }: RouteReturnCloseBannerProps) {
  const guidance = routeReturnClosePresentation({ warning, receipt });
  if (!guidance) return null;
  return (
    <View style={styles.banner} accessibilityRole="text">
      <Text style={styles.action}>{guidance.action}</Text>
      <Text style={styles.warning}>{guidance.warning}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.infoAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(0,184,212,0.35)',
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 8,
    marginBottom: spacing.lg,
  },
  title: { ...typography.cardHeading },
  status: {
    ...typography.body,
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    lineHeight: 20,
  },
  hint: { ...typography.dim, lineHeight: 17, marginBottom: 4 },
  banner: {
    padding: 12,
    borderRadius: radii.button,
    backgroundColor: colors.warningAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(180,83,9,0.45)',
    gap: 6,
    marginBottom: 12,
  },
  action: {
    ...typography.body,
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    color: colors.warning,
    lineHeight: 20,
  },
  warning: { ...typography.dim, color: colors.text, lineHeight: 17 },
});
