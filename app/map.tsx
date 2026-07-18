/**
 * V1.3 Route Map — Google Maps real with stops, status, and navigation.
 * Requires expo prebuild (react-native-maps).
 */

import React, { useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { TopBar } from '../src/components/ui/TopBar';
import { buildStopNavigationUrls } from '../src/services/locationNavigation';
import { useRouteStore } from '../src/stores/useRouteStore';
import { useLocationStore } from '../src/stores/useLocationStore';
import { colors, spacing, radii } from '../src/theme/tokens';
import type { GFStop, StopState } from '../src/types/plan';

const STATUS_COLORS: Record<StopState, string> = {
  pending: '#8B95A3',
  in_progress: '#2563EB',
  done: '#22C55E',
  not_visited: '#EF4444',
  no_stock: '#F59E0B',
  rejected: '#EF4444',
  closed: '#6B7280',
};

const STATUS_LABELS: Record<StopState, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Visitado',
  not_visited: 'Sin visita',
  no_stock: 'Sin stock',
  rejected: 'Rechazado',
  closed: 'Cerrado',
};

export default function MapScreen() {
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const lat = useLocationStore((s) => s.latitude);
  const lon = useLocationStore((s) => s.longitude);

  // Stops with coordinates
  const stopsWithCoords = useMemo(() =>
    stops.filter((s) => s.customer_latitude && s.customer_longitude),
  [stops]);

  // Map region to fit all stops
  const region = useMemo(() => {
    if (stopsWithCoords.length === 0) {
      return {
        latitude: lat || 20.6597,
        longitude: lon || -103.3496,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }
    const lats = stopsWithCoords.map((s) => s.customer_latitude!);
    const lngs = stopsWithCoords.map((s) => s.customer_longitude!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.3),
      longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.3),
    };
  }, [stopsWithCoords, lat, lon]);

  // Route polyline
  const routeCoords = useMemo(() =>
    stopsWithCoords
      .sort((a, b) => (a.route_sequence || 0) - (b.route_sequence || 0))
      .map((s) => ({ latitude: s.customer_latitude!, longitude: s.customer_longitude! })),
  [stopsWithCoords]);

  // Navigate to external maps — unificado con el helper compartido
  // (buildStopNavigationUrls): geo → dirección textual → null controlado. Antes
  // este archivo duplicaba URIs nativas y no tenía fallback por dirección.
  const openNavigation = useCallback((stop: GFStop) => {
    const { primaryUrl, fallbackUrl } = buildStopNavigationUrls(stop);
    if (!primaryUrl) {
      Alert.alert('Sin ubicación', 'Esta parada no tiene dirección ni coordenadas registradas.');
      return;
    }
    Linking.openURL(primaryUrl).catch(() => {
      if (fallbackUrl) {
        Linking.openURL(fallbackUrl).catch(() =>
          Alert.alert('No se pudo abrir', 'No se pudo abrir la ubicación en Maps.'),
        );
      } else {
        Alert.alert('No se pudo abrir', 'No se pudo abrir la ubicación en Maps.');
      }
    });
  }, []);

  // P0-4 (hardening): NO abrir venta directa desde el mapa. Se enruta al hub del
  // cliente (/stop/[id]) que conserva check-in + geocerca + guards de visita.
  const openClient = useCallback((stop: GFStop) => {
    router.push(`/stop/${stop.id}` as never);
  }, [router]);

  const promptStopAction = useCallback((stop: GFStop) => {
    Alert.alert(
      stop.customer_name,
      '¿Qué quieres hacer con este cliente?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Abrir Maps', onPress: () => openNavigation(stop) },
        { text: 'Abrir cliente', onPress: () => openClient(stop) },
      ],
    );
  }, [openNavigation, openClient]);

  const visited = stops.filter((s) => s.state === 'done').length;
  const pending = stops.filter((s) => s.state === 'pending').length;
  const noCoords = stops.length - stopsWithCoords.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="🗺️ Mapa de Ruta" showBack />

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{stops.length}</Text>
          <Text style={styles.statLabel}>Paradas</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: '#22C55E' }]}>{visited}</Text>
          <Text style={styles.statLabel}>Visitadas</Text>
        </View>
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: colors.primary }]}>{pending}</Text>
          <Text style={styles.statLabel}>Pendientes</Text>
        </View>
        {noCoords > 0 && (
          <View style={styles.stat}>
            <Text style={[styles.statNum, { color: '#EF4444' }]}>{noCoords}</Text>
            <Text style={styles.statLabel}>Sin GPS</Text>
          </View>
        )}
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={region}
          showsUserLocation
          showsMyLocationButton
          showsCompass
          toolbarEnabled
          mapType="standard"
        >
          {routeCoords.length > 1 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor="rgba(37,99,235,0.6)"
              strokeWidth={3}
              lineDashPattern={[10, 5]}
            />
          )}
          {stopsWithCoords.map((stop) => (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.customer_latitude!, longitude: stop.customer_longitude! }}
              title={`#${stop.route_sequence || '?'} ${stop.customer_name}`}
              description={STATUS_LABELS[stop.state] || stop.state}
              pinColor={STATUS_COLORS[stop.state] || '#8B95A3'}
              onPress={() => promptStopAction(stop)}
              onCalloutPress={() => promptStopAction(stop)}
            />
          ))}
        </MapView>
      </View>

      {/* Legend */}
      <View style={styles.legend}>
        {(['pending', 'in_progress', 'done', 'not_visited'] as StopState[]).map((key) => (
          <View key={key} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: STATUS_COLORS[key] }]} />
            <Text style={styles.legendText}>{STATUS_LABELS[key]}</Text>
          </View>
        ))}
        {routeCoords.length > 1 && (
          <Text style={styles.legendCaption}>
            Línea punteada = orden de visita · no es ruta por calles
          </Text>
        )}
      </View>

      {/* Navigate to next pending */}
      {(() => {
        const next = stopsWithCoords
          .filter((s) => s.state === 'pending')
          .sort((a, b) => (a.route_sequence || 0) - (b.route_sequence || 0))[0];
        if (!next) return null;
        return (
          <View style={styles.actionsWrap}>
            <TouchableOpacity style={styles.saleButton} onPress={() => openClient(next)} activeOpacity={0.8}>
              <Text style={styles.saleButtonText}>
                🧾 Abrir #{next.route_sequence} {next.customer_name}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.mapsButton} onPress={() => openNavigation(next)} activeOpacity={0.8}>
              <Text style={styles.mapsButtonText}>
                📍 Ir a #{next.route_sequence} {next.customer_name}
              </Text>
            </TouchableOpacity>
          </View>
        );
      })()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  statsBar: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingVertical: 10, paddingHorizontal: spacing.screenPadding,
    backgroundColor: colors.card,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  stat: { alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textDim, marginTop: 2 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  legend: {
    flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap',
    paddingVertical: 8, paddingHorizontal: spacing.screenPadding,
    backgroundColor: colors.card,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 8, marginVertical: 2 },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { fontSize: 10, color: colors.textDim },
  legendCaption: {
    width: '100%', textAlign: 'center', fontSize: 10, color: colors.textDim,
    fontStyle: 'italic', marginTop: 4,
  },
  actionsWrap: {
    gap: 8,
    marginBottom: 16,
    marginHorizontal: spacing.screenPadding,
  },
  saleButton: {
    backgroundColor: colors.primary,
    paddingVertical: 14, borderRadius: radii.button, alignItems: 'center',
  },
  mapsButton: {
    backgroundColor: colors.cardLighter,
    paddingVertical: 14, borderRadius: radii.button, alignItems: 'center',
  },
  saleButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  mapsButtonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
});
