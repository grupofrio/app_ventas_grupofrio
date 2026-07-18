/**
 * RouteStopPanel — bottom panel for the map-first route screen.
 *
 * Two modes (simple View, no bottom-sheet dependency):
 *   - peek: progress chip + selected/next stop + primary actions
 *   - expanded: scrollable ordered list (tap to select) + "sin ubicación"
 *     section + route actions (Recarga / Incidente / Cerrar ruta)
 *
 * Presentational: route.tsx owns state and passes data + callbacks.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { GFStop } from '../../types/plan';
import { colors, radii, spacing, stopStateColors } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { stopStatusMeta, formatDistance, RouteProgress } from '../../services/routeMapLogic';
import { formatCustomerAddress } from '../../services/formatCustomerAddress';

interface Props {
  progress: RouteProgress;
  selectedStop: GFStop | null;
  nextStop: GFStop | null;
  distanceMeters: number | null;
  orderedStops: GFStop[];
  unlocatedStops: GFStop[];
  expanded: boolean;
  onToggleExpand: () => void;
  onSelectStop: (stop: GFStop) => void;
  onNavigate: (stop: GFStop) => void;
  /** Opens the FULL client hub (/stop/[id]) — same flow as the list. */
  onOpenClient: (stop: GFStop) => void;
  /** Route-level close, shown ONLY in the "ruta completada" state. */
  onCloseRoute: () => void;
  navigationActive: boolean;
  onStartNavigation: () => void;
  onStopNavigation: () => void;
}

