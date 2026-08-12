/**
 * Route Plan screen — s-route in mockup (lines 157-177).
 * Full list of stops with progress stats and action buttons.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, StyleSheet, RefreshControl, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Badge } from '../../src/components/ui/Badge';
import { CacheStatusBadge } from '../../src/components/ui/CacheStatusBadge';
import { colors, spacing, radii, stopStateColors } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { GFStop } from '../../src/types/plan';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import { getPlanTypeLabel, getStopTypeLabel } from '../../src/services/routePresentation';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { formatCurrency } from '../../src/utils/time';
import { filterPlannedStopsBySearch } from '../../src/services/routeStops';
import { openStopNavigation } from '../../src/services/stopNavigationAction';
import { RouteMap, RouteMapHandle } from '../../src/components/domain/RouteMap';
import { RouteStopPanel } from '../../src/components/domain/RouteStopPanel';
import { RouteActionsMenu } from '../../src/components/domain/RouteActionsMenu';
import {
  selectNextStop,
  resolveSelectedStop,
  splitStopsByLocation,
  computeRouteProgress,
  orderedStops as orderStopsBySeq,
  distanceToStop,
  haversineMeters,
} from '../../src/services/routeMapLogic';
import type { RouteFreshness } from '../../src/stores/useRouteStore';
import { evaluateVisitOrder } from '../../src/services/routeOrderLogic';
import { logInfo } from '../../src/utils/logger';
import { useDebouncedValue } from '../../src/hooks/useDebouncedValue';
import { shouldRefetchOnFocus } from '../../src/services/focusRefresh';
import { useNavigationStore } from '../../src/stores/useNavigationStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { summarizePendingOrders, describePendingOrdersBanner, buildStopOrderStatusMap } from '../../src/services/pendingOrders';

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

// F1.12: resultado por palabra de cada visita — estado honesto, no solo
// color. stop.state es la fuente real (no hay monto/razón de venta a nivel
// cliente en el contrato plan/stops; ver Ventas para el detalle por monto).
function getStopResultLabel(stop: GFStop): { label: string; variant: 'green' | 'red' | 'cyan' | 'blue' | 'dim' | 'orange' } | null {
  switch (stop.state) {
    case 'done': return { label: '✓ Visitada', variant: 'green' };
    case 'closed': return { label: '✓ Cerrada', variant: 'green' };
    case 'in_progress': return { label: '◈ En curso', variant: 'blue' };
    case 'not_visited': return { label: '✓ No visitada', variant: 'dim' };
    case 'no_stock': return { label: '⚠ Sin stock', variant: 'orange' };
    case 'rejected': return { label: '✕ Rechazada', variant: 'red' };
    default: return null;
  }
}

type ViewMode = 'map' | 'list';

function getRouteFreshnessBadge(status: RouteFreshness): { label: string; variant: 'green' | 'orange' | 'dim' } {
  if (status === 'updated') return { label: 'Actualizada', variant: 'green' };
  if (status === 'offline_cache') return { label: 'Offline/cache', variant: 'dim' };
  return { label: 'Pendiente de actualizar', variant: 'orange' };
}

export default function RouteScreen() {
  const router = useRouter();
  const { view: viewParam } = useLocalSearchParams<{ view?: string }>();
  const [searchQuery, setSearchQuery] = React.useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  // Perf Fase 1C: selectors por campo en vez de destructuring del store.
  const plan = useRouteStore((s) => s.plan);
  const stops = useRouteStore((s) => s.stops);
  const stopsCompleted = useRouteStore((s) => s.stopsCompleted);
  const stopsTotal = useRouteStore((s) => s.stopsTotal);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const routeFreshness = useRouteStore((s) => s.routeFreshness);
  const salesSummary = useSalesStore((s) => s.summary);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const userLat = useLocationStore((s) => s.latitude);
  const userLon = useLocationStore((s) => s.longitude);
  // Pedidos offline pendientes de envío (sale_order en cola) → banner informativo.
  const syncQueue = useSyncStore((s) => s.queue);
  const pendingOrdersBanner = React.useMemo(
    () => describePendingOrdersBanner(summarizePendingOrders(syncQueue)),
    [syncQueue],
  );
  // Mapa stopId → estado de su pedido en cola (para badge por cliente).
  const stopOrderStatus = React.useMemo(
    () => buildStopOrderStatusMap(syncQueue),
    [syncQueue],
  );

  // ── Map-first state (BLD-ROUTE-MAP) ──────────────────────────────────────
  const mapRef = React.useRef<RouteMapHandle | null>(null);
  const lastCenterRef = React.useRef<{ lat: number; lon: number; time: number } | null>(null);
  const [viewMode, setViewMode] = React.useState<ViewMode | null>(null); // null until first decide
  const [selectedStopId, setSelectedStopId] = React.useState<number | null>(null);
  const [panelExpanded, setPanelExpanded] = React.useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = React.useState(false);

  const { located, unlocated } = React.useMemo(() => splitStopsByLocation(stops), [stops]);
  const nextStop = React.useMemo(() => selectNextStop(stops), [stops]);
  const progress = React.useMemo(() => computeRouteProgress(stops), [stops]);
  const orderedForPanel = React.useMemo(() => orderStopsBySeq(stops), [stops]);

  // ── Navigation mode (in-app client-to-client) ─────────────────────────────
  const navigationActive = useNavigationStore((s) => s.active);
  const navigationTargetStopId = useNavigationStore((s) => s.targetStopId);
  const navigationRouteCoords = useNavigationStore((s) => s.routeCoordinates);
  const startNavigation = useNavigationStore((s) => s.startNavigation);
  const stopNavigation = useNavigationStore((s) => s.stopNavigation);

  const navigationTargetStop = React.useMemo(
    () => (navigationTargetStopId != null ? stops.find((s) => s.id === navigationTargetStopId) ?? null : null),
    [navigationTargetStopId, stops],
  );

  // Decide default view once we know whether there's a mappable plan.
  React.useEffect(() => {
    if (viewMode !== null) return;
    if (stops.length > 0) setViewMode(located.length > 0 ? 'map' : 'list');
  }, [viewMode, stops.length, located.length]);

  // Force map view when navigation is active.
  React.useEffect(() => {
    if (navigationActive && located.length > 0 && viewMode !== 'map') {
      setViewMode('map');
    }
  }, [navigationActive, located.length]);

  // Auto-follow user GPS while navigating.
  // Throttled: only reanimate if the user moved >25 m OR >5 s since last center.
  // This prevents constant animateToRegion calls on low-end devices.
  React.useEffect(() => {
    if (!navigationActive || userLat == null || userLon == null) return;
    const now = Date.now();
    const last = lastCenterRef.current;
    if (last) {
      const moved = haversineMeters(last.lat, last.lon, userLat, userLon);
      if (now - last.time < 5000 && moved < 25) return;
    }
    lastCenterRef.current = { lat: userLat, lon: userLon, time: now };
    mapRef.current?.centerOn(userLat, userLon);
  }, [navigationActive, userLat, userLon]);

  // BLD-ROUTE-MAP: entrar desde "Iniciar ruta" / "Continuar a ruta" pasa
  // ?view=map y debe FORZAR el mapa, aunque el usuario hubiera dejado la
  // lista en una visita anterior. Se limpia el param tras aplicarlo para no
  // re-forzar en navegaciones internas (abrir cliente y volver).
  useFocusEffect(
    useCallback(() => {
      if (viewParam === 'map' && located.length > 0) {
        setViewMode('map');
        router.setParams({ view: undefined });
      }
    }, [viewParam, located.length, router]),
  );

  const selectedStop = React.useMemo(
    () => (selectedStopId != null ? stops.find((s) => s.id === selectedStopId) ?? null : null),
    [selectedStopId, stops],
  );
  const focusStop = selectedStop ?? nextStop;
  const focusDistance = focusStop ? distanceToStop(userLat, userLon, focusStop) : null;

  // Auto-select the next pending stop when the screen regains focus (e.g. after
  // returning from a sale/no-sale) IF the user hasn't manually picked one.
  useFocusEffect(
    useCallback(() => {
      setSelectedStopId((prev) => resolveSelectedStop(prev, stops));
    }, [stops]),
  );

  const handleSelectStop = useCallback((stop: GFStop) => {
    setSelectedStopId(stop.id);
    if (typeof stop.customer_latitude === 'number' && typeof stop.customer_longitude === 'number') {
      mapRef.current?.centerOn(stop.customer_latitude, stop.customer_longitude);
    }
  }, []);

  // Abrir cliente = MISMO destino que la lista (/stop/[id]): el hub completo
  // del cliente (check-in geocercado, venta, no venta, regalo, datos, lealtad).
  // No se exponen venta/no-venta directos desde el mapa para no saltarse el
  // check-in y la validación de geocerca del flujo real.
  // P1: advertencia suave de orden de visita. No bloquea — si el vendedor abre
  // un cliente que no es el siguiente recomendado, pide confirmación y registra
  // la desviación en el log local (no hay endpoint backend para esto).
  const handleOpenClient = useCallback((stop: GFStop) => {
    const open = () => router.push(`/stop/${stop.id}` as never);
    const evalOrder = evaluateVisitOrder(stops, stop.id);
    if (evalOrder.outOfOrder && evalOrder.nextStop) {
      const nextName = evalOrder.nextStop.customer_name;
      logInfo('general', 'route_order_deviation', {
        selectedStopId: stop.id,
        selectedSeq: stop.route_sequence ?? null,
        recommendedStopId: evalOrder.nextStop.id,
        recommendedSeq: evalOrder.nextStop.route_sequence ?? null,
      });
      Alert.alert(
        'Fuera de orden',
        `Este no es el siguiente cliente recomendado. El siguiente es ${nextName}. ¿Deseas continuar?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Continuar', onPress: open },
        ],
      );
      return;
    }
    open();
  }, [router, stops]);
  const refreshPlan = useCallback(async () => {
    await Promise.all([
      loadPlan({ force: true }),
      loadTodaySales(),
    ]);
  }, [loadPlan, loadTodaySales]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshPlan);

  useFocusEffect(
    useCallback(() => {
      // Perf Fase 1C: evita re-pedir el plan en cada focus si se cargó hace <8s
      // (volver de un cliente). loadPlan ya deduplica concurrencia; esto evita
      // el refetch redundante. El pull-to-refresh (force) no usa este guard.
      if (shouldRefetchOnFocus(useRouteStore.getState().lastSync, Date.now())) {
        void loadPlan();
      }
      void loadTodaySales();
    }, [loadPlan, loadTodaySales]),
  );

  const handleStartNavigation = useCallback(() => {
    const target = focusStop ?? nextStop;
    if (!target) return;
    const origin = userLat != null && userLon != null
      ? { latitude: userLat, longitude: userLon }
      : null;
    const destination = target.customer_latitude != null && target.customer_longitude != null
      ? { latitude: target.customer_latitude, longitude: target.customer_longitude }
      : null;
    startNavigation(target.id, origin, destination);
    if (viewMode !== 'map') setViewMode('map');
  }, [focusStop, nextStop, startNavigation, viewMode, userLat, userLon]);

  const handleStopNavigation = useCallback(() => {
    stopNavigation();
  }, [stopNavigation]);

  const handleOpenLocation = useCallback((stop: GFStop) => {
    void openStopNavigation(stop);
  }, []);

  const sorted = [...stops].sort((a, b) => {
    const da = ['done', 'not_visited', 'closed'].includes(a.state) ? 0 : 1;
    const db = ['done', 'not_visited', 'closed'].includes(b.state) ? 0 : 1;
    if (da !== db) return da - db;
    return (a.route_sequence || 0) - (b.route_sequence || 0);
  });
  // Perf Fase 1: el input sigue ligado a searchQuery (instantáneo); el filtro
  // usa el valor debounced para no recalcular la lista en cada tecla.
  const trimmedSearchQuery = debouncedSearchQuery.trim();
  const hasSearchQuery = trimmedSearchQuery.length > 0;
  const plannedStops = filterPlannedStopsBySearch(sorted, '');
  const visibleStops = hasSearchQuery
    ? filterPlannedStopsBySearch(sorted, trimmedSearchQuery)
    : sorted;
  const planTypeLabel = getPlanTypeLabel(plan?.generation_mode);
  const freshnessBadge = getRouteFreshnessBadge(routeFreshness);

  const showMap = viewMode === 'map';

  // Perf Fase 1: tarjeta de parada como renderItem estable para FlatList.
  const renderStopCard = React.useCallback(
    ({ item: stop, index }: { item: GFStop; index: number }) => {
      const isDone = ['done', 'not_visited', 'closed'].includes(stop.state);
      const badge = getStopBadge(stop);
      const stopTypeLabel = getStopTypeLabel(stop);
      const orderStatus = stopOrderStatus[stop.id];
      const resultLabel = getStopResultLabel(stop);
      // F1.12: la siguiente parada pendiente/en curso se resalta con acceso
      // directo "Ya llegué" — mismo criterio que el panel del mapa
      // (selectNextStop: en_curso primero, si no la pendiente más próxima
      // en secuencia).
      const isNext = !!nextStop && stop.id === nextStop.id;
      return (
        <View
          style={[
            styles.card,
            { borderLeftColor: stopStateColors[stop.state] || colors.textDim },
            isDone && { opacity: 0.65 },
            stop.state === 'in_progress' && { backgroundColor: 'rgba(0,119,187,0.03)' },
            isNext && styles.cardNext,
          ]}
        >
          <TouchableOpacity onPress={() => handleOpenClient(stop)} activeOpacity={0.7}>
            <View style={styles.cardRow}>
              <Text style={[typography.body, styles.cardName]} numberOfLines={1}>
                {isDone ? '✅ ' : `${stop.route_sequence || index + 1}. `}
                {stop.state === 'in_progress' ? '🔵 ' : ''}
                {stop.customer_name}
              </Text>
              {badge ? <Badge label={badge.label} variant={badge.variant} /> : null}
            </View>
            <View style={styles.cardBadgeRow}>
              {isNext && <Badge label="◈ Siguiente" variant="blue" />}
              {resultLabel && !isNext && <Badge label={resultLabel.label} variant={resultLabel.variant} />}
              {stop._isOffroute && <Badge label="Especial" variant="orange" />}
              {stopTypeLabel && (
                <Badge label={stopTypeLabel} variant={stop._entityType === 'lead' ? 'orange' : 'dim'} />
              )}
              {orderStatus === 'pending' && <Badge label="📦 Pedido pendiente" variant="orange" />}
              {orderStatus === 'error' && <Badge label="📦 Pedido con error" variant="red" />}
            </View>
          </TouchableOpacity>
          <View style={styles.cardActions}>
            {isNext ? (
              <Button
                label="Ya llegué"
                variant="primary"
                small
                onPress={() => handleOpenClient(stop)}
                style={{ flex: 1 }}
              />
            ) : null}
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
    },
    [handleOpenClient, handleOpenLocation, stopOrderStatus, nextStop],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={plan?.route || plan?.name || 'Sin ruta'}
        rightAction={
          located.length > 0
            ? { label: showMap ? '☰ Lista' : '🗺 Mapa', onPress: () => setViewMode(showMap ? 'list' : 'map') }
            : undefined
        }
      />

      {showMap ? (
        <View style={{ flex: 1 }}>
          <RouteMap
            ref={mapRef}
            stops={stops}
            selectedStopId={focusStop?.id ?? null}
            userLat={userLat}
            userLon={userLon}
            onSelectStop={handleSelectStop}
            navigationActive={navigationActive}
            navigationTargetLat={navigationTargetStop?.customer_latitude ?? null}
            navigationTargetLon={navigationTargetStop?.customer_longitude ?? null}
            navigationRouteCoords={navigationRouteCoords}
          />
          <View style={styles.mapFabs} pointerEvents="box-none">
            <TouchableOpacity
              style={styles.fab}
              onPress={() => setActionsMenuOpen(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Más acciones"
            >
              <Text style={typography.stepperGlyph}>⋯</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.fab}
              onPress={() => mapRef.current?.fitAll()}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Ver toda la ruta en el mapa"
            >
              <Text style={typography.stepperGlyph}>⤢</Text>
            </TouchableOpacity>
            {userLat != null && userLon != null && (
              <TouchableOpacity
                style={styles.fab}
                onPress={() => mapRef.current?.centerOn(userLat, userLon)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Centrar en mi ubicación"
              >
                <Text style={typography.stepperGlyph}>◎</Text>
              </TouchableOpacity>
            )}
          </View>
          <RouteStopPanel
            progress={progress}
            selectedStop={selectedStop}
            nextStop={nextStop}
            distanceMeters={focusDistance}
            orderedStops={orderedForPanel}
            unlocatedStops={unlocated}
            expanded={panelExpanded}
            onToggleExpand={() => setPanelExpanded((v) => !v)}
            onSelectStop={handleSelectStop}
            onNavigate={handleOpenLocation}
            onOpenClient={handleOpenClient}
            onCloseRoute={() => router.push('/route-close' as never)}
            navigationActive={navigationActive}
            onStartNavigation={handleStartNavigation}
            onStopNavigation={handleStopNavigation}
          />
        </View>
      ) : (
      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        data={visibleStops}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderStopCard}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={typography.dim}>
              {hasSearchQuery
                ? 'Sin clientes planificados que coincidan'
                : 'Sin paradas asignadas'}
            </Text>
          </View>
        )}
        ListHeaderComponent={(
          <>
        {/* Perf Fase 2C: badge discreto de datos en caché / sin conexión. */}
        <CacheStatusBadge showDetail style={{ marginBottom: 8 }} />
        {/* Pedidos offline pendientes de envío (se sincronizan al reconectar). */}
        {pendingOrdersBanner && (
          <TouchableOpacity onPress={() => router.push('/sync' as never)} style={styles.pendingOrdersBanner}>
            <Text style={[typography.dim, styles.pendingOrdersText]}>{pendingOrdersBanner} · toca para ver Sync</Text>
          </TouchableOpacity>
        )}
        {/* F1.12: el header de 9 botones se reduce a un menú "☰"
            jerarquizado — mismo RouteActionsMenu que ya usa el mapa,
            catálogo compartido en ROUTE_GENERAL_ACTIONS. "Actualizar" se
            quita: el RefreshControl de pull-to-refresh ya cubre eso. */}
        <TouchableOpacity
          style={styles.moreActionsBtn}
          onPress={() => setActionsMenuOpen(true)}
          activeOpacity={0.8}
        >
          <Text style={[typography.bodySmall, styles.moreActionsText]}>☰ Más acciones</Text>
        </TouchableOpacity>

        {(planTypeLabel || freshnessBadge) && (
          <View style={styles.routeTypeRow}>
            {planTypeLabel ? <Badge label={planTypeLabel} variant="blue" /> : null}
            <Badge label={freshnessBadge.label} variant={freshnessBadge.variant} />
          </View>
        )}

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Progreso', value: `${stopsCompleted}/${stopsTotal}` },
            { label: 'Vendido', value: formatCurrency(salesSummary.sales_amount_total), color: colors.success },
            { label: 'Cargado', value: 'Sin dato' },
            { label: 'Restante', value: 'Sin dato', color: colors.primary },
          ].map((s) => (
            <View key={s.label} style={styles.statItem}>
              <Text style={[typography.badge, styles.statLabel]}>{s.label}</Text>
              <Text style={[typography.metricValue, styles.statValue, s.color ? { color: s.color } : undefined]}>
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
            style={[typography.body, styles.searchInput]}
          />
          {hasSearchQuery ? (
            <TouchableOpacity
              onPress={() => setSearchQuery('')}
              style={styles.clearSearchButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Limpiar busqueda"
            >
              <Text style={[typography.stepperGlyph, styles.clearSearchText]}>×</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {hasSearchQuery ? (
          <Text style={[typography.dim, styles.searchCount]}>
            {visibleStops.length} de {plannedStops.length} planificados
          </Text>
        ) : null}

          </>
        )}
      />
      )}
      <RouteActionsMenu
        visible={actionsMenuOpen}
        onClose={() => setActionsMenuOpen(false)}
        onNavigateRoute={(route) => router.push(route as never)}
        onShowList={() => setViewMode('list')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  // Map-first floating buttons (BLD-ROUTE-MAP)
  mapFabs: { position: 'absolute', top: 12, right: 12, gap: 8 },
  fab: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 4,
  },
  moreActionsBtn: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
    minHeight: 44,
    justifyContent: 'center',
  },
  moreActionsText: { fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.text },
  pendingOrdersBanner: {
    backgroundColor: colors.warningAlpha12, borderWidth: 1, borderColor: 'rgba(180,83,9,0.45)',
    borderRadius: radii.button, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 10,
  },
  pendingOrdersText: { color: colors.text, fontFamily: fonts.bodyBold, fontWeight: '700' },
  cardBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  routeTypeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  statItem: { alignItems: 'center' },
  statLabel: { color: colors.textDim, fontWeight: '400', marginBottom: 2 },
  statValue: { color: colors.text },
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
    paddingVertical: 0,
  },
  clearSearchButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15,42,61,0.08)',
  },
  clearSearchText: { color: colors.textDim, lineHeight: 22 },
  searchCount: { marginBottom: 8 },
  card: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 12, paddingHorizontal: 14, marginBottom: 8, borderLeftWidth: 4,
  },
  cardNext: {
    backgroundColor: colors.primaryAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(0,119,187,0.35)',
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardName: { flex: 1, fontFamily: fonts.bodyBold, fontWeight: '700', marginRight: 8 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  mapsButton: { minWidth: 104 },
  empty: { backgroundColor: colors.card, borderRadius: radii.card, padding: 20, alignItems: 'center' },
});
