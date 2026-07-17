/**
 * Refill / load acceptance screen — Sprint B (mid-route).
 *
 * Distinct from app/refill.tsx (which REQUESTS a refill). This screen lets the
 * vendor REVIEW and ACCEPT a pending load/refill during the route, with clear
 * states for: no pending, pending+detail, already accepted, error, offline.
 *
 * Reuses Sebas's service entirely (no duplication):
 *   buildRouteLoadAcceptanceState(plan)  → load cards from the plan object
 *   acceptRouteLoad(planId, pickingId)   → route_plan/seal_load
 *
 * Acceptance is BINARY (seals the picking as-is). The current contract does
 * not support per-line physical-vs-planned differences (see SPRINT-B notes).
 */

import React, { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { fonts } from '../src/theme/typography';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useProductStore } from '../src/stores/useProductStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { acceptRouteLoad } from '../src/services/gfLogistics';
import { buildRouteLoadAcceptanceState, RouteLoadCard, RouteLoadLine } from '../src/services/routeLoadAcceptance';

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export default function RefillAcceptScreen() {
  const router = useRouter();
  const plan = useRouteStore((s) => s.plan);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const planId = plan?.plan_id ?? null;
  const isOnline = useSyncStore((s) => s.isOnline);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const loadProducts = useProductStore((s) => s.loadProducts);

  const [accepting, setAccepting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const state = React.useMemo(() => buildRouteLoadAcceptanceState(plan), [plan]);
  const pending = state.nextPendingLoad;
  const accepted = state.acceptedLoads;

  const onRefresh = useCallback(async () => {
    if (!isOnline) return;
    setRefreshing(true);
    try {
      await loadPlan({ force: true });
    } finally {
      setRefreshing(false);
    }
  }, [isOnline, loadPlan]);

  async function handleAccept() {
    if (!planId || accepting || !pending?.picking_id) return;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para aceptar la recarga.');
      return;
    }
    Alert.alert(
      pending.isRefill ? 'Aceptar recarga' : 'Aceptar carga',
      `¿Confirmas que recibiste el producto de "${pending.name}"? Se acepta tal cual viene.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceptar',
          onPress: async () => {
            setAccepting(true);
            try {
              await acceptRouteLoad(planId, pending.picking_id);
              await loadPlan({ force: true });
              if (warehouseId) await loadProducts(warehouseId);
              Alert.alert('Recarga aceptada', `${pending.name} quedó confirmada.`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Intenta de nuevo.';
              if (/ya.*acept|already/i.test(msg)) {
                await loadPlan({ force: true });
                Alert.alert('Ya estaba aceptada', 'Esta recarga ya había sido aceptada.');
              } else {
                Alert.alert('Error al aceptar', msg);
              }
            } finally {
              setAccepting(false);
            }
          },
        },
      ],
    );
  }

  function renderLines(load: RouteLoadCard) {
    if (load.lines.length === 0) {
      return <Text style={styles.dim}>Sin detalle de líneas.</Text>;
    }
    return (
      <View style={styles.linesBox}>
        {load.lines.map((line: RouteLoadLine, idx: number) => {
          const qty = line.display_qty || line.done_qty || line.requested_qty || line.quantity;
          return (
            <View key={line.move_id || `${line.product_id}-${idx}`} style={styles.lineRow}>
              <Text style={styles.lineName} numberOfLines={2}>{line.product_name}</Text>
              <Text style={styles.lineQty}>{formatQty(qty)} {line.uom_name || ''}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  // No plan
  if (!planId) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Recarga" showBack />
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>Sin ruta asignada</Text>
          <Text style={styles.emptyBody}>No hay plan activo para revisar recargas.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Recarga" showBack />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {!isOnline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>📶 Sin conexión. Conéctate para aceptar recargas.</Text>
          </View>
        )}

        {/* Pending load/refill */}
        {pending ? (
          <Card>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {pending.isRefill ? '🔄 Recarga pendiente' : '📦 Carga pendiente'}
              </Text>
              <Badge label="Pendiente" variant="orange" />
            </View>
            <Text style={styles.cardName}>{pending.name}</Text>
            <Text style={styles.cardMeta}>Estado: {pending.state || 'n/d'}</Text>
            {renderLines(pending)}
            {state.pendingLoads.length > 1 && (
              <Text style={styles.hint}>
                {state.pendingLoads.length} cargas pendientes. Se acepta una por una.
              </Text>
            )}
            <View style={styles.binaryNote}>
              <Text style={styles.binaryNoteText}>
                La aceptación es tal cual viene. Si hay diferencias físicas (faltante/sobrante),
                repórtalas como incidente antes o después de aceptar.
              </Text>
            </View>
            <Button
              label="🚩 Reportar diferencia"
              variant="secondary"
              onPress={() => router.push('/incident' as never)}
              fullWidth
              style={{ marginTop: 10 }}
            />
            <Button
              label={accepting ? 'Aceptando…' : (pending.isRefill ? 'Aceptar recarga' : 'Aceptar carga')}
              variant="success"
              onPress={handleAccept}
              fullWidth
              disabled={!isOnline || accepting}
              loading={accepting}
              style={{ marginTop: 8 }}
            />
          </Card>
        ) : (
          <View style={styles.okCard}>
            <Text style={styles.okIcon}>✅</Text>
            <Text style={styles.okTitle}>Sin recarga pendiente</Text>
            <Text style={styles.okBody}>
              No tienes recargas ni cargas por aceptar en este momento.
            </Text>
          </View>
        )}

        {/* Accepted loads */}
        {accepted.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>YA ACEPTADAS ({accepted.length})</Text>
            {accepted.map((load) => (
              <Card key={load.picking_id} style={{ opacity: 0.85 }}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardName}>
                    {load.isRefill ? '🔄 Recarga' : '📦 Carga'} {load.name}
                  </Text>
                  <Badge label="✓ Aceptada" variant="green" />
                </View>
                {renderLines(load)}
              </Card>
            ))}
          </>
        )}

        <Button
          label="Volver"
          variant="secondary"
          onPress={() => router.back()}
          fullWidth
          style={{ marginTop: 16 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  emptyIcon: { fontSize: 52, marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  emptyBody: { fontSize: 13, color: colors.textDim, textAlign: 'center', marginTop: 6 },
  offlineBanner: {
    padding: 12, borderRadius: radii.button,
    backgroundColor: 'rgba(234,179,8,0.08)', borderWidth: 1, borderColor: 'rgba(234,179,8,0.4)',
  },
  offlineText: { fontSize: 12, color: colors.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  cardName: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },
  cardMeta: { fontSize: 12, color: colors.textDim, marginTop: 2, marginBottom: 6 },
  dim: { fontSize: 13, color: colors.textDim },
  hint: { fontSize: 11, color: colors.textDim, marginTop: 8 },
  linesBox: { marginTop: 8, gap: 4 },
  lineRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 8, paddingHorizontal: 10, backgroundColor: colors.card, borderRadius: radii.button,
  },
  lineName: { flex: 1, fontSize: 13, color: colors.text, marginRight: 8 },
  lineQty: { fontFamily: fonts.monoBold, fontSize: 13, fontWeight: '700', color: colors.text },
  binaryNote: {
    marginTop: 10, padding: 10, borderRadius: radii.button,
    backgroundColor: 'rgba(37,99,235,0.05)', borderWidth: 1, borderColor: 'rgba(37,99,235,0.25)',
  },
  binaryNoteText: { fontSize: 11, color: colors.textDim, lineHeight: 15 },
  okCard: {
    padding: 20, borderRadius: radii.card, alignItems: 'center',
    backgroundColor: 'rgba(34,197,94,0.06)', borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
  },
  okIcon: { fontSize: 40, marginBottom: 8 },
  okTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  okBody: { fontSize: 13, color: colors.textDim, textAlign: 'center', marginTop: 4 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7,
    color: colors.textDim, marginTop: 8,
  },
});
