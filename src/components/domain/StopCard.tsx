/**
 * StopCard — route stop card matching mockup .sc2 class.
 * border-left 4px colored by state, customer name, badges, score ring.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { GFStop } from '../../types/plan';
import { Badge } from '../ui/Badge';
import { ScoreRing } from '../ui/ScoreRing';
import { colors, radii, stopStateColors } from '../../theme/tokens';
import { typography } from '../../theme/typography';
import { getStopTypeLabel } from '../../services/routePresentation';
import { formatCustomerAddress } from '../../services/formatCustomerAddress';

interface StopCardProps {
  stop: GFStop;
  index: number;
}

const stateLabels: Record<string, string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  done: 'Completada',
  not_visited: 'No visitado',
  no_stock: 'Sin stock',
  rejected: 'Rechazada',
  closed: 'Cerrada',
};

const stateBadgeVariant: Record<string, 'dim' | 'orange' | 'green' | 'red'> = {
  pending: 'dim',
  in_progress: 'orange',
  done: 'green',
  not_visited: 'red',
  no_stock: 'red',
  rejected: 'red',
  closed: 'dim',
};

export function StopCard({ stop, index }: StopCardProps) {
  const router = useRouter();
  const borderColor = stopStateColors[stop.state] || colors.textDim;
  const isDone = ['done', 'not_visited', 'no_stock', 'rejected', 'closed'].includes(stop.state);
  const stopTypeLabel = getStopTypeLabel(stop);
  const address = formatCustomerAddress(stop, stop);

  return (
    <TouchableOpacity
      style={[
        styles.card,
        { borderLeftColor: borderColor },
        isDone && styles.cardDone,
        stop.state === 'in_progress' && styles.cardActive,
      ]}
      activeOpacity={0.7}
      onPress={() => router.push(`/stop/${stop.id}`)}
    >
      <View style={styles.row}>
        {/* Left: index + customer info */}
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.index}>{index + 1}</Text>
            <Text style={typography.bodySmall} numberOfLines={1}>
              {stop.customer_name}
            </Text>
          </View>
          <Text
            style={[typography.dimSmall, !address.hasAddress && styles.addressMuted]}
            numberOfLines={1}
          >
            📍 {address.text}
          </Text>
          <View style={styles.badges}>
            <Badge
              label={stateLabels[stop.state] || stop.state}
              variant={stateBadgeVariant[stop.state] || 'dim'}
            />
            {stop._geoFenceOk !== undefined && (
              <Badge
                label={stop._geoFenceOk ? '📍 OK' : '📍 Lejos'}
                variant={stop._geoFenceOk ? 'green' : 'red'}
              />
            )}
            {stopTypeLabel && (
              <Badge
                label={stopTypeLabel}
                variant={stop._entityType === 'lead' ? 'orange' : 'dim'}
              />
            )}
          </View>
          {stop._koldForecast && (
            <Text style={typography.dimSmall}>
              📦 {stop._koldForecast.predicted_kg.toFixed(0)} kg estimados
            </Text>
          )}
        </View>

        {/* Right: score ring */}
        {stop._koldScore ? (
          <ScoreRing
            score={stop._koldScore.score_master}
            size={42}
          />
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  cardDone: {
    opacity: 0.65,
  },
  cardActive: {
    backgroundColor: 'rgba(37,99,235,0.03)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  info: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  index: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
    width: 18,
  },
  badges: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  addressMuted: {
    fontStyle: 'italic',
    opacity: 0.7,
  },
});
