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
import { GrupoFrioIcon } from '../../src/components/ui/GrupoFrioLogo';
import { useRouteStartStore } from '../../src/stores/useRouteStartStore';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { shouldRefetchOnFocus } from '../../src/services/focusRefresh';
import { useKoldStore, KoldAlert } from '../../src/stores/useKoldStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import { useProductStore } from '../../src/stores/useProductStore';
import { preloadRouteCustomerPrices } from '../../src/services/pricelist';
import { useSalesStore } from '../../src/stores/useSalesStore';
import { useTasksStore } from '../../src/stores/useTasksStore';
import { formatCurrency } from '../../src/utils/time';
import { shouldAutoLoadProducts } from '../../src/utils/productLoading';
import { isStandardNoPlanError } from '../../src/services/routeLoadOutcome';
import { legacyMigrationNoticeCopy } from '../../src/services/legacyRefillUnloadMigration';
import { formatAuthoritativeStockKg } from '../../src/services/inventoryDisplay';

export default function HomeScreen() {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const employeeId = useAuthStore((s) => s.employeeId);
  const employeeName = useAuthStore((s) => s.employeeName);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  // Perf Fase 1C: selectors por campo en vez de destructuring del store.
  const plan = useRouteStore((s) => s.plan);
  const stops = useRouteStore((s) => s.stops);
  const stopsCompleted = useRouteStore((s) => s.stopsCompleted);
  const stopsTotal = useRouteStore((s) => s.stopsTotal);
  const progressPct = useRouteStore((s) => s.progressPct);
  const isLoading = useRouteStore((s) => s.isLoading);
  const loadPlan = useRouteStore((s) => s.loadPlan);
  const planError = useRouteStore((s) => s.error);
  const planLastSync = useRouteStore((s) => s.lastSync);
  const isOnline = useSyncStore((s) => s.isOnline);
  // Aviso NO bloqueante: solicitudes legacy de recarga/devolución descartadas
  // por la migración de compatibilidad. Se descarta al tocarlo.
  const legacyNoticeCount = useSyncStore((s) => s.legacyMigrationNoticeCount);
  const clearLegacyNotice = useSyncStore((s) => s.clearLegacyMigrationNotice);
  const salesSummary = useSalesStore((s) => s.summary);
  const loadTodaySales = useSalesStore((s) => s.loadTodaySales);
  const products = useProductStore((s) => s.products);
  const productCount = useProductStore((s) => s.productCount);
  const totalStockKg = useProductStore((s) => s.totalStockKg);
  const hasStockData = useProductStore((s) => s.hasStockData);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productsLastSync = useProductStore((s) => s.lastSync);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const loadProductsAuthoritative = useProductStore((s) => s.loadProductsAuthoritative);
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
      // Perf Fase 1C: no re-pedir el plan en cada focus si es reciente (<8s).
      if (shouldRefetchOnFocus(useRouteStore.getState().lastSync, Date.now())) {
        void loadPlan();
      }
      void loadTodaySales();
    }, [isAuthenticated, isOnline, loadPlan, loadTodaySales]),
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
  const pendingTasks = useTasksStore((s) => s.pendingCount);
  const loadTasks = useTasksStore((s) => s.loadTasks);
  // Alert count only — store has no unread flag; never claim "sin leer".
  const alertCount = koldAlerts.length;
  const refreshPlan = useCallback(async () => {
    await Promise.all([
      loadPlan({ force: true }),
      loadTodaySales(),
      employeeId ? loadTasks(employeeId, companyId) : Promise.resolve(),
    ]);
  }, [loadPlan, loadTodaySales, loadTasks, employeeId, companyId]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshPlan);

  useFocusEffect(
    useCallback(() => {
      if (!isAuthenticated || !employeeId) return;
      void loadTasks(employeeId, companyId);
    }, [isAuthenticated, employeeId, companyId, loadTasks]),
  );

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
  // PR-2: criterio compartido con route-start (helper puro reusado).
  const isStandardNoPlan = isStandardNoPlanError(planError);

  // F1.11: CTA "Iniciar operación" con 4 estados para no confundir:
  //  - todas las paradas cerradas → "Cerrar visitas" (liquidación del día)
  //  - ruta ya en marcha (alguna parada en curso/hecha) → "Ver ruta"
  //  - operación lista (checklist+KM+carga) pero sin arrancar → "Continuar a ruta"
  //  - falta algo → "Iniciar operación"
  const routeUnderway = stops.some((s) => s.state === 'in_progress' || s.state === 'done');
  const allStopsDone = stopsTotal > 0 && stopsCompleted >= stopsTotal;
  const opReady = routeStartReadiness.readyToStart;
  const routeStartCta = allStopsDone
    ? { title: 'Cerrar visitas', sub: 'Inventario, liquidación y cierre del día', icon: '🏁', target: '/route-close' as const }
    : routeUnderway
      ? { title: 'Ver ruta', sub: 'Tu recorrido del día', icon: '🗺️', target: '/(tabs)/route' as const }
      : opReady
        ? { title: 'Continuar a ruta', sub: 'Operación lista · revisa tus paradas', icon: '✅', target: '/(tabs)/route' as const }
        : { title: 'Iniciar operación', sub: 'Checklist · KM inicial · Aceptar carga', icon: '🚚', target: '/route-start' as const };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Sync bar */}
      <SyncBar />

      {/* Greeting — Perfil/Ranking viven en tab Yo */}
      <View style={styles.greeting}>
        <GrupoFrioIcon size={30} />
        <View style={{ flex: 1 }}>
          <Text style={styles.greetLabel}>Mi día</Text>
          <Text style={styles.greetName}>{employeeName || 'Vendedor'}</Text>
        </View>
        <TouchableOpacity
          style={styles.settingsBtn}
          onPress={() => router.push('/(tabs)/me' as never)}
          accessibilityLabel="Abrir Yo"
        >
          <Ionicons name="person-outline" size={18} color={colors.text} />
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
        {legacyNoticeCount > 0 ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={clearLegacyNotice}
            accessibilityRole="button"
            accessibilityLabel="Descartar aviso de solicitudes antiguas"
          >
            <AlertBanner
              variant="info"
              icon="ℹ️"
              message={`${legacyMigrationNoticeCopy(legacyNoticeCount).body} (toca para descartar)`}
            />
          </TouchableOpacity>
        ) : null}
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
              onPress={() => { void loadPlan({ force: true }); }}
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
              onPress={() => {
                // BLD-ROUTE-MAP: "Ver ruta" / "Continuar a ruta" abren la
                // pestaña Ruta forzando el mapa (?view=map). "Iniciar
                // operación" va al hub normal.
                if (routeStartCta.target === '/(tabs)/route') {
                  router.push({ pathname: '/(tabs)/route', params: { view: 'map' } } as never);
                } else {
                  router.push(routeStartCta.target as never);
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.routeStartIcon}>{routeStartCta.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.routeStartTitle}>{routeStartCta.title}</Text>
                <Text style={styles.routeStartSub}>{routeStartCta.sub}</Text>
              </View>
              <Text style={styles.routeStartChevron}>›</Text>
            </TouchableOpacity>

            {plan?.plan_id ? (
              <TouchableOpacity
                style={styles.inspectionCta}
                onPress={() => router.push(`/checklist/${plan.plan_id}` as never)}
                activeOpacity={0.85}
              >
                <Text style={styles.routeStartIcon}>🧾</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.routeStartTitle}>Inspección de unidad</Text>
                  <Text style={styles.routeStartSub}>Revisar o actualizar checklist</Text>
                </View>
                <Text style={styles.routeStartChevron}>›</Text>
              </TouchableOpacity>
            ) : null}

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
              loadProductsAuthoritative={loadProductsAuthoritative}
            />

            {/* BLD-20260408-P2: Weather card — no API available yet, show honest placeholder */}
            <View style={styles.weatherCard}>
              <Text style={typography.stateIcon}>🌤️</Text>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.weatherCity}>Clima no disponible</Text>
                <Text style={styles.weatherSub}>Proximamente en KOLD</Text>
              </View>
            </View>

            {/* KPI Grid 2x2 */}
            <View style={styles.kpiGrid}>
              <KPICard
                style={styles.kpiCard}
                label="PARADAS"
                value={`${stopsTotal}`}
                subtitle={`${stopsCompleted} de ${stopsTotal}`}
              />
              <KPICard
                style={styles.kpiCard}
                label="EN CAMIONETA"
                value={formatAuthoritativeStockKg({ hasStockData, totalStockKg })}
                subtitle={
                  hasStockData === true
                    ? `${productCount} productos`
                    : productCount > 0
                      ? 'Stock pendiente de actualizar'
                      : 'catálogo no cargado'
                }
              />
              <KPICard
                style={styles.kpiCard}
                label="VENTA HOY"
                value={formatCurrency(salesSummary.sales_amount_total)}
                subtitle={`${todaySales} pedidos`}
                valueColor={colors.success}
              />
              <KPICard
                style={styles.kpiCard}
                label="FORECAST"
                value="Sin dato"
                subtitle="F5: KoldDemand"
              />
            </View>

            {/* Hub operativo: Tasks/Alerts viven bajo Mi día (no tabs primarias). */}
            <Text style={styles.sectionTitle}>OPERACIÓN</Text>
            <View style={styles.quickGrid}>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => router.push('/(tabs)/tasks' as never)}
                accessibilityLabel={
                  pendingTasks > 0
                    ? `Tareas, ${pendingTasks} pendientes`
                    : 'Tareas'
                }
              >
                <Text style={styles.quickIcon}>✅</Text>
                <Text style={styles.quickLabel}>
                  Tareas{pendingTasks > 0 ? ` (${pendingTasks})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => router.push('/(tabs)/alerts' as never)}
                accessibilityLabel={
                  alertCount > 0
                    ? `Alertas, ${alertCount}`
                    : 'Alertas'
                }
              >
                <Text style={styles.quickIcon}>🔔</Text>
                <Text style={styles.quickLabel}>
                  Alertas{alertCount > 0 ? ` (${alertCount})` : ''}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => router.push('/incident' as never)}
              >
                <Text style={styles.quickIcon}>🚩</Text>
                <Text style={styles.quickLabel}>Incidencia</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => router.push('/refill-accept' as never)}
              >
                <Text style={styles.quickIcon}>🔄</Text>
                <Text style={styles.quickLabel}>Recarga</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => router.push('/presale' as never)}
              >
                <Text style={styles.quickIcon}>📅</Text>
                <Text style={styles.quickLabel}>Preventa</Text>
              </TouchableOpacity>
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
              onPress={() => router.push({ pathname: '/(tabs)/route', params: { view: 'map' } } as never)}
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
  greeting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 6,
  },
  greetLabel: { ...typography.dim },
  greetName: { ...typography.screenTitle },
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
    backgroundColor: colors.primaryAlpha04,
  },
  // BLD-SPRINT-A: CTA "Iniciar operación"
  routeStartCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.card,
    marginBottom: 14,
    backgroundColor: colors.primaryAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(0,119,187,0.3)',
  },
  inspectionCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radii.card,
    marginBottom: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  routeStartIcon: { ...typography.stepperGlyph, fontWeight: '400' },
  routeStartTitle: { ...typography.body, fontFamily: fonts.bodyBold, fontWeight: '700' },
  routeStartSub: { ...typography.dim, marginTop: 2 },
  routeStartChevron: { ...typography.stepperGlyph, color: colors.primary, fontWeight: '300' },
  weatherTemp: { ...typography.kpiValue },
  weatherCity: { ...typography.dimSmall },
  weatherImpact: { ...typography.dim, color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
  weatherSub: { ...typography.dimSmall },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  kpiCard: {
    flexBasis: '48%',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  quickBtn: {
    flexBasis: '48%',
    backgroundColor: colors.card,
    borderRadius: radii.button,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  quickIcon: { ...typography.stepperGlyph, fontWeight: '400' },
  quickLabel: { ...typography.dim, color: colors.text, fontFamily: fonts.bodyBold, fontWeight: '700', textAlign: 'center' },
  sectionTitle: { ...typography.sectionTitle },
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
  mapRouteName: { ...typography.dim, color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
  mapSub: { ...typography.dimSmall, marginTop: 2 },
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
  progressValue: { ...typography.scoreValue },
  progressBar: {
    height: 8,
    backgroundColor: colors.border,
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
  noPlanIcon: { ...typography.stateIcon, marginBottom: 12 },
  noPlanTitle: { ...typography.screenTitle, textAlign: 'center', marginBottom: 10 },
  noPlanBody: {
    ...typography.bodySmall,
    color: colors.textDim,
    lineHeight: 19,
    textAlign: 'center',
    marginBottom: 16,
  },
  noPlanServerMsg: {
    ...typography.dimSmall,
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
  noPlanBtnText: { ...typography.button },
  noPlanHint: { ...typography.dimSmall, marginTop: 8 },
  noPlanFootnote: {
    ...typography.dimSmall,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 12,
    lineHeight: 14,
  },
});
