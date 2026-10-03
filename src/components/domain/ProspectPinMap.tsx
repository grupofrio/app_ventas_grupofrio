/**
 * Map the seller uses to leave or drag the prospect pin.
 * The coordinate is only whatever the parent already accepted as the pin
 * or the camera center. This component never writes GPS by itself.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { colors, radii } from '../../theme/tokens';
import { typography } from '../../theme/typography';

export interface MapCoordinate {
  latitude: number;
  longitude: number;
}

interface ProspectPinMapProps {
  /** Camera center when the seller has not placed a pin yet. */
  center: MapCoordinate | null;
  /** Pin the seller is looking at. Null until they place one. */
  pin: MapCoordinate | null;
  onPinMoved: (pin: MapCoordinate) => void;
  /** Bumps when the seller asks to recenter on their current location. */
  focusToken?: number;
}

function regionFor(point: MapCoordinate): Region {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    latitudeDelta: 0.004,
    longitudeDelta: 0.004,
  };
}

export function ProspectPinMap({
  center,
  pin,
  onPinMoved,
  focusToken = 0,
}: ProspectPinMapProps) {
  const mapRef = useRef<MapView | null>(null);
  const target = pin ?? center;

  useEffect(() => {
    if (!center || focusToken === 0) return;
    const map = mapRef.current as (MapView & {
      animateToRegion?: (region: Region, duration: number) => void;
    }) | null;
    map?.animateToRegion?.(regionFor(center), 250);
  }, [center, focusToken]);

  if (!target) {
    return (
      <View style={styles.pending}>
        <Text style={[typography.bodySmall, styles.pendingText]}>
          Obteniendo tu ubicación para centrar el mapa…
        </Text>
      </View>
    );
  }

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      provider={PROVIDER_GOOGLE}
      initialRegion={regionFor(target)}
      showsUserLocation
    >
      <Marker
        coordinate={target}
        draggable
        onDragEnd={(event) => {
          const next = event.nativeEvent.coordinate;
          if (typeof next?.latitude !== 'number' || typeof next?.longitude !== 'number') return;
          onPinMoved({ latitude: next.latitude, longitude: next.longitude });
        }}
      />
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: {
    height: 240,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  pending: {
    height: 240,
    borderRadius: radii.button,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  pendingText: {
    color: colors.textDim,
    textAlign: 'center',
  },
});
