/**
 * Home screen — s-home in mockup (lines 122-155).
 * Full implementation with real layout matching HTML.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SyncBar } from '../../src/components/ui/SyncBar';
import { KPICard } from '../../src/components/ui/KPICard';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import { StopCard } from '../../src/components/domain/StopCard';
import { RoutePreparationCard } from '../../src/components/domain/RoutePreparationCard';
import { RouteLoadAcceptanceCard } from '../../src/components/domain/RouteLoadAcceptanceCard';
import { useRouteStartStore } from '../../src/stores/useRouteStartStore';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useKoldStore, KoldAlert } from '../../src/stores/useKoldStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import { useProductStore } from '../../src/stores/useProductStore';
import { preloadRouteCustomerPrices } from '../../src/services/pricelist';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { formatCurrency } from '../../src/utils/time';
import { shouldAutoLoadProducts } from '../../src/utils/productLoading';

export default function HomeScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const employeeId = useAuthStore((s) => s.employeeId);
  const employeeName = useAuthStore((s) => s.employeeName);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const {
    plan, stops, stopsCompleted, stopsTotal, progressPct,
    isLoading, loadPlan, error: planError, lastSync: planLastSync,
  } = useRouteStore();
  const isOnline = useSyncStore((s) => s.isOnline);
  const salesSummary = useSalesStore((s) => s.summary);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const products = useProductStore((s) => s.products);
  const productCount = useProductStore((s) => s.productCount);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productsLastSync = useProductStore((s) => s.lastSync);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const routeStartReadiness = useRouteStartStore((s) => s.readiness);

  // Reload on auth identity changes so a previous employee's in-memory state is not reused.
  useEffect(() => {
    if (isAuthenticated && isOnline) {
      void loadPlan();
    }
  }, [employeeId, isAuthenticated, isOnline, loadPlan]);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated || !isOnline) return;
      void loadTodaySales();
    }, [isAuthenticated, isOnline, loadTodaySales]),
  );

  useEffect(() => {
    if (!isAuthenticated || !isOnline) {
      return;
    }
    if (shouldAutoLoadProducts(
      warehouseId,
      productCount,
      isLoadingProducts,
      productsLastSync,
      productError,
    )) {
      void loadProducts(warehouseId!);
    }
  }, [
    isAuthenticated,
    isOnline,
    warehouseId,
    productCount,
    isLoadingProducts,
    productsLastSync,
    productError,
    loadProducts,
  ]);

  useEffect(() => {
    if (!isAuthenticated || !isOnline || stops.length === 0 || products.length === 0) {
      return;
    }
    const partnerIds = stops.map((stop) => stop.customer_id);
    void preloadRouteCustomerPrices(partnerIds, products, { companyId });
  }, [isAuthenticated, isOnline, stops, products, companyId]);

  // BLD-20260408: Use getAlerts() method (not s.alerts property which doesn't exist)
  const getAlerts = useKoldStore((s) => s.getAlerts);
  const koldAlerts = useMemo(() => getAlerts() || [], [getAlerts]);
  const refreshPlan = useCallback(async () => {
    await Promise.all([
      loadPlan(),
      loadTodaySales(),
    ]);
  }, [loadPlan, loadTodaySales]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshPlan);

  // Next stops (pending + in_progress, max 4)
  const nextStops = useMemo(() =>
    stops
      .filter((s) => ['pending', 'in_progress'].includes(s.state))
      .slice(0, 4)
  , [stops]);

  // Completed stops
  const doneStops = useMemo(() => stops.filter((s) => s.state === 'done'), [stops]);
  const todaySales = salesSummary.orders_count;

  // BLD-20260425-NOPLAN: detectar el caso "no hay plan para hoy".
  // Antes la home pintaba KPIs vacíos, mapa "Sin ruta asignada" y placeholders
  // confusos cuando /my_plan respondía data.found:false. Ahora mostramos un
  // EmptyState dedicado para que el operador entienda que NO está roto: solo
  // no tiene ruta hoy. Disparamos solo después del primer intento de carga
  // (planLastSync !== null) Y cuando no estamos cargando — así no parpadea
  // durante el boot inicial.
  const hasAttemptedLoad = planLastSync !== null || planError !== null;
  const showNoPlanState =
    !plan &&
    !isLoading &&
    hasAttemptedLoad;
  // El backend custom puede mandar mensajes diferentes (data.found:false →
  // "Sin plan para hoy"; otros casos → mensaje real). Mostramos siempre el
  // mensaje del backend como subtítulo cuando exista, sin ocultarlo.
  const isStandardNoPlan = !planError || /sin plan/i.test(planError);

  // BLD-SPRINT-A.1: CTA "Iniciar operación" con 3 estados para no confundir:
  //  - ruta ya en marcha (alguna parada en curso/hecha) → "Ver ruta"
  //  - operación lista (checklist+KM+carga) pero sin arrancar → "Continuar a ruta"
  //  - falta algo → "Iniciar operación"
  const routeUnderway = stops.some((s) => s.state === 'in_progress' || s.state === 'done');
  const opReady = routeStartReadiness.readyToStart;
  const routeStartCta = routeUnderway
    ? { title: 'Ver ruta', sub: 'Tu recorrido del día', icon: '🗺️', target: '/(tabs)/route' as const }
    : opReady
      ? { title: 'Continuar a ruta', sub: 'Operación lista · revisa tus paradas', icon: '✅', target: '/(tabs)/route' as const }
      : { title: 'Iniciar operación', sub: 'Checklist · KM inicial · Aceptar carga', icon: '🚚', target: '/route-start' as const };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.clock}>9:41</Text>
        <Text style={styles.statusIcons}>📶 🔋 📍</Text>
      </View>

      {/* Sync bar */}
      <SyncBar />

      {/* Greeting + settings */}
      <View style={styles.greeting}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greetLabel}>Buenos dias</Text>
          <Text style={styles.greetName}>{employeeName || 'Vendedor'}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/profile' as never)}
        >
          <Ionicons name="settings-outline" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {showNoPlanState ? (
          /* BLD-20260425-NOPLAN: EmptyState dedicado cuando no hay plan
             para hoy. Reemplaza KPIs/mapa/paradas para que el operador no
             se confunda con un layout "vacío". Mantenemos SyncBar y
             greeting (renderizados arriba) intactos. */
          <View style={styles.noPlanCard}>
            <Text style={styles.noPlanIcon}>📭</Text>
            <Text style={styles.noPlanTitle}>
              {isStandardNoPlan
                ? 'Hoy no tienes ruta asignada'
                : 'No se pudo cargar tu ruta'}
            </Text>
            <Text style={styles.noPlanBody}>
              {isStandardNoPlan
                ? 'Verifica con tu supervisor que el plan esté publicado, o si ya tienes plan, acepta tu carga desde la PWA de Jefe de Ruta antes de abrir Kold Field.'
                : 'Hubo un problema al consultar tu plan con el servidor. Intenta refrescar o contacta soporte si persiste.'}
            </Text>
            {planError && !isStandardNoPlan ? (
              /* No ocultamos errores reales del backend: si /my_plan o
                 /plan/stops devolvió un mensaje distinto a "Sin plan",
                 lo mostramos textual para diagnóstico en campo. */
              <Text style={styles.noPlanServerMsg}>
                Mensaje del servidor: {planError}
              </Text>
            ) : null}
            <TouchableOpacity
              style={[styles.noPlanBtn, (!isOnline || isLoading) && styles.noPlanBtnDisabled]}
              onPress={() => { void loadPlan(); }}
              disabled={!isOnline || isLoading}
              activeOpacity={0.8}
            >
              <Text style={styles.noPlanBtnText}>
                {isLoading ? 'Cargando...' : '🔄 Refrescar'}
              </Text>
            </TouchableOpacity>
            {!isOnline ? (
              <Text style={styles.noPlanHint}>
                Sin conexión. Conéctate para refrescar.
              </Text>
            ) : null}
            <Text style={styles.noPlanFootnote}>
              Operadores con rol Jefe de Ruta: la PWA con tu carga del día se
              abre desde el navegador del dispositivo.
            </Text>
          </View>
        ) : (
          <>
            {/* BLD-SPRINT-A.1: CTA contextual de inicio de operación.
                3 estados (ver routeStartCta arriba) para no confundir cuando
                la operación ya está lista o la ruta ya arrancó. */}
            <TouchableOpacity
              style={styles.routeStartCta}
              onPress={() => router.push(routeStartCta.target as never)}
              activeOpacity={0.85}
            >
              <Text style={styles.routeStartIcon}>{routeStartCta.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeStartTitle}>{routeStartCta.title}</Text>
                <Text style={styles.routeStartSub}>{routeStartCta.sub}</Text>
              </View>
              <Text style={styles.routeStartChevron}>›</Text>
            </TouchableOpacity>

            {/* BLD-20260505-ROUTEPREP: card "Preparar ruta" — invita al
                vendedor a precargar plan/productos/precios con WiFi en
                CEDIS antes de salir. No bloquea otras acciones; sólo
                informa el estado. */}
            <RoutePreparationCard />

            <RouteLoadAcceptanceCard
              plan={plan}
              isOnline={isOnline}
              warehouseId={warehouseId}
              loadPlan={loadPlan}
              loadProducts={loadProducts}
            />

            {/* BLD-20260408-P2: Weather card — no API available yet, show honest placeholder */}
            <View style={styles.weatherCard}>
              <Text style={{ fontSize: 22 }}>🌤️</Text>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.weatherCity}>Clima no disponible</Text>
                <Text style={styles.weatherSub}>Proximamente en KOLD</Text>
              </View>
            </View>

            {/* KPI Grid 2x2 */}
            <View style={styles.kpiGrid}>
              <KPICard
                label="PARADAS"
                value={`${stopsTotal}`}
                subtitle={`${stopsCompleted} de ${stopsTotal}`}
              />
              <KPICard
                label="CARGAR"
                value="--"
                subtitle="kg estimados"
              />
              <KPICard
                label="VENTA HOY"
                value={formatCurrency(salesSummary.sales_amount_total)}
                subtitle={`${todaySales} pedidos`}
                valueColor={colors.success}
              />
              <KPICard
                label="FORECAST"
                value="--"
                subtitle="F5: KoldDemand"
              />
            </View>

            {/* Intelligence alerts */}
            {koldAlerts.slice(0, 3).map((alert: KoldAlert, idx: number) => (
              <AlertBanner
                key={idx}
                icon={alert.type === 'critical' ? '🔴' : alert.type === 'warning' ? '🟡' : '🟢'}
                variant={alert.type === 'critical' ? 'critical' : alert.type === 'warning' ? 'warning' : 'info'}
                message={alert.message}
              />
            ))}

            {/* Route map preview */}
            <Text style={styles.sectionTitle}>RUTA DEL DIA</Text>
            <TouchableOpacity
              style={styles.mapPreview}
              onPress={() => router.push('/map' as never)}
              activeOpacity={0.8}
            >
              <View style={styles.mapContent}>
                <Text style={styles.mapRouteName}>
                  {plan?.route || plan?.name || 'Sin ruta asignada'}
                </Text>
                <Text style={styles.mapSub}>
                  {stopsTotal} paradas · Toca para mapa
                </Text>
              </View>
            </TouchableOpacity>

            {/* Progress bar */}
            <View style={styles.progressContainer}>
              <View style={styles.progressRow}>
                <Text style={typography.bodySmall}>Progreso</Text>
                <Text style={styles.progressValue}>{progressPct}%</Text>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
              </View>
            </View>

            {/* Next stops */}
            <Text style={styles.sectionTitle}>PROXIMAS PARADAS</Text>
            {isLoading ? (
              <View style={styles.emptyCard}>
                <Text style={typography.dim}>Cargando plan...</Text>
              </View>
            ) : nextStops.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={typography.dim}>
                  {stopsTotal === 0
                    ? 'Sin paradas en tu plan'
                    : 'Todas las paradas completadas 🎉'}
                </Text>
              </View>
            ) : (
              nextStops.map((stop, idx) => (
                <StopCard key={stop.id} stop={stop} index={idx} />
              ))
            )}

            {/* Done stops */}
            {doneStops.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>COMPLETADAS ({doneStops.length})</Text>
                {doneStops.slice(0, 2).map((stop, idx) => (
                  <StopCard key={stop.id} stop={stop} index={idx} />
                ))}
                {doneStops.length > 2 && (
                  <Text style={[typography.dim, { textAlign: 'center', marginBottom: 10 }]}>
                    +{doneStops.length - 2} paradas mas
                  </Text>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  statusBar: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screenPadding,
  },
  clock: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  statusIcons: {
    fontSize: 11,
    color: colors.textDim,
  },
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 6,
  },
  greetLabel: {
    fontSize: 12,
    color: colors.textDim,
  },
  greetName: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 100,
  },
  weatherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 14,
    borderRadius: radii.button,
    marginBottom: 14,
    backgroundColor: 'rgba(37,99,235,0.04)',
  },
  // BLD-SPRINT-A: CTA "Iniciar operación"
  routeStartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.card,
    marginBottom: 14,
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.3)',
  },
  routeStartIcon: { fontSize: 26 },
  routeStartTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  routeStartSub: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  routeStartChevron: { fontSize: 28, color: colors.primary, fontWeight: '300' },
  weatherTemp: {
    fontFamily: fonts.monoBold,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  weatherCity: {
    fontSize: 10,
    color: colors.textDim,
  },
  weatherImpact: {
    fontSize: 12,
    color: colors.primary,
    fontWeight: '600',
  },
  weatherSub: {
    fontSize: 9,
    color: colors.textDim,
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    color: colors.textDim,
    marginTop: 16,
    marginBottom: 8,
  },
  mapPreview: {
    width: '100%',
    height: 160,
    borderRadius: radii.card,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    overflow: 'hidden',
  },
  mapContent: {
    alignItems: 'center',
  },
  mapRouteName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary,
  },
  mapSub: {
    fontSize: 10,
    color: colors.textDim,
    marginTop: 2,
  },
  progressContainer: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 14,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressValue: {
    fontFamily: fonts.monoBold,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  emptyCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 20,
    alignItems: 'center',
  },
  // BLD-20260425-NOPLAN: EmptyState dedicado cuando no hay plan asignado.
  noPlanCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 24,
    alignItems: 'center',
    marginTop: 24,
  },
  noPlanIcon: {
    fontSize: 56,
    marginBottom: 12,
  },
  noPlanTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  noPlanBody: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
    textAlign: 'center',
    marginBottom: 16,
  },
  noPlanServerMsg: {
    fontSize: 11,
    color: colors.textDim,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  noPlanBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: radii.button,
    minWidth: 180,
    alignItems: 'center',
  },
  noPlanBtnDisabled: {
    opacity: 0.4,
  },
  noPlanBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  noPlanHint: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 8,
  },
  noPlanFootnote: {
    fontSize: 10,
    color: colors.textDim,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 12,
    lineHeight: 14,
  },
});
