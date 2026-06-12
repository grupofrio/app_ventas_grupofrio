/**
 * BLD-20260408-P0: Off-route special visit screen.
 * Allows searching for customers or leads not in today's plan.
 *
 * Flow:
 * 1. Driver searches by name / phone / RFC / email
 * 2. Selects a customer or lead from results
 * 3. Virtual stop is created in route store
 * 4. Customers choose location or sale; leads route to prospection
 *
 * Uses Odoo search with authenticated fallback to /get_records.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Alert, RefreshControl, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { colors, spacing, radii } from '../src/theme/tokens';
import { typography } from '../src/theme/typography';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useVisitStore } from '../src/stores/useVisitStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useProductStore } from '../src/stores/useProductStore';
import { useLocationStore } from '../src/stores/useLocationStore';
import { useAsyncRefresh } from '../src/hooks/useAsyncRefresh';
import { OffrouteSearchResult, searchOffrouteEntities } from '../src/services/offrouteSearch';
import { startOffrouteVisit } from '../src/services/gfLogistics';
import { extractOffrouteVisitId } from '../src/services/offrouteVisit';
import { warmOffrouteCustomerPrices } from '../src/services/offroutePricing';
import { computeCustomerPrices } from '../src/services/pricelist';
import { buildStopNavigationUrls } from '../src/services/locationNavigation';
import { isRetryableSyncErrorMessage } from '../src/utils/syncFailure';

const DEFAULT_OFFROUTE_COMPANY_ID = 34;

function offrouteEntityKey(result: OffrouteSearchResult): string {
  const entityId = result.entityType === 'lead'
    ? result.id
    : result.partnerId ?? result.id;
  return `${result.entityType}:${entityId}`;
}

export default function OffRouteScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<OffrouteSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const selectingKeyRef = useRef<string | null>(null);
  const addVirtualStop = useRouteStore((s) => s.addVirtualStop);
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const patchStop = useRouteStore((s) => s.patchStop);
  const isOnline = useSyncStore((s) => s.isOnline);
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const employeeAnalyticPlazaId = useAuthStore((s) => s.employeeAnalyticPlazaId);
  const employeeAnalyticPlazaName = useAuthStore((s) => s.employeeAnalyticPlazaName);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);

  const doSearch = useCallback(async () => {
    const q = search.trim();
    if (q.length < 3) {
      Alert.alert('Busqueda', 'Escribe al menos 3 caracteres');
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const searchResults = await searchOffrouteEntities(q, {
        analyticPlazaId: employeeAnalyticPlazaId,
      });
      setResults(searchResults);
    } catch (error) {
      console.warn('[offroute] Search failed:', error);
      Alert.alert('Error', 'No se pudo buscar clientes o leads. Verifica tu conexion.');
    } finally {
      setIsSearching(false);
    }
  }, [employeeAnalyticPlazaId, search]);
  const refreshSearch = useCallback(async () => {
    const q = search.trim();
    if (!hasSearched || q.length < 3) return;
    await doSearch();
  }, [doSearch, hasSearched, search]);
  const { refreshing, onRefresh } = useAsyncRefresh(refreshSearch);

  async function openSpecialVisitLocation(result: OffrouteSearchResult) {
    const urls = buildStopNavigationUrls({
      customer_name: result.name,
      google_maps_url: result.googleMapsUrl ?? undefined,
      customer_latitude: result.customerLatitude ?? undefined,
      customer_longitude: result.customerLongitude ?? undefined,
    });

    if (!urls.primaryUrl) {
      Alert.alert('Sin ubicacion', 'Este cliente no tiene ubicacion registrada.');
      return;
    }

    try {
      await Linking.openURL(urls.primaryUrl);
    } catch {
      if (urls.fallbackUrl) {
        try {
          await Linking.openURL(urls.fallbackUrl);
          return;
        } catch {
          // Continue to the generic user-facing error below.
        }
      }
      Alert.alert('Error', 'No se pudo abrir la ubicacion.');
    }
  }

  async function handleSelect(result: OffrouteSearchResult) {
    const selectionKey = offrouteEntityKey(result);
    if (selectingKeyRef.current === selectionKey) return;

    selectingKeyRef.current = selectionKey;
    setSelectingKey(selectionKey);

    try {
      let offrouteVisitId: number | null = null;

      if (isOnline) {
        try {
          const visit = await startOffrouteVisit({
            partner_id: result.partnerId ?? null,
            lead_id: result.entityType === 'lead' ? result.id : null,
            company_id: companyId ?? DEFAULT_OFFROUTE_COMPANY_ID,
            latitude,
            longitude,
          });
          offrouteVisitId = extractOffrouteVisitId(
            visit && typeof visit === 'object' ? (visit.id as number | null | undefined) : null,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : 'No se pudo iniciar la visita especial.';
          if (!isRetryableSyncErrorMessage(message)) {
            Alert.alert('Visita especial rechazada', message);
            return;
          }
          Alert.alert(
            'Visita especial local',
            'No se pudo registrar la visita especial en servidor. Continuará solo localmente.',
          );
        }
      }

      const virtualStopId = addVirtualStop(
        result.partnerId ?? result.id,
        result.name,
        {
          entityType: result.entityType,
          leadId: result.entityType === 'lead' ? result.id : null,
          partnerId: result.entityType === 'lead' ? result.partnerId : result.id,
          offrouteVisitId,
          pricelistId: result.pricelistId,
          pricelistName: result.pricelistName,
          customerLatitude: result.customerLatitude,
          customerLongitude: result.customerLongitude,
          googleMapsUrl: result.googleMapsUrl,
        },
      );
      updateStopState(virtualStopId, 'in_progress');

      // Start a visit for this virtual stop
      const visitStore = useVisitStore.getState();
      visitStore.resetVisit();
      visitStore.startVisit(
        {
          id: virtualStopId,
          customer_id: result.partnerId ?? result.id,
          customer_name: result.name,
          state: 'in_progress',
          source_model: 'gf.route.stop',
          _entityType: result.entityType,
          _isOffroute: true,
          _leadId: result.entityType === 'lead' ? result.id : null,
          _partnerId: result.entityType === 'lead' ? result.partnerId : result.id,
          _offrouteVisitId: offrouteVisitId,
          _pricelistId: result.pricelistId,
          _pricelistName: result.pricelistName,
          customer_latitude: result.customerLatitude ?? undefined,
          customer_longitude: result.customerLongitude ?? undefined,
          google_maps_url: result.googleMapsUrl ?? undefined,
        },
        0, 0, // lat/lon — GPS will provide real values if available
      );
      visitStore.setOffrouteVisitId(offrouteVisitId);
      patchStop(virtualStopId, { _offrouteVisitId: offrouteVisitId });

      if (isOnline) {
        const priceWarmup = await warmOffrouteCustomerPrices(
          result,
          { companyId, warehouseId },
          {
            getProducts: () => useProductStore.getState().products,
            loadProducts: (targetWarehouseId) => useProductStore.getState().loadProducts(targetWarehouseId),
            computeCustomerPrices,
          },
        );
        if (priceWarmup.status === 'failed') {
          console.warn('[offroute] Price warmup failed:', priceWarmup.reason);
        }
      }

      // BLD-20260424-BUGC: TODOS los leads pasan por /checkin (igual que
      // customers). Antes, los leads sin partner_id se enrutaban directo
      // a /postvisit, saltándose el check-in y sin permitir al operador
      // elegir "✕ No Venta" cuando el local estaba cerrado o el dueño no
      // se encontraba. /checkin ahora muestra "📋 Datos" Y "✕ No Venta",
      // y el operador decide según la situación real en campo. Si trae
      // los datos del prospecto entra a Datos; si no, registra No Venta
      // y avanza la ruta sin inventar información.
      if (result.entityType === 'lead') {
        router.push(`/checkin/${virtualStopId}` as never);
        return;
      }

      Alert.alert(
        'Visita especial',
        `¿Qué quieres hacer con ${result.name}?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Ir a ubicacion',
            onPress: () => { void openSpecialVisitLocation(result); },
          },
          {
            text: 'Generar venta',
            onPress: () => router.push(`/sale/${virtualStopId}` as never),
          },
        ],
      );
    } finally {
      if (selectingKeyRef.current === selectionKey) {
        selectingKeyRef.current = null;
        setSelectingKey(null);
      }
    }
  }

  function renderCustomer({ item }: { item: OffrouteSearchResult }) {
    const badgeLabel = item.entityType === 'lead' ? 'Lead' : 'Cliente';
    const itemKey = offrouteEntityKey(item);
    const isSelecting = selectingKey === itemKey;

    return (
      <TouchableOpacity
        style={[styles.customerCard, isSelecting && styles.customerCardDisabled]}
        onPress={() => { void handleSelect(item); }}
        disabled={isSelecting}
        activeOpacity={0.7}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.customerName} numberOfLines={1}>{item.name}</Text>
          {item.subtitle ? (
            <Text style={styles.customerSubtitle} numberOfLines={1}>{item.subtitle}</Text>
          ) : null}
          {item.contact ? (
            <Text style={styles.customerContact}>{item.contact}</Text>
          ) : null}
        </View>
        <View style={styles.resultMeta}>
          <Text style={[
            styles.typeBadge,
            item.entityType === 'lead' ? styles.typeBadgeLead : styles.typeBadgeCustomer,
          ]}>
            {badgeLabel}
          </Text>
          {isSelecting ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.selectArrow}>{'>'}</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Visita Especial" showBack />

      <View style={styles.content}>
        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar cliente o lead por nombre, teléfono, RFC o correo..."
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={doSearch}
          />
          <TouchableOpacity
            style={styles.searchBtn}
            onPress={doSearch}
            disabled={isSearching}
          >
            <Text style={styles.searchBtnText}>
              {isSearching ? '...' : 'Buscar'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Info */}
        <Text style={styles.infoText}>
          Busca clientes o leads fuera de tu ruta. Cliente permite ubicacion o venta; lead abre prospección.
        </Text>
        {employeeAnalyticPlazaName ? (
          <Text style={styles.scopeText}>
            Filtro activo: {employeeAnalyticPlazaName}
          </Text>
        ) : null}

        {/* Results */}
        {isSearching ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[typography.dim, { marginTop: 10 }]}>Buscando...</Text>
          </View>
        ) : (
          <FlatList
            data={results}
            renderItem={renderCustomer}
            keyExtractor={(c) => String(c.id)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
              />
            }
            ListEmptyComponent={
              hasSearched ? (
                <View style={styles.emptyCard}>
                  <Text style={{ fontSize: 32, marginBottom: 8 }}>🔍</Text>
                  <Text style={typography.dim}>
                    Sin resultados para "{search}"
                  </Text>
                  <Text style={[typography.dim, { fontSize: 11, marginTop: 4 }]}>
                    Verifica el nombre o prueba con telefono, RFC o correo
                  </Text>
                </View>
              ) : null
            }
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, paddingHorizontal: spacing.screenPadding },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchRow: {
    flexDirection: 'row', gap: 8, marginBottom: 8, marginTop: 4,
  },
  searchInput: {
    flex: 1,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 14,
  },
  searchBtn: {
    backgroundColor: colors.primary, borderRadius: radii.button,
    paddingHorizontal: 18, justifyContent: 'center',
  },
  searchBtnText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  infoText: {
    fontSize: 11, color: colors.textDim, marginBottom: 12,
    lineHeight: 16,
  },
  scopeText: {
    fontSize: 11,
    color: colors.primary,
    marginBottom: 10,
    fontWeight: '600',
  },
  list: { paddingBottom: 80 },
  customerCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 14, marginBottom: 8,
    borderLeftWidth: 3, borderLeftColor: colors.primary,
  },
  customerCardDisabled: {
    opacity: 0.65,
  },
  customerName: { fontSize: 14, fontWeight: '700', color: colors.text },
  customerSubtitle: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  customerContact: { fontSize: 11, color: colors.primary, marginTop: 2 },
  resultMeta: { alignItems: 'flex-end', gap: 8, marginLeft: 8 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 10,
    fontWeight: '700',
    overflow: 'hidden',
  },
  typeBadgeCustomer: {
    backgroundColor: colors.primaryAlpha12,
    color: colors.primary,
  },
  typeBadgeLead: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    color: '#B45309',
  },
  selectArrow: { fontSize: 18, color: colors.textDim, marginLeft: 8 },
  emptyCard: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 30, alignItems: 'center', marginTop: 20,
  },
});
