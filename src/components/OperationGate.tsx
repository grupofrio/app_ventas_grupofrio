/**
 * OperationGate (P0-4 hardening).
 *
 * Wraps screens that must NOT be reachable before the start-of-operation
 * prerequisites are complete (sale, checkout, consignment, route-close). If the
 * vendor opens one of these via deep link / back navigation without having
 * answered checklist + captured KM inicial + accepted carga (with an active plan), the gate
 * shows a clear block screen with a button to "Iniciar ruta" instead of
 * letting them operate out of sequence.
 *
 * Reuses the readiness flags from useRouteStartStore + plan from useRouteStore.
 * Does NOT auto-redirect in render (avoids navigation loops) — it presents an
 * explicit action.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from './ui/TopBar';
import { Button } from './ui/Button';
import { AlertBanner } from './ui/AlertBanner';
import { colors, spacing } from '../theme/tokens';
import { useRouteStore } from '../stores/useRouteStore';
import { useRouteStartStore } from '../stores/useRouteStartStore';
import { deriveOperationReadiness } from '../services/operationReadiness';

export function OperationGate({
  title = 'Operación',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hasActivePlan = useRouteStore((s) => s.plan != null);
  const readiness = useRouteStartStore((s) => s.readiness);

  const result = deriveOperationReadiness({
    hasActivePlan,
    checklistDone: readiness.checklistDone,
    kmCaptured: readiness.kmCaptured,
    loadAccepted: readiness.loadAccepted,
  });

  if (result.canOperate) {
    if (result.warnings.length === 0) {
      return <>{children}</>;
    }
    return (
      <>
        {children}
        <View pointerEvents="none" style={styles.warningOverlay}>
          <AlertBanner
            variant="warning"
            icon="⚠️"
            message={result.warnings.join('. ')}
          />
        </View>
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={title} showBack />
      <View style={styles.center}>
        <Text style={styles.icon}>🚦</Text>
        <Text style={styles.heading}>Ruta no iniciada</Text>
        <Text style={styles.body}>{result.reason}</Text>
        {result.warnings.length > 0 ? (
          <Text style={styles.warningText}>{result.warnings.join('. ')}</Text>
        ) : null}
        <Button
          label="Ir a preparar ruta"
          variant="primary"
          fullWidth
          onPress={() => router.replace('/route-start' as never)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenPadding, gap: 14 },
  icon: { fontSize: 48 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 14, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
  warningText: { fontSize: 12, color: colors.warning, textAlign: 'center', lineHeight: 18 },
  warningOverlay: {
    position: 'absolute',
    left: spacing.screenPadding,
    right: spacing.screenPadding,
    bottom: 24,
  },
});
