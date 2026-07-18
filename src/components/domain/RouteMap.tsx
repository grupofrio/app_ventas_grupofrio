/**
 * RouteMap — shared Google map of the route's stops.
 *
 * Renders numbered, state-colored markers + an ordered polyline + the user
 * location. The selected stop gets a larger, highlighted marker. Tapping a
 * marker calls onSelectStop. A ref exposes fitAll()/centerOn() so the parent
 * can drive the camera. Requires a dev/prebuild client (react-native-maps).
 *
 * Perf notes:
 *   - StopMarker is React.memo'd: markers only re-render when stop data or
 *     selection state changes, not on every GPS tick.
 *   - tracksViewChanges={false} prevents native re-measure on every frame.
 *   - initialRegion depends only on `located` (GPS coords don't affect it
 *     after mount since MapView ignores initialRegion changes post-mount).
 */

import React, { forwardRef, useImperativeHandle, useMemo, useRef, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import type { GFStop } from '../../types/plan';
import { orderedStops, splitStopsByLocation, stopStatusMeta } from '../../services/routeMapLogic';
import { colors } from '../../theme/tokens';

export interface RouteMapHandle {
  fitAll: () => void;
  centerOn: (lat: number, lon: number) => void;
}

interface LatLng { latitude: number; longitude: number }

interface Props {
  stops: GFStop[];
  selectedStopId: number | null;
  userLat: number | null;
  userLon: number | null;
  onSelectStop: (stop: GFStop) => void;
  navigationActive?: boolean;
  navigationTargetLat?: number | null;
  navigationTargetLon?: number | null;
  /** Road-following polyline from Directions API. When populated replaces the straight line. */
  navigationRouteCoords?: LatLng[];
}

// ── StopMarker ──────────────────────────────────────────────────────────────
// Extracted as React.memo so it only re-renders when its own stop data or
// selection state changes — not on every GPS update of the parent.
interface StopMarkerProps {
  stop: GFStop;
  selected: boolean;
  onPress: (stop: GFStop) => void;
}

const StopMarker = React.memo(function StopMarker({ stop, selected, onPress }: StopMarkerProps) {
  const meta = stopStatusMeta(stop.state);
  const handlePress = useCallback(() => onPress(stop), [onPress, stop]);
  return (
    <Marker
      coordinate={{ latitude: stop.customer_latitude!, longitude: stop.customer_longitude! }}
      onPress={handlePress}
      tracksViewChanges={false}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={selected ? 999 : undefined}
    >
      <View style={[styles.marker, { backgroundColor: meta.color }, selected && styles.markerSelected]}>
        <Text style={styles.markerText}>{stop.route_sequence ?? '•'}</Text>
      </View>
    </Marker>
  );
});

// ── Helpers ─────────────────────────────────────────────────────────────────
const GDL = { latitude: 20.6597, longitude: -103.3496 };

function regionForStops(located: GFStop[]): Region {
  if (located.length === 0) {
    return { latitude: GDL.latitude, longitude: GDL.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  }
  const lats = located.map((s) => s.customer_latitude!);
  const lngs = located.map((s) => s.customer_longitude!);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.4),
  };
}

// ── RouteMap ─────────────────────────────────────────────────────────────────
export const RouteMap = forwardRef<RouteMapHandle, Props>(function RouteMap(
  { stops, selectedStopId, userLat, userLon, onSelectStop,
    navigationActive, navigationTargetLat, navigationTargetLon, navigationRouteCoords },
  ref,
) {
  const mapRef = useRef<MapView | null>(null);

  const { located } = useMemo(() => splitStopsByLocation(stops), [stops]);

  // initialRegion only matters on first mount — MapView ignores changes after mount.
  // Depend only on `located` so GPS updates don't trigger a recompute.
  const initialRegion = useMemo(() => regionForStops(located), [located]);

  const polylineCoords = useMemo(
    () => orderedStops(located).map((s) => ({
      latitude: s.customer_latitude!, longitude: s.customer_longitude!,
    })),
    [located],
  );

  useImperativeHandle(ref, () => ({
    fitAll: () => {
      if (located.length === 0) return;
      mapRef.current?.fitToCoordinates(
        located.map((s) => ({ latitude: s.customer_latitude!, longitude: s.customer_longitude! })),
        { edgePadding: { top: 80, right: 60, bottom: 260, left: 60 }, animated: true },
      );
    },
    centerOn: (lat: number, lon: number) => {
      mapRef.current?.animateToRegion(
        { latitude: lat, longitude: lon, latitudeDelta: 0.012, longitudeDelta: 0.012 },
        350,
      );
    },
  }), [located]);

  // Memoize markers: only re-create when stops data or selection changes,
  // not on GPS ticks (userLat/userLon not in deps).
  const markers = useMemo(
    () => located.map((stop) => (
      <StopMarker
        key={stop.id}
        stop={stop}
        selected={stop.id === selectedStopId}
        onPress={onSelectStop}
      />
    )),
    [located, selectedStopId, onSelectStop],
  );

  const hasRoadRoute = navigationActive && navigationRouteCoords && navigationRouteCoords.length > 1;
  const hasFallbackLine = navigationActive && !hasRoadRoute
    && userLat != null && userLon != null
    && navigationTargetLat != null && navigationTargetLon != null;

  // La polyline punteada conecta las paradas en orden de visita — NO es una
  // ruta navegable por calles. Mostramos una aclaración cuando esa línea recta
  // es lo único visible (sin ruta por calles real), para no confundir al
  // operador. Si hay road route (Directions), esa sí es ruta y no se aclara.
  const showOrderLegend = polylineCoords.length > 1 && !hasRoadRoute;

  return (
    <>
    <MapView
      ref={(r) => { mapRef.current = r; }}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={initialRegion}
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass
      toolbarEnabled={false}
      mapType="standard"
    >
      {polylineCoords.length > 1 && (
        <Polyline
          coordinates={polylineCoords}
          strokeColor={navigationActive ? 'rgba(37,99,235,0.18)' : 'rgba(37,99,235,0.55)'}
          strokeWidth={3}
          lineDashPattern={[10, 5]}
        />
      )}

      {hasRoadRoute && (
        <Polyline
          coordinates={navigationRouteCoords!}
          strokeColor="#2563EB"
          strokeWidth={5}
        />
      )}

      {hasFallbackLine && (
        <Polyline
          coordinates={[
            { latitude: userLat!, longitude: userLon! },
            { latitude: navigationTargetLat!, longitude: navigationTargetLon! },
          ]}
          strokeColor="#2563EB"
          strokeWidth={4}
          lineDashPattern={[8, 4]}
        />
      )}

      {markers}
    </MapView>
    {showOrderLegend && (
      <View style={styles.orderLegend} pointerEvents="none">
        <Text style={styles.orderLegendText}>
          Línea punteada = orden de visita · no es ruta por calles
        </Text>
      </View>
    )}
    </>
  );
});

const styles = StyleSheet.create({
  marker: {
    minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#FFFFFF',
  },
  markerSelected: {
    minWidth: 34, height: 34, borderRadius: 17,
    borderColor: colors.text, borderWidth: 3,
  },
  markerText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  orderLegend: {
    position: 'absolute', top: 10, alignSelf: 'center',
    backgroundColor: 'rgba(15,20,25,0.82)', paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 14, maxWidth: '92%',
  },
  orderLegendText: { color: '#FFFFFF', fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
