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
import { buildRouteLoadAcceptanceState, RouteLoadCard, RouteLoadLine } from '../../services/routeLoadAcceptance';
import type { GFPlan } from '../../types/plan';

interface Props {
  plan: GFPlan | null;
  isOnline: boolean;
  warehouseId?: number | null;
  loadPlan: (opts?: { force?: boolean }) => Promise<void>;
  loadProducts: (warehouseId: number) => Promise<void> | void;
  showLoadLines?: boolean;
  showAcceptedLoads?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function RouteLoadAcceptanceCard({
  plan,
  isOnline,
  warehouseId,
  loadPlan,
  loadProducts,
  showLoadLines = false,
  showAcceptedLoads = false,
  style,
}: Props) {
  const [acceptingLoad, setAcceptingLoad] = useState(false);
  const routeLoadState = useMemo(() => buildRouteLoadAcceptanceState(plan), [plan]);
  const pendingLoad = routeLoadState.nextPendingLoad;

  const handleAcceptRouteLoad = useCallback(async () => {
    if (!plan?.plan_id || !pendingLoad?.picking_id || acceptingLoad) return;
    if (!isOnline) {
      Alert.alert('Sin conexión', 'Conéctate para aceptar la carga pendiente.');
      return;
    }

    setAcceptingLoad(true);
    try {
      await acceptRouteLoad(plan.plan_id, pendingLoad.picking_id);
      await loadPlan({ force: true });
      if (warehouseId) {
        await loadProducts(warehouseId);
      }
      Alert.alert(
        pendingLoad.isRefill ? 'Recarga aceptada' : 'Carga aceptada',
        `${pendingLoad.name} quedó confirmada para tu ruta.`,
      );
    } catch (error) {
      Alert.alert(
        'No se pudo aceptar la carga',
        error instanceof Error ? error.message : 'Intenta de nuevo o reporta a soporte.',
      );
    } finally {
      setAcceptingLoad(false);
    }
  }, [acceptingLoad, isOnline, loadPlan, loadProducts, pendingLoad, plan?.plan_id, warehouseId]);

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
