/**
 * RouteActionsMenu — bottom modal with GENERAL route actions (not tied to a
 * specific client): venta especial / fuera de ruta, recarga, incidente,
 * cerrar ruta, reportes. Plus an optional "Ver como lista" toggle.
 *
 * Uses RN's built-in Modal (no extra dependency). Driven by the shared
 * ROUTE_GENERAL_ACTIONS catalog so map and list stay in sync.
 */

import React from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { colors, radii, spacing } from '../../theme/tokens';
import { ROUTE_GENERAL_ACTIONS } from '../../services/routeActions';

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigateRoute: (route: string) => void;
  /** Optional: switch the route screen to the list view. */
  onShowList?: () => void;
}

export function RouteActionsMenu({ visible, onClose, onNavigateRoute, onShowList }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.grabber} />
          <Text style={styles.title}>Acciones de ruta</Text>
          <Text style={styles.subtitle}>Funciones de la jornada (no de un cliente)</Text>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 8 }}>
            {ROUTE_GENERAL_ACTIONS.map((action) => (
              <TouchableOpacity
                key={action.key}
                style={styles.item}
                activeOpacity={0.7}
                onPress={() => { onClose(); onNavigateRoute(action.route); }}
              >
                <Text style={styles.itemText}>{action.label}</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            ))}

            {onShowList && (
              <TouchableOpacity
                style={[styles.item, styles.itemAlt]}
                activeOpacity={0.7}
                onPress={() => { onClose(); onShowList(); }}
              >
                <Text style={styles.itemText}>☰ Ver como lista</Text>
                <Text style={styles.chevron}>›</Text>
              </TouchableOpacity>
            )}
          </ScrollView>

          <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingHorizontal: spacing.screenPadding, paddingTop: 8, paddingBottom: 24, maxHeight: '80%',
    borderTopWidth: 1, borderColor: colors.border,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 },
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textDim, marginTop: 2, marginBottom: 10 },
  list: { flexGrow: 0 },
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 14, paddingHorizontal: 14, backgroundColor: colors.card,
    borderRadius: radii.button, marginBottom: 8, minHeight: 52,
  },
  itemAlt: { backgroundColor: 'rgba(37,99,235,0.06)', borderWidth: 1, borderColor: colors.border },
  itemText: { fontSize: 15, fontWeight: '600', color: colors.text },
  chevron: { fontSize: 22, color: colors.primary, fontWeight: '300' },
  cancel: { marginTop: 4, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '700', color: colors.textDim },
});
