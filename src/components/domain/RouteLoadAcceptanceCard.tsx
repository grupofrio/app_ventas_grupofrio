import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { acceptRouteLoad } from '../../services/gfLogistics';
import type { InventoryLoadResult } from '../../services/legacyRefreshRunner';
import {
  describeRouteLoadAcceptSuccess,
  evaluateInventoryRefreshEvidence,
  evaluatePlanRefreshEvidence,
  requirePositivePickingId,
  runRouteLoadAcceptAndRefresh,
} from '../../services/routeLoadAcceptFlow';
import { buildRouteLoadAcceptanceState, RouteLoadCard, RouteLoadLine } from '../../services/routeLoadAcceptance';
import { useRouteStore } from '../../stores/useRouteStore';
import type { GFPlan } from '../../types/plan';
import { logWarn } from '../../utils/logger';

interface Props {
  plan: GFPlan | null;
  isOnline: boolean;
  loadPlan: (opts?: { force?: boolean }) => Promise<void>;
  /** Authoritative inventory loader — Promise resolve is NOT success evidence. */
  loadProductsAuthoritative: () => Promise<InventoryLoadResult>;
  showLoadLines?: boolean;
  showAcceptedLoads?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function RouteLoadAcceptanceCard({
  plan,
  isOnline,
  loadPlan,
  loadProductsAuthoritative,
  showLoadLines = false,
  showAcceptedLoads = false,
  style,
}: Props) {
  const [acceptingPickingId, setAcceptingPickingId] = useState<number | null>(null);
  const routeLoadState = useMemo(() => buildRouteLoadAcceptanceState(plan), [plan]);
  const pendingLoad = routeLoadState.nextPendingLoad;
  const acceptingLoad = acceptingPickingId != null;

  const handleAcceptRouteLoad = useCallback(async () => {
    if (!plan?.plan_id || !pendingLoad?.picking_id || acceptingPickingId != null) return;
    // Capture exact picking identity before any await (multi-refill safe).
    const pickingId = requirePositivePickingId(pendingLoad.picking_id);
    const planId = plan.plan_id;
    const isRefill = pendingLoad.isRefill;
    const pickingName = pendingLoad.name;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para aceptar la carga pendiente.');
      return;
    }

    setAcceptingPickingId(pickingId);
    try {
      const outcome = await runRouteLoadAcceptAndRefresh({
        planId,
        pickingId,
        isOnline: true,
        accept: acceptRouteLoad,
        refreshPlan: async () => {
          await loadPlan({ force: true });
          const snap = useRouteStore.getState();
          return evaluatePlanRefreshEvidence({
            expectedPlanId: planId,
            plan: snap.plan,
            routeFreshness: snap.routeFreshness,
          });
        },
        refreshInventory: async () => {
          const result = await loadProductsAuthoritative();
          return evaluateInventoryRefreshEvidence(result);
        },
      });
      const copy = describeRouteLoadAcceptSuccess({
        isRefill,
        pickingName,
        idempotentReplay: outcome.accept.idempotent_replay,
        inventoryRefreshOk: outcome.inventoryRefreshOk && outcome.planRefreshOk,
      });
      if (!outcome.inventoryRefreshOk || !outcome.planRefreshOk) {
        logWarn('inventory', 'route_load_accept_refresh_failed', {
          plan_id: planId,
          picking_id: pickingId,
          plan_refresh_ok: outcome.planRefreshOk,
          plan_refresh_reason: outcome.planRefreshReason,
          inventory_refresh_ok: outcome.inventoryRefreshOk,
          error: outcome.inventoryRefreshError,
        });
      }
      Alert.alert(copy.title, copy.body);
    } catch (error) {
      Alert.alert(
        'No se pudo aceptar la carga',
        error instanceof Error ? error.message : 'Intenta de nuevo o reporta a soporte.',
      );
    } finally {
      setAcceptingPickingId(null);
    }
  }, [
    acceptingPickingId,
    isOnline,
    loadPlan,
    loadProductsAuthoritative,
    pendingLoad,
    plan?.plan_id,
  ]);

  const acceptedLoads = showAcceptedLoads ? routeLoadState.acceptedLoads : [];

  function formatQty(value: number): string {
    if (!Number.isFinite(value)) return '0';
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }

  function renderLoadLines(load: RouteLoadCard) {
    if (!showLoadLines || load.lines.length === 0) return null;

    return (
      <View style={styles.linesBox}>
        {load.lines.map((line: RouteLoadLine, index: number) => {
          const qty = line.display_qty || line.done_qty || line.requested_qty;
          const key = line.move_id || `${line.product_id}-${index}`;
          return (
            <View key={key} style={styles.lineRow}>
              <Text style={styles.lineName} numberOfLines={2}>
                {line.product_name}
              </Text>
              <Text style={styles.lineQty}>
                {formatQty(qty)} {line.uom_name || ''}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  if ((!routeLoadState.hasPendingLoad || !pendingLoad) && acceptedLoads.length === 0) {
    return null;
  }

  return (
    <View style={[styles.card, style]}>
      {pendingLoad ? (
        <View style={styles.loadBlock}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {pendingLoad.isRefill ? 'Recarga pendiente' : 'Carga inicial pendiente'}
              </Text>
              <Text style={styles.body}>
                {pendingLoad.name} debe aceptarse antes de vender.
              </Text>
              {routeLoadState.pendingLoads.length > 1 ? (
                <Text style={styles.hint}>
                  {routeLoadState.pendingLoads.length} cargas pendientes. Se acepta una por una.
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              style={[styles.button, (!isOnline || acceptingLoad) && styles.buttonDisabled]}
              onPress={handleAcceptRouteLoad}
              disabled={!isOnline || acceptingLoad}
              activeOpacity={0.85}
            >
              {acceptingLoad ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <Text style={styles.buttonText}>Aceptar</Text>
              )}
            </TouchableOpacity>
          </View>
          {renderLoadLines(pendingLoad)}
        </View>
      ) : null}

      {acceptedLoads.length > 0 ? (
        <View style={styles.acceptedBlock}>
          <Text style={styles.acceptedHeading}>Carga aceptada</Text>
          {acceptedLoads.map((load) => (
            <View key={load.picking_id} style={styles.acceptedItem}>
              <Text style={styles.acceptedTitle}>
                {load.isRefill ? 'Recarga' : 'Carga inicial'} {load.name}
              </Text>
              {renderLoadLines(load)}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    padding: 14,
    marginBottom: 14,
  },
  loadBlock: {
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 3,
  },
  hint: {
    fontSize: 11,
    color: colors.warning,
    marginTop: 6,
  },
  button: {
    minWidth: 86,
    minHeight: 40,
    borderRadius: radii.button,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '700',
  },
  linesBox: {
    borderRadius: radii.button,
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  lineRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  lineName: {
    flex: 1,
    fontSize: 12,
    color: colors.text,
  },
  lineQty: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
  },
  acceptedBlock: {
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  acceptedHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
    textTransform: 'uppercase',
  },
  acceptedItem: {
    gap: 6,
  },
  acceptedTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
});