export function RouteStopPanel(props: Props) {
  const {
    progress, selectedStop, nextStop, distanceMeters, orderedStops, unlocatedStops,
    expanded, onToggleExpand, onSelectStop, onNavigate, onOpenClient, onCloseRoute,
    navigationActive, onStartNavigation, onStopNavigation,
  } = props;

  // The focused stop is the user-selected one, else the next recommended.
  const focus = selectedStop ?? nextStop;
  const focusMeta = focus ? stopStatusMeta(focus.state) : null;
  const dist = formatDistance(distanceMeters);
  const focusAddress = focus ? formatCustomerAddress(focus, focus) : null;

  return (
    <View style={styles.wrap}>
      {/* Drag handle / progress chip — tap to expand/collapse */}
      <TouchableOpacity style={styles.header} onPress={onToggleExpand} activeOpacity={0.8}>
        <View style={styles.grabber} />
        <View style={styles.headerRow}>
          <Text style={styles.progressText}>
            {progress.visited}/{progress.total} visitados · {progress.pct}%
          </Text>
          <Text style={styles.expandHint}>{expanded ? 'Ocultar ▾' : 'Ver paradas ▴'}</Text>
        </View>
      </TouchableOpacity>

      {progress.completed ? (
        <View style={styles.completedBox}>
          <Text style={styles.completedTitle}>🎉 Ruta completada</Text>
          <Text style={styles.completedBody}>Visitaste todas tus paradas del día.</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onCloseRoute} activeOpacity={0.85}>
            <Text style={styles.closeBtnText}>🏁 Cerrar ruta</Text>
          </TouchableOpacity>
        </View>
      ) : focus ? (
        <View style={styles.focusBox}>
          <View style={styles.focusHeader}>
            <View style={[styles.seqDot, { backgroundColor: focusMeta?.color }]}>
              <Text style={styles.seqDotText}>{focus.route_sequence ?? '•'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.focusName} numberOfLines={1}>{focus.customer_name}</Text>
              {focusAddress && (
                <Text
                  style={[styles.focusAddress, !focusAddress.hasAddress && styles.focusAddressMuted]}
                  numberOfLines={2}
                >
                  📍 {focusAddress.text}
                </Text>
              )}
              <Text style={styles.focusMeta}>
                {navigationActive ? '🧭 Navegando' : selectedStop ? 'Seleccionado' : 'Siguiente'} · {focusMeta?.label}
                {dist ? ` · ${dist}` : ''}
              </Text>
            </View>
          </View>
          {/* Primary action: open the FULL client hub (check-in geocercado,
              venta, no venta, regalo, datos, lealtad). Navegar es secundario.
              No se exponen venta/no-venta directos aquí para no saltarse el
              check-in/geocerca del flujo real. */}
          <TouchableOpacity style={styles.openClientBtn} onPress={() => onOpenClient(focus)} activeOpacity={0.85}>
            <Text style={styles.openClientText}>👤 Abrir cliente</Text>
          </TouchableOpacity>
          <View style={styles.actionRow}>
            {/* Navegación EXTERNA (Google Maps): conecta la prop onNavigate, que
                antes estaba muerta. Es la opción que sí sirve para navegar en
                calle. "Iniciar navegación" es la traza interna (referencia). */}
            <PanelButton label="📍 Maps" onPress={() => onNavigate(focus)} />
            {navigationActive ? (
              <PanelButton label="⏹ Detener" onPress={onStopNavigation} active />
            ) : (
              <PanelButton label="🧭 Iniciar navegación" onPress={onStartNavigation} />
            )}
          </View>
        </View>
      ) : (
        <View style={styles.focusBox}>
          <Text style={styles.focusMeta}>Sin cliente seleccionado.</Text>
        </View>
      )}

      {expanded && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          <Text style={styles.sectionTitle}>PARADAS ({orderedStops.length})</Text>
          {orderedStops.map((stop) => {
            const meta = stopStatusMeta(stop.state);
            const isFocus = focus?.id === stop.id;
            return (
              <TouchableOpacity
                key={stop.id}
                style={[styles.listRow, isFocus && styles.listRowOn, { borderLeftColor: stopStateColors[stop.state] || colors.textDim }]}
                onPress={() => onSelectStop(stop)}
                activeOpacity={0.7}
              >
                <View style={[styles.seqDotSm, { backgroundColor: meta.color }]}>
                  <Text style={styles.seqDotSmText}>{stop.route_sequence ?? '•'}</Text>
                </View>
                <Text style={styles.listName} numberOfLines={1}>{stop.customer_name}</Text>
                <Text style={[styles.listState, { color: meta.color }]}>{meta.label}</Text>
              </TouchableOpacity>
            );
          })}

          {unlocatedStops.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>SIN UBICACIÓN ({unlocatedStops.length})</Text>
              {unlocatedStops.map((stop) => {
                const meta = stopStatusMeta(stop.state);
                return (
                  <TouchableOpacity
                    key={stop.id}
                    style={[styles.listRow, { borderLeftColor: colors.textDim }]}
                    onPress={() => onSelectStop(stop)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.seqDotSm, { backgroundColor: meta.color }]}>
                      <Text style={styles.seqDotSmText}>{stop.route_sequence ?? '•'}</Text>
                    </View>
                    <Text style={styles.listName} numberOfLines={1}>{stop.customer_name}</Text>
                    <Text style={styles.listMutedTag}>📍 falta GPS</Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function PanelButton({ label, onPress, primary, active }: { label: string; onPress: () => void; primary?: boolean; active?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.btn, primary ? styles.btnPrimary : active ? styles.btnActive : styles.btnSecondary]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.btnText, (primary || active) ? styles.btnTextPrimary : styles.btnTextSecondary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    paddingBottom: 18, maxHeight: '72%',
    borderTopWidth: 1, borderColor: colors.border,
    shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 12,
  },
  header: { paddingTop: 8, paddingHorizontal: spacing.screenPadding },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressText: { fontSize: 13, fontWeight: '700', color: colors.text, fontFamily: fonts.monoBold },
  expandHint: { fontSize: 12, color: colors.primary, fontWeight: '700' },
  focusBox: { paddingHorizontal: spacing.screenPadding, paddingTop: 10, gap: 8 },
  focusHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  seqDot: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  seqDotText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  focusName: { fontSize: 16, fontWeight: '700', color: colors.text },
  focusAddress: { fontSize: 12, color: colors.text, marginTop: 2 },
  focusAddressMuted: { color: colors.textDim, fontStyle: 'italic' },
  focusMeta: { fontSize: 12, color: colors.textDim, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8 },
  openClientBtn: {
    backgroundColor: colors.primary, paddingVertical: 14, borderRadius: radii.button,
    alignItems: 'center', minHeight: 48, justifyContent: 'center',
  },
  openClientText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  btn: { flex: 1, paddingVertical: 12, borderRadius: radii.button, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.primary },
  btnActive: { backgroundColor: 'rgba(37,99,235,0.18)', borderWidth: 1, borderColor: colors.primary },
  btnSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btnText: { fontSize: 14, fontWeight: '700' },
  btnTextPrimary: { color: '#FFFFFF' },
  btnTextSecondary: { color: colors.text },
  completedBox: { paddingHorizontal: spacing.screenPadding, paddingTop: 10, gap: 8 },
  completedTitle: { fontSize: 17, fontWeight: '800', color: colors.success },
  completedBody: { fontSize: 13, color: colors.textDim },
  closeBtn: { backgroundColor: colors.success, paddingVertical: 13, borderRadius: radii.button, alignItems: 'center', marginTop: 4 },
  closeBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  list: { marginTop: 10 },
  listContent: { paddingHorizontal: spacing.screenPadding, paddingBottom: 12 },
  sectionTitle: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.7, color: colors.textDim, marginTop: 12, marginBottom: 6 },
  listRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, paddingHorizontal: 10, borderRadius: radii.button,
    backgroundColor: colors.card, marginBottom: 6, borderLeftWidth: 3,
  },
  listRowOn: { backgroundColor: 'rgba(37,99,235,0.08)' },
  seqDotSm: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  seqDotSmText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  listName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  listState: { fontSize: 11, fontWeight: '700' },
  listMutedTag: { fontSize: 11, color: colors.textDim },
});
