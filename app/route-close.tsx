/**
 * Route close hub — Sprint C.
 *
 * Orchestrates the end-of-day cierre for the jefe de ruta. Reuses what already
 * exists (no duplication):
 *   - Conciliación + Validar corte + Confirmar liquidación → app/cashclose.tsx
 *     (Sebas: fetchRouteReconciliation / validateRouteCorte / confirmRouteLiquidation)
 *   - KM final → updateKm('arrival') (routeKm.ts)
 *   - Cerrar ruta → closeRoute (routeClose.ts)
 *
 * Checklist de regreso: NOT in the current backend (only the departure
 * checklist exists, one per plan). Surfaced as a note + incident fallback,
 * NOT faked.
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useRouteStartStore } from '../src/stores/useRouteStartStore';
import { useRoutePreparationStore } from '../src/stores/useRoutePreparationStore';
import { updateKm } from '../src/services/routeKm';
import { closeRoute } from '../src/services/routeClose';
import {
  chooseAuthoritativeKm,
  isValidKm,
  calculateKmDriven,
  formatKm,
  isAbsurdKmDriven,
  isAbsurdOdometer,
} from '../src/services/routeStartLogic';
import {
  canCloseRoute, describeCloseSyncBlock, shouldCleanupJornadaCache,
} from '../src/services/routeCloseGuard';
import { clearPersistedPriceCache, clearPersistedCatalog } from '../src/services/offlineCache';
import { clearCachedConsignments } from '../src/services/consignmentCache';
import { OperationGate } from '../src/components/OperationGate';

type StepStatus = 'pending' | 'done' | 'skip';

function StatusBadge({ status }: { status: StepStatus }) {
  if (status === 'done') return <Badge label="✓ Listo" variant="green" />;
  if (status === 'skip') return <Badge label="N/D" variant="dim" />;
  return <Badge label="Pendiente" variant="orange" />;
}

function RouteCloseScreenInner() {
  const router = useRouter();
  const plan = useRouteStore((s) => s.plan);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const planId = plan?.plan_id ?? null;
  const planState = plan?.state ?? null;
  const isOnline = useSyncStore((s) => s.isOnline);
  const kmInitialStore = useRouteStartStore((s) => s.kmInitial);

  // Perf Fase 2E: gate de cierre por sincronización pendiente. No se debe cerrar
  // la ruta con ventas/cobros sin sincronizar (corte fantasma).
  const pendingCount = useSyncStore((s) => s.pendingCount);
  const errorCount = useSyncStore((s) => s.errorCount);
  const deadCount = useSyncStore((s) => s.deadCount);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const resetPreparation = useRoutePreparationStore((s) => s.resetPreparation);
  const syncInput = { pendingCount, errorCount, deadCount, isSyncing };
  const closeAllowedBySync = canCloseRoute(syncInput);
  const syncBlockMsg = describeCloseSyncBlock(syncInput);

  const [kmFinalInput, setKmFinalInput] = useState('');
  const [kmFinal, setKmFinal] = useState<number | null>(null);
  const [kmInitialBackend, setKmInitialBackend] = useState<number | null>(null);
  const [savingKm, setSavingKm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);

  // KM inicial source of truth: Odoo plan first, then the backend echo from
  // km-update. The persisted phone store is not authoritative.
  const planDepartureKm = typeof plan?.departure_km === 'number' ? plan.departure_km : null;
  const kmInitial = chooseAuthoritativeKm({
    planKm: planDepartureKm,
    backendKm: kmInitialBackend,
    localKm: kmInitialStore,
  });

  // Rehydrate KM final from the plan if the backend already stored arrival_km,
  // so re-opening the hub doesn't make a saved KM look lost (Sprint C.1).
  useFocusEffect(
    useCallback(() => {
      if (isOnline) {
        void loadPlan({ force: true }).then(() => {
          const freshPlan = useRouteStore.getState().plan;
          setKmInitialBackend(typeof freshPlan?.departure_km === 'number' ? freshPlan.departure_km : null);
          const freshArrival = typeof freshPlan?.arrival_km === 'number' && freshPlan.arrival_km > 0
            ? freshPlan.arrival_km
            : null;
          if (freshArrival != null) setKmFinal(freshArrival);
        });
      }
      if (planState === 'closed' || planState === 'reconciled' || planState === 'done') {
        setClosed(true);
      }
      const planArrival = typeof plan?.arrival_km === 'number' && plan.arrival_km > 0
        ? plan.arrival_km
        : null;
      if (planArrival != null) {
        setKmFinal((prev) => (prev == null ? planArrival : prev));
      }
    }, [isOnline, loadPlan, planState, plan?.arrival_km]),
  );

  const kmDriven = calculateKmDriven(kmInitial, kmFinal);

  const kmStatus: StepStatus = kmFinal != null ? 'done' : 'pending';

  async function handleSaveKmFinal() {
    if (!planId || savingKm) return;
    if (!isValidKm(kmFinalInput)) {
      Alert.alert('KM inválido', 'Captura un kilometraje válido (mayor a 0).');
      return;
    }
    const km = Math.round(parseFloat(kmFinalInput));
    if (kmInitial != null && km < kmInitial) {
      Alert.alert('KM final menor al inicial', `El KM final (${km}) no puede ser menor al inicial (${kmInitial}).`);
      return;
    }
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate al WiFi de la sucursal para registrar el KM final.');
      return;
    }
    // P2: guard contra valores absurdos (recorrido del día o lectura de odómetro
    // exageradamente alta = probable typo). No bloquea: pide confirmación.
    const driven = kmInitial != null ? km - kmInitial : null;
    if (isAbsurdKmDriven(driven) || isAbsurdOdometer(km)) {
      const detail = isAbsurdKmDriven(driven)
        ? `El recorrido del día sería ${driven!.toLocaleString('es-MX')} km`
        : `${km.toLocaleString('es-MX')} km de odómetro`;
      Alert.alert(
        'KM inusualmente alto',
        `${detail}, parece un error de captura. ¿Es correcto?`,
        [
          { text: 'Corregir', style: 'cancel' },
          { text: 'Sí, es correcto', onPress: () => confirmSaveKmFinal(km) },
        ],
      );
      return;
    }
    confirmSaveKmFinal(km);
  }

  function confirmSaveKmFinal(km: number) {
    if (!planId) return;
    Alert.alert('Confirmar KM final', `Registrar ${km} km como kilometraje de llegada.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Guardar',
        onPress: async () => {
          setSavingKm(true);
          try {
            const res = await updateKm(planId, 'arrival', km);
            setKmFinal(res.arrival_km ?? km);
            // Backfill KM inicial from the backend echo if the store lost it.
            setKmInitialBackend(res.departure_km ?? null);
            await loadPlan({ force: true });
            setKmFinalInput('');
          } catch (err) {
            // Backend validates arrival >= departure; show its message.
            Alert.alert('Error al guardar KM', err instanceof Error ? err.message : 'Intenta de nuevo.');
          } finally {
            setSavingKm(false);
          }
        },
      },
    ]);
  }

  async function handleCloseRoute() {
    if (!planId || closing) return;
    if (kmFinal == null) {
      Alert.alert('Falta KM final', 'Registra el KM final antes de cerrar la ruta.');
      return;
    }
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para cerrar la ruta.');
      return;
    }
    // Perf Fase 2E: no cerrar con operaciones críticas sin sincronizar.
    if (!closeAllowedBySync) {
      Alert.alert(
        'Operaciones pendientes',
        syncBlockMsg ?? 'Sincroniza las operaciones pendientes antes de cerrar ruta.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Ir a sincronizar', onPress: () => router.push('/cashclose' as never) },
        ],
      );
      return;
    }
    Alert.alert(
      'Cerrar ruta',
      'Vas a cerrar la ruta del día. El servidor valida corte y liquidación. ¿Continuar?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar ruta',
          style: 'destructive',
          onPress: async () => {
            setClosing(true);
            try {
              const res = await closeRoute(planId, { departureKm: kmInitial, arrivalKm: kmFinal });
              setClosed(true);
              // Perf Fase 2E: limpiar caché de jornada SOLO tras cierre exitoso.
              // No toca la cola de sync (ya vacía por el gate) ni datos de
              // auditoría. Si el cierre fallara, el catch no limpia nada.
              if (shouldCleanupJornadaCache(true)) {
                void clearPersistedPriceCache();
                void clearPersistedCatalog();
                void clearCachedConsignments();
                resetPreparation();
              }
              const warn = res.warnings.length ? `\n\nAvisos:\n• ${res.warnings.join('\n• ')}` : '';
              Alert.alert('Ruta cerrada', `${res.message}${warn}`, [
                { text: 'OK', onPress: () => router.replace('/(tabs)' as never) },
              ]);
            } catch (err) {
              // Backend rejects if corte/liquidación incompletos — message claro.
              Alert.alert(
                'No se pudo cerrar la ruta',
                err instanceof Error ? err.message : 'Revisa corte y liquidación, luego intenta de nuevo.',
              );
            } finally {
              setClosing(false);
            }
          },
        },
      ],
    );
  }

  if (!planId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Cerrar ruta" showBack />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>Sin ruta asignada</Text>
          <Text style={styles.emptyBody}>No hay plan activo para cerrar.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (closed) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Cerrar ruta" showBack />
        <View style={styles.center}>
          <Text style={styles.okIcon}>🏁</Text>
          <Text style={styles.emptyTitle}>Ruta cerrada</Text>
          <Text style={styles.emptyBody}>Tu operación del día quedó finalizada.</Text>
          <Button label="Ir a Inicio" variant="primary" onPress={() => router.replace('/(tabs)' as never)} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Cerrar ruta" showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>📶 Sin conexión. El cierre requiere WiFi de la sucursal.</Text>
          </View>
        )}

        {/* Step 1: checklist de regreso — gap documentado */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>1 · Revisión de regreso</Text>
            <StatusBadge status="skip" />
          </View>
          <Text style={styles.stepBody}>
            El checklist de regreso no está disponible en el sistema actual (sólo
            existe el de salida). Si la unidad tiene alguna novedad, repórtala como
            incidente.
          </Text>
          <Button
            label="🚩 Reportar incidente"
            variant="secondary"
            onPress={() => router.push('/incident' as never)}
            fullWidth
          />
        </Card>

        {/* Step 2: KM final */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>2 · KM final</Text>
            <StatusBadge status={kmStatus} />
          </View>
          {kmFinal != null ? (
            <View style={styles.kmSummary}>
              <View style={styles.kmSummaryRow}>
                <Text style={styles.kmSummaryLabel}>KM final registrado</Text>
                <Text style={styles.kmSummaryValue}>{formatKm(kmFinal)} km</Text>
              </View>
              {kmInitial != null ? (
                <>
                  <View style={styles.kmSummaryRow}>
                    <Text style={styles.kmSummaryLabel}>KM inicial</Text>
                    <Text style={styles.kmSummaryValue}>{formatKm(kmInitial)} km</Text>
                  </View>
                  <View style={[styles.kmSummaryRow, styles.kmDrivenRow]}>
                    <Text style={styles.kmDrivenLabel}>Recorrido de la ruta</Text>
                    <Text style={styles.kmDrivenValue}>
                      {kmDriven != null ? `${formatKm(kmDriven)} km` : '—'}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.kmWarn}>
                  No se pudo calcular el recorrido porque falta el KM inicial.
                </Text>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.stepBody}>
                Captura el kilometraje de llegada de la unidad.
                {kmInitial != null ? ` Debe ser ≥ ${kmInitial} (KM inicial).` : ''}
              </Text>
              <View style={styles.kmRow}>
                <TextInput
                  style={styles.kmInput}
                  value={kmFinalInput}
                  onChangeText={setKmFinalInput}
                  placeholder="Ej. 123890"
                  placeholderTextColor={colors.textDim}
                  keyboardType="number-pad"
                  editable={isOnline && !savingKm}
                />
                <Button
                  label={savingKm ? 'Guardando…' : 'Guardar'}
                  variant="primary"
                  onPress={handleSaveKmFinal}
                  disabled={!isOnline || savingKm}
                  loading={savingKm}
                />
              </View>
            </>
          )}
        </Card>

        {/* Step 3: conciliación + corte + liquidación (en Corte de Caja) */}
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.stepTitle}>3 · Conciliación y liquidación</Text>
          </View>
          <Text style={styles.stepBody}>
            Revisa la conciliación, valida el corte y confirma la liquidación con
            administración en la pantalla de Corte de Caja.
          </Text>
          <Button
            label="Abrir Corte de Caja"
            variant="secondary"
            onPress={() => router.push('/cashclose' as never)}
            fullWidth
          />
        </Card>

        {/* Step 4: cerrar ruta */}
        <View style={styles.closeCard}>
          <Text style={styles.closeTitle}>4 · Cerrar ruta</Text>
          <Text style={styles.closeBody}>
            El servidor valida que el corte y la liquidación estén completos. Si
            falta algo, te dirá exactamente qué.
          </Text>
          {/* Perf Fase 2E: bloqueo por operaciones sin sincronizar. */}
          {!closeAllowedBySync && (
            <View style={styles.syncBlock}>
              <Text style={styles.syncBlockText}>
                ⚠️ {syncBlockMsg ?? 'Sincroniza operaciones pendientes antes de cerrar ruta.'}
              </Text>
              <Button
                label="Ir a sincronizar"
                variant="secondary"
                onPress={() => router.push('/cashclose' as never)}
                fullWidth
                style={{ marginTop: 8 }}
              />
            </View>
          )}
          <Button
            label={closing ? 'Cerrando…' : '🏁 Cerrar ruta'}
            variant="success"
            onPress={handleCloseRoute}
            fullWidth
            disabled={closing || kmFinal == null || !isOnline || !closeAllowedBySync}
            loading={closing}
          />
          {kmFinal == null && (
            <Text style={styles.closeHint}>Registra el KM final para habilitar el cierre.</Text>
          )}
          {kmFinal != null && !closeAllowedBySync && (
            <Text style={styles.closeHint}>
              El cierre se habilita cuando no queden operaciones pendientes de sincronizar.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// P0-4 (hardening): solo se puede cerrar una ruta que se inició (plan activo +
// checklist + KM inicial + carga aceptada).
export default function RouteCloseScreen() {
  return (
    <OperationGate title="Cerrar ruta">
      <RouteCloseScreenInner />
    </OperationGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  emptyIcon: { fontSize: 52, marginBottom: 4 },
  okIcon: { fontSize: 56, marginBottom: 4 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.textDim, textAlign: 'center' },
  offlineBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)',
  },
  offlineText: { fontSize: 12, color: colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  stepTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  stepBody: { fontSize: 12, lineHeight: 17, color: colors.textDim, marginBottom: 10 },
  kmRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  kmInput: {
    flex: 1, height: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.button,
    paddingHorizontal: 14, color: colors.text, fontFamily: fonts.monoBold, fontSize: 16, backgroundColor: colors.card,
  },
  kmSummary: { gap: 6, marginBottom: 2 },
  kmSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kmSummaryLabel: { fontSize: 12, color: colors.textDim },
  kmSummaryValue: { fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text },
  kmDrivenRow: {
    marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border,
  },
  kmDrivenLabel: { fontSize: 13, fontWeight: '700', color: colors.text },
  kmDrivenValue: { fontFamily: fonts.monoBold, fontSize: 15, fontWeight: '700', color: colors.primary },
  kmWarn: {
    fontSize: 12, color: '#EAB308', marginTop: 6, lineHeight: 16,
  },
  closeCard: {
    padding: 16, borderRadius: radii.card, borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.3)', backgroundColor: 'rgba(34,197,94,0.05)', marginTop: 4,
  },
  closeTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 6 },
  closeBody: { fontSize: 12, lineHeight: 17, color: colors.textDim, marginBottom: 12 },
  closeHint: { fontSize: 11, color: colors.textDim, marginTop: 8, textAlign: 'center' },
  syncBlock: {
    padding: 12, borderRadius: radii.button, marginBottom: 12,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.45)',
  },
  syncBlockText: { fontSize: 12, lineHeight: 17, color: colors.text },
});
