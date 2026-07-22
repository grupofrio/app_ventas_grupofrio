import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type {
  BondedBluetoothDeviceSnapshot,
  SavedThermalPrinterSnapshot,
} from '../../services/thermalPrinter.ts';
import { buildLongSaleThermalTicketFixture } from '../../services/thermalTicketFixtures.ts';
import type { ThermalTicketDocument } from '../../services/thermalPrinterTypes.ts';
import { colors, radii, spacing } from '../../theme/tokens';
import { fonts, typography } from '../../theme/typography';

type PickerAction = 'select' | 'diagnostic' | 'long-ticket';
type PickerActionCallback = () => void | Promise<void>;

export interface ThermalPrinterPickerProps {
  visible: boolean;
  devices: readonly BondedBluetoothDeviceSnapshot[];
  selectedPrinter: SavedThermalPrinterSnapshot | null;
  loading?: boolean;
  onCancel: () => void;
  onSelectPrinter: (
    device: BondedBluetoothDeviceSnapshot,
  ) => void | Promise<void>;
  onPrintDiagnostic: () => void | Promise<void>;
  onPrintTicket: (document: ThermalTicketDocument) => void | Promise<void>;
  onActionError: (error: unknown) => void;
}

const isDevelopmentBuild = typeof __DEV__ !== 'undefined' && __DEV__;

export function ThermalPrinterPicker({
  visible,
  devices,
  selectedPrinter,
  loading = false,
  onCancel,
  onSelectPrinter,
  onPrintDiagnostic,
  onPrintTicket,
  onActionError,
}: ThermalPrinterPickerProps) {
  const actionInFlightRef = useRef(false);
  const [pendingAction, setPendingAction] = useState<PickerAction | null>(null);
  const isBusy = loading || pendingAction !== null;

  const runAction = useCallback(async (
    action: PickerAction,
    callback: PickerActionCallback,
  ) => {
    if (loading || actionInFlightRef.current) return;

    actionInFlightRef.current = true;
    setPendingAction(action);
    try {
      await callback();
    } catch (error) {
      onActionError(error);
    } finally {
      actionInFlightRef.current = false;
      setPendingAction(null);
    }
  }, [loading, onActionError]);

  const handleSelect = useCallback((device: BondedBluetoothDeviceSnapshot) => {
    void runAction('select', () => onSelectPrinter(device));
  }, [onSelectPrinter, runAction]);

  const handleCancel = useCallback(() => {
    if (!isBusy) onCancel();
  }, [isBusy, onCancel]);

  const handleDiagnostic = useCallback(() => {
    void runAction('diagnostic', () => onPrintDiagnostic());
  }, [onPrintDiagnostic, runAction]);

  const handleLongTicket = useCallback(() => {
    void runAction(
      'long-ticket',
      () => onPrintTicket(buildLongSaleThermalTicketFixture()),
    );
  }, [onPrintTicket, runAction]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={typography.screenTitle}>Configurar MP210</Text>
            <Text style={styles.subtitle}>Impresoras Bluetooth vinculadas</Text>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Cancelar selección de impresora"
            accessibilityState={{ disabled: isBusy }}
            activeOpacity={0.8}
            disabled={isBusy}
            onPress={handleCancel}
            style={[styles.cancelButton, isBusy && styles.disabled]}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          data={devices}
          extraData={selectedPrinter?.address}
          keyExtractor={(item) => item.address}
          contentContainerStyle={styles.list}
          ListEmptyComponent={(
            <View style={styles.emptyState}>
              <Text style={typography.body}>No hay dispositivos vinculados</Text>
              <Text style={styles.emptyCopy}>
                Vincula la MP210 desde los ajustes Bluetooth de Android.
              </Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isSelected = selectedPrinter?.address.toUpperCase()
              === item.address.toUpperCase();
            return (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Seleccionar ${item.name ?? 'dispositivo sin nombre'}, ${item.address}`}
                accessibilityState={{ disabled: isBusy, selected: isSelected }}
                activeOpacity={0.8}
                disabled={isBusy}
                onPress={() => handleSelect(item)}
                style={[
                  styles.deviceRow,
                  isSelected && styles.deviceRowSelected,
                  isBusy && styles.disabled,
                ]}
              >
                <View style={styles.deviceCopy}>
                  <Text style={styles.deviceName}>
                    {item.name ?? 'Dispositivo sin nombre'}
                  </Text>
                  <Text style={styles.deviceAddress}>{item.address}</Text>
                </View>
                <Text style={isSelected ? styles.selectedLabel : styles.selectLabel}>
                  {isSelected ? 'Impresora seleccionada' : 'Seleccionar'}
                </Text>
              </TouchableOpacity>
            );
          }}
        />

        {selectedPrinter !== null && (
          <View style={styles.actions}>
            <Text style={styles.selectedPrinter} numberOfLines={1}>
              {selectedPrinter.name ?? 'Dispositivo sin nombre'} · {selectedPrinter.address}
            </Text>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Imprimir diagnóstico"
              accessibilityState={{ disabled: isBusy }}
              activeOpacity={0.8}
              disabled={isBusy}
              onPress={handleDiagnostic}
              style={[styles.primaryAction, isBusy && styles.disabled]}
            >
              {pendingAction === 'diagnostic' ? (
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.primaryActionText}>Imprimir diagnóstico</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {isDevelopmentBuild && selectedPrinter !== null && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Imprimir ticket largo de prueba"
            accessibilityState={{ disabled: isBusy }}
            activeOpacity={0.8}
            disabled={isBusy}
            onPress={handleLongTicket}
            style={[styles.debugAction, isBusy && styles.disabled]}
          >
            {pendingAction === 'long-ticket' ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <Text style={styles.debugActionText}>
                Imprimir ticket largo de prueba
              </Text>
            )}
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCopy: {
    flex: 1,
  },
  subtitle: {
    ...typography.dim,
    marginTop: spacing.xs,
  },
  cancelButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    ...typography.buttonSmall,
    color: colors.primary,
  },
  list: {
    flexGrow: 1,
    padding: spacing.screenPadding,
  },
  emptyState: {
    padding: spacing.cardPaddingLg,
    backgroundColor: colors.card,
    borderRadius: radii.card,
  },
  emptyCopy: {
    ...typography.dim,
    marginTop: spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    minHeight: 70,
    marginBottom: spacing.md,
    padding: spacing.cardPadding,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.card,
  },
  deviceRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryAlpha08,
  },
  deviceCopy: {
    flex: 1,
  },
  deviceName: {
    ...typography.body,
  },
  deviceAddress: {
    marginTop: spacing.xs,
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textDim,
  },
  selectLabel: {
    ...typography.buttonSmall,
    color: colors.primary,
  },
  selectedLabel: {
    ...typography.buttonSmall,
    color: colors.success,
    textAlign: 'right',
  },
  actions: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  selectedPrinter: {
    ...typography.dimSmall,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  primaryAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
  },
  primaryActionText: {
    ...typography.button,
  },
  debugAction: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.screenPadding,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
  },
  debugActionText: {
    ...typography.button,
    color: colors.text,
  },
  disabled: {
    opacity: 0.5,
  },
});
