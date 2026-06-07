/**
 * CalendarPicker — selector de fecha en modal, SIN dependencias nativas.
 *
 * RN Modal + grid de días calculado con calendarLogic (puro). Bloquea fechas
 * pasadas (minIso), resalta la seleccionada y al elegir un día devuelve un
 * string YYYY-MM-DD. Cancelar no cambia nada.
 *
 * Se eligió un calendario propio (no @react-native-community/datetimepicker)
 * para evitar una dependencia nativa / prebuild y no agregar riesgo al APK EAS.
 */

import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, radii } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import {
  WEEKDAYS_ES, buildMonthCells, shiftMonth, monthTitle, yearMonthFromIso,
  isoIsBefore,
} from '../../services/calendarLogic';

interface Props {
  visible: boolean;
  /** Currently selected date (YYYY-MM-DD). */
  valueIso: string;
  /** Earliest selectable date (YYYY-MM-DD). Days before this are disabled. */
  minIso: string;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

export function CalendarPicker({ visible, valueIso, minIso, onSelect, onClose }: Props) {
  const initial = yearMonthFromIso(valueIso || minIso, yearMonthFromIso(minIso, { year: 2026, month0: 0 }));
  const [view, setView] = useState(initial);

  // Reabrir el modal en el mes de la fecha seleccionada.
  useEffect(() => {
    if (visible) {
      setView(yearMonthFromIso(valueIso || minIso, initial));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const cells = buildMonthCells(view.year, view.month0);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.card} activeOpacity={1} onPress={() => {}}>
          {/* Header: mes / navegación */}
          <View style={styles.header}>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setView(shiftMonth(view.year, view.month0, -1))}
            >
              <Text style={styles.navText}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{monthTitle(view.year, view.month0)}</Text>
            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setView(shiftMonth(view.year, view.month0, 1))}
            >
              <Text style={styles.navText}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Encabezados de día */}
          <View style={styles.weekRow}>
            {WEEKDAYS_ES.map((w, i) => (
              <Text key={i} style={styles.weekday}>{w}</Text>
            ))}
          </View>

          {/* Grid de días */}
          <View style={styles.grid}>
            {cells.map((cell, idx) => {
              if (cell.day == null || cell.iso == null) {
                return <View key={`b${idx}`} style={styles.cell} />;
              }
              const disabled = isoIsBefore(cell.iso, minIso);
              const selected = cell.iso === valueIso;
              return (
                <TouchableOpacity
                  key={cell.iso}
                  style={[styles.cell, selected && styles.cellSelected, disabled && styles.cellDisabled]}
                  disabled={disabled}
                  onPress={() => { onSelect(cell.iso!); onClose(); }}
                >
                  <Text style={[styles.dayText, selected && styles.dayTextSelected, disabled && styles.dayTextDisabled]}>
                    {cell.day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const CELL = `${100 / 7}%`;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: colors.card, borderRadius: radii.card, padding: 16, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button, backgroundColor: colors.bg },
  navText: { fontSize: 22, color: colors.text, fontWeight: '800' },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  weekRow: { flexDirection: 'row', marginBottom: 4 },
  weekday: { width: CELL as unknown as number, textAlign: 'center', fontSize: 12, fontWeight: '700', color: colors.textDim },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL as unknown as number, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button },
  cellSelected: { backgroundColor: colors.primary },
  cellDisabled: { opacity: 0.3 },
  dayText: { fontSize: 15, color: colors.text, fontFamily: fonts.monoBold },
  dayTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  dayTextDisabled: { color: colors.textDim },
  cancelBtn: { marginTop: 12, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radii.button, borderWidth: 1, borderColor: colors.border },
  cancelText: { fontSize: 14, fontWeight: '700', color: colors.text },
});
