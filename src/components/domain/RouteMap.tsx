/**
 * RouteMap — shared Google map of the route's stops.
 *
 * Renders numbered, state-colored markers + an ordered polyline + the user
 * location. The selected stop gets a larger, highlighted marker. Tapping a
 * marker calls onSelectStop. A ref exposes fitAll()/centerOn() so the parent
 * can drive the camera. Requires a dev/prebuild client (react-native-maps).
 */

import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
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

const GDL = { latitude: 20.6597, longitude: -103.3496 }; // sensible default region

function regionForStops(located: GFStop[], userLat: number | null, userLon: number | null): Region {
  if (located.length === 0) {
    return {
      latitude: userLat ?? GDL.latitude,
      longitude: userLon ?? GDL.longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
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

export const RouteMap = forwardRef<RouteMapHandle, Props>(function RouteMap(
  { stops, selectedStopId, userLat, userLon, onSelectStop, navigationActive, navigationTargetLat, navigationTargetLon, navigationRouteCoords }, ref,
) {
  const mapRef = useRef<MapView | null>(null);

  const { located } = useMemo(() => splitStopsByLocation(stops), [stops]);
  const initialRegion = useMemo(() => regionForStops(located, userLat, userLon), [located, userLat, userLon]);

  const polyline = useMemo(
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
        400,
      );
    },
  }), [located]);

  return (
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
      {polyline.length > 1 && (
        <Polyline
          coordinates={polyline}
          strokeColor={navigationActive ? 'rgba(37,99,235,0.2)' : 'rgba(37,99,235,0.55)'}
          strokeWidth={3}
          lineDashPattern={[10, 5]}
        />
      )}
      {navigationActive && navigationRouteCoords && navigationRouteCoords.length > 1 && (
        <Polyline
          coordinates={navigationRouteCoords}
          strokeColor="#2563EB"
          strokeWidth={5}
        />
      )}
      {navigationActive && (!navigationRouteCoords || navigationRouteCoords.length === 0) &&
        userLat != null && userLon != null && navigationTargetLat != null && navigationTargetLon != null && (
        <Polyline
          coordinates={[
            { latitude: userLat, longitude: userLon },
            { latitude: navigationTargetLat, longitude: navigationTargetLon },
          ]}
          strokeColor="#2563EB"
          strokeWidth={4}
          lineDashPattern={[8, 4]}
        />
      )}
      {located.map((stop) => {
        const meta = stopStatusMeta(stop.state);
        const selected = stop.id === selectedStopId;
        return (
          <Marker
            key={stop.id}
            coordinate={{ latitude: stop.customer_latitude!, longitude: stop.customer_longitude! }}
            onPress={() => onSelectStop(stop)}
            tracksViewChanges={false}
            anchor={{ x: 0.5, y: 0.5 }}
            zIndex={selected ? 999 : undefined}
          >
            <View
              style={[
                styles.marker,
                { backgroundColor: meta.color },
                selected && styles.markerSelected,
              ]}
            >
              <Text style={styles.markerText}>{stop.route_sequence ?? '•'}</Text>
            </View>
          </Marker>
        );
      })}
    </MapView>
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
});
