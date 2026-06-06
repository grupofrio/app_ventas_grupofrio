/**
 * Route Plan screen — s-route in mockup (lines 157-177).
 * Full list of stops with progress stats and action buttons.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { colors, spacing, radii, stopStateColors } from '../../src/theme/tokens';
import { fonts } from '../../src/theme/typography';
import { typography } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { GFStop } from '../../src/types/plan';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import { getPlanTypeLabel, getStopTypeLabel } from '../../src/services/routePresentation';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { formatCurrency } from '../../src/utils/time';
import { filterPlannedStopsBySearch } from '../../src/services/routeStops';
import { buildStopNavigationUrls } from '../../src/services/locationNavigation';

function getStopBadge(stop: GFStop): { label: string; variant: 'green' | 'red' | 'cyan' | 'blue' | 'dim' | 'orange' } | null {
  const score = stop._koldScore;
  if (!score) return null;
  const map: Record<string, { l: string; v: 'green' | 'red' | 'cyan' | 'blue' | 'dim' }> = {
    joya: { l: 'JOYA', v: 'green' }, premium: { l: 'PREMIUM', v: 'green' },
    en_peligro: { l: 'PELIGRO', v: 'red' }, diamante_en_bruto: { l: 'DIAMANTE', v: 'cyan' },
    oportunidad_inmediata: { l: 'OPORTUN.', v: 'blue' }, bajo_retorno: { l: 'BAJO RET.', v: 'dim' },
    recuperacion: { l: 'RECUPER.', v: 'red' }, estable: { l: 'ESTABLE', v: 'dim' },
  };
  const e = map[score.category];
  if (!e) return null;
  const kg = stop._koldForecast?.predicted_kg;
  return { label: `${e.l}${kg ? ` · ${kg.toFixed(0)}kg` : ''}`, variant: e.v };
}

export default function RouteScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = React.useState('');
  const { plan, stops, stopsCompleted, stopsTotal, loadPlan } = useRouteStore();
  const salesSummary = useSalesStore((s) => s.summary);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const refreshPlan = useCallback(async () => {
    await Promise.all([
      loadPlan(),
      loadTodaySales(),
    ]);
  }, [loadPlan, loadTodaySales]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshPlan);

  useFocusEffect(
    useCallback(() => {
      void loadTodaySales();
    }, [loadTodaySales]),
  );

  const handleOpenLocation = useCallback((stop: GFStop) => {
    const { primaryUrl, fallbackUrl } = buildStopNavigationUrls(stop);
    if (!primaryUrl) {
      Alert.alert('Sin ubicación', 'Este cliente no tiene ubicación disponible.');
      return;
    }

    Linking.openURL(primaryUrl).catch(() => {
      if (fallbackUrl) {
        Linking.openURL(fallbackUrl).catch(() => {
          Alert.alert('Error', 'No se pudo abrir la ubicación.');
        });
        return;
      }
      Alert.alert('Error', 'No se pudo abrir la ubicación.');
    });
  }, []);

  const sorted = [...stops].sort((a, b) => {
    const da = ['done', 'not_visited', 'closed'].includes(a.state) ? 0 : 1;
    const db = ['done', 'not_visited', 'closed'].includes(b.state) ? 0 : 1;
    if (da !== db) return da - db;
    return (a.route_sequence || 0) - (b.route_sequence || 0);
  });
  const trimmedSearchQuery = searchQuery.trim();
  const hasSearchQuery = trimmedSearchQuery.length > 0;
  const plannedStops = filterPlannedStopsBySearch(sorted, '');
  const visibleStops = hasSearchQuery
    ? filterPlannedStopsBySearch(sorted, trimmedSearchQuery)
    : sorted;
  const planTypeLabel = getPlanTypeLabel(plan?.generation_mode);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={plan?.route || plan?.name || 'Sin ruta'}
        rightAction={{ label: '🗺 Mapa', onPress: () => router.push('/map' as never) }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Action buttons */}
        <View style={styles.actionRow}>
          <Button label="📈 Analiticas" variant="secondary" small
                  onPress={() => router.push('/analytics' as never)} style={{ flex: 1 }} />
          <Button label="🏆 Ranking" variant="secondary" small
                  onPress={() => router.push('/ranking' as never)} style={{ flex: 1 }} />
        </View>

        {/* BLD-20260408-P0: Off-route sale button */}
        <View style={styles.offrouteRow}>
          <Button
            label="🔍 Visita especial"
            variant="secondary"
            small
            onPress={() => router.push('/offroute' as never)}
            style={{ flex: 1 }}
          />
          <Button
            label="📋 Nuevo Lead"
            variant="secondary"
            small
            onPress={() => router.push('/newcustomer' as never)}
            style={{ flex: 1 }}
          />
        </View>

        {/* BLD-SPRINT-B: recarga mid-ruta + reporte de incidente */}
        <View style={styles.offrouteRow}>
          <Button
            label="🔄 Recarga"
            variant="secondary"
            small
            onPress={() => router.push('/refill-accept' as never)}
            style={{ flex: 1 }}
          />
          <Button
            label="🚩 Incidente"
            variant="secondary"
            small
            onPress={() => router.push('/incident' as never)}
            style={{ flex: 1 }}
          />
        </View>

        {/* BLD-SPRINT-C: cierre / regreso (KM final, conciliación, liquidación, cerrar ruta) */}
        <View style={styles.offrouteRow}>
          <Button
            label="🏁 Cerrar ruta"
            variant="secondary"
            small
            onPress={() => router.push('/route-close' as never)}
            style={{ flex: 1 }}
          />
        </View>

        {planTypeLabel && (
          <View style={styles.routeTypeRow}>
            <Badge label={planTypeLabel} variant="blue" />
          </View>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Progreso', value: `${stopsCompleted}/${stopsTotal}` },
            { label: 'Vendido', value: formatCurrency(salesSummary.sales_amount_total), color: colors.success },
            { label: 'Cargado', value: '--kg' },
            { label: 'Restante', value: '--kg', color: colors.primary },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={styles.statLabel}>{s.label}</Text>
              <Text style={[styles.statValue, s.color ? { color: s.color } : undefined]}>
                {s.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.searchBox}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Buscar cliente planificado"
            placeholderTextColor={colors.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={styles.searchInput}
          />
          {hasSearchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Limpiar busqueda"
            >
              <Text style={styles.clearSearchText}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {hasSearchQuery ? (
          <Text style={styles.searchCount}>
            {visibleStops.length} de {plannedStops.length} planificados
          </Text>
        ) : null}

        {/* Stop list */}
        {visibleStops.length === 0 ? (
          <View style={styles.empty}>
            <Text style={typography.dim}>
              {hasSearchQuery
                ? 'Sin clientes planificados que coincidan'
                : 'Sin paradas asignadas'}
            </Text>
          </View>
        ) : (
          visibleStops.map((stop, idx) => {
            const isDone = ['done', 'not_visited', 'closed'].includes(stop.state);
            const badge = getStopBadge(stop);
            const stopTypeLabel = getStopTypeLabel(stop);
            return (
              <View
                key={stop.id}
                style={[
                  styles.card,
                  { borderLeftColor: stopStateColors[stop.state] || colors.textDim },
                  isDone && { opacity: 0.65 },
                  stop.state === 'in_progress' && { backgroundColor: 'rgba(37,99,235,0.03)' },
                ]}
              >
                <TouchableOpacity
                  onPress={() => router.push(`/stop/${stop.id}` as never)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardRow}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {isDone ? '✅ ' : `${stop.route_sequence || idx + 1}. `}
                      {stop.state === 'in_progress' ? '🔵 ' : ''}
                      {stop.customer_name}
                    </Text>
                    {badge ? <Badge label={badge.label} variant={badge.variant} /> : null}
                  </View>
                  {stopTypeLabel && (
                    <View style={{ marginTop: 6 }}>
                      <Badge label={stopTypeLabel} variant={stop._entityType === 'lead' ? 'orange' : 'dim'} />
                    </View>
                  )}
                </TouchableOpacity>
                <View style={styles.cardActions}>
                  <Button
                    label="📍 Maps"
                    variant="secondary"
                    small
                    onPress={() => handleOpenLocation(stop)}
                    style={styles.mapsButton}
                  />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  actionRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  offrouteRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  routeTypeRow: { marginBottom: 10 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  statItem: { alignItems: 'center' },
  statLabel: { fontSize: 10, color: colors.textDim, marginBottom: 2 },
  statValue: { fontFamily: fonts.monoBold, fontSize: 14, fontWeight: '700', color: colors.text },
  searchBox: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 44,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    color: colors.text,
    fontSize: 14,
    paddingVertical: 0,
  },
  clearSearchButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.08)',
  },
  clearSearchText: { color: colors.textDim, fontSize: 20, lineHeight: 22, fontWeight: '700' },
  searchCount: { color: colors.textDim, fontSize: 12, marginBottom: 8 },
  card: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 12, paddingHorizontal: 14, marginBottom: 8, borderLeftWidth: 4,
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { flex: 1, fontWeight: '700', fontSize: 14, color: colors.text, marginRight: 8 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  mapsButton: { minWidth: 104 },
  empty: { backgroundColor: colors.card, borderRadius: radii.card, padding: 20, alignItems: 'center' },
});
