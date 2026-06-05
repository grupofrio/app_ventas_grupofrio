/**
 * Sync status bar — shown at top of Home.
 * Green: online, Yellow: offline with pending, Orange: syncing.
 * From KOLD_FIELD_SPEC.md section 6.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import { hasUserVisibleSyncing, useSyncStore } from '../../stores/useSyncStore';

export function SyncBar() {
  const { isOnline, pendingCount, queue } = useSyncStore();
  const isSyncing = hasUserVisibleSyncing(queue);

  if (isSyncing) {
    return (
      <View style={[styles.bar, styles.syncing]}>
        <Text style={styles.text}>🔄 Sincronizando...</Text>
      </View>
    );
  }

  if (!isOnline) {
    return (
      <View style={[styles.bar, styles.offline]}>
        <Text style={styles.text}>
          🟡 Sin conexion · {pendingCount} operacion{pendingCount !== 1 ? 'es' : ''} en cola
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.bar, styles.online]}>
      <Text style={styles.text}>🟢 En linea · Datos sincronizados</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: spacing.screenPadding,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radii.button,
    marginBottom: spacing.cardGap,
    alignItems: 'center',
  },
  online: {
    backgroundColor: colors.successAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.15)',
  },
  offline: {
    backgroundColor: colors.warningAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.15)',
  },
  syncing: {
    backgroundColor: colors.primaryAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(37,99,235,0.15)',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
});
