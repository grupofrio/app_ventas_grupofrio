/**
 * Print Ticket screen — Print receipt for a completed order.
 * Note: Bluetooth printer (ESC/POS) requires a custom dev client.
 */

import React from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Linking,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import ThermalPrinterModule from '../../modules/thermal-printer';
import type { ThermalTicketDocument } from '../../modules/thermal-printer';
import { ThermalPrinterPicker } from '../../src/components/domain/ThermalPrinterPicker';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { loadSaleTicketSnapshot } from '../../src/services/saleTicketStorage';
import {
  SALE_TICKET_CREDIT_NOTE,
  SALE_TICKET_LEGAL_NAME,
  SALE_TICKET_RFC,
  SaleTicketSnapshot,
} from '../../src/services/saleTicket';
import { openSaleTicketPdf } from '../../src/services/saleTicketPdf';
import {
  createThermalPrinterService,
  ThermalPrinterError,
} from '../../src/services/thermalPrinter';
import type {
  BondedBluetoothDeviceSnapshot,
  ThermalPrinterAccessResult,
} from '../../src/services/thermalPrinter';
import { createThermalPrinterSelectionStore } from '../../src/services/thermalPrinterSelection';
import {
  beginOutput,
  createExplicitReprintAction,
  createOutputGate,
  createThermalPrinterScreenFlowState,
  isCurrentOutput,
  openSettingsSafely,
  reduceThermalPrinterScreenFlow,
  releaseOutput,
} from '../../src/services/thermalPrinterScreenFlow';
import type {
  OutputToken,
  PrinterJobState,
} from '../../src/services/thermalPrinterScreenFlow';
import { buildThermalTicketDocument } from '../../src/services/thermalTicketDocument';
import { formatCurrency } from '../../src/utils/time';

const selectionStore = createThermalPrinterSelectionStore();
const androidApiLevel = typeof Platform.Version === 'number'
  ? Platform.Version
  : Number.parseInt(String(Platform.Version), 10) || 0;
const printerPlatform = Platform.OS === 'android'
  ? 'android'
  : Platform.OS === 'ios'
    ? 'ios'
    : 'web';

async function requestBluetoothConnectPermission() {
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  );
  if (result === PermissionsAndroid.RESULTS.GRANTED) return 'granted' as const;
  if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    return 'never_ask_again' as const;
  }
  if (result === PermissionsAndroid.RESULTS.DENIED) return 'denied' as const;
  return 'denied' as const;
}

const thermalPrinterService = createThermalPrinterService(
  {
    platform: printerPlatform,
    androidApiLevel,
    native: ThermalPrinterModule,
    requestConnectPermission: requestBluetoothConnectPermission,
  },
  { selectionStore },
);

const PRINTER_JOB_COPY: Record<Exclude<PrinterJobState, 'idle'>, string> = {
  permission: 'Revisando permiso de dispositivos cercanos...',
  connecting: 'Preparando conexión con MP210...',
  sending: 'Conectando y enviando a MP210...',
};

function waitForUiFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function openAndroidAppSettings() {
  await openSettingsSafely(
    () => Linking.openSettings(),
    () => {
      Alert.alert(
        'No se pudieron abrir los ajustes',
        'Abre los ajustes de Android manualmente y permite dispositivos cercanos. El PDF sigue disponible.',
      );
    },
  );
}

export default function PrintTicketScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [ticket, setTicket] = React.useState<SaleTicketSnapshot | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isOpening, setIsOpening] = React.useState(false);
  const [isSelectionLoading, setIsSelectionLoading] = React.useState(true);
  const [bondedDevices, setBondedDevices] = React.useState<readonly BondedBluetoothDeviceSnapshot[]>([]);
  const [printerFlow, dispatchPrinterFlow] = React.useReducer(
    reduceThermalPrinterScreenFlow,
    undefined,
    createThermalPrinterScreenFlowState,
  );
  const mountedRef = React.useRef(false);
  const outputGateRef = React.useRef(createOutputGate());
  const { jobState: printerJobState, pickerVisible, selectedPrinter } = printerFlow;
  const isPrintJobActive = printerJobState !== 'idle';

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      outputGateRef.current = createOutputGate();
    };
  }, []);

  React.useEffect(() => {
    let mounted = true;
    async function loadTicket() {
      setIsLoading(true);
      const snapshot = orderId ? await loadSaleTicketSnapshot(orderId) : null;
      if (mounted) {
        setTicket(snapshot);
        setIsLoading(false);
      }
    }

    void loadTicket();
    return () => {
      mounted = false;
    };
  }, [orderId]);

  React.useEffect(() => {
    let mounted = true;
    async function loadPrinterSelection() {
      try {
        const saved = await selectionStore.load();
        if (mounted) {
          dispatchPrinterFlow({ type: 'selection_loaded', printer: saved });
        }
      } catch {
        if (mounted) {
          dispatchPrinterFlow({ type: 'selection_loaded', printer: null });
        }
      } finally {
        if (mounted) setIsSelectionLoading(false);
      }
    }

    void loadPrinterSelection();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleOpenPdf() {
    if (!ticket || isPrintJobActive) return;
    const start = beginOutput(outputGateRef.current, 'pdf');
    if (start.token === null) return;
    outputGateRef.current = start.gate;
    const token = start.token;
    setIsOpening(true);
    try {
      await openSaleTicketPdf(ticket);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo abrir el PDF del ticket.';
      if (mountedRef.current) Alert.alert('Ticket PDF', message);
    } finally {
      const wasCurrent = isCurrentOutput(outputGateRef.current, token);
      outputGateRef.current = releaseOutput(outputGateRef.current, token);
      if (mountedRef.current && wasCurrent) setIsOpening(false);
    }
  }

  function startPrinterOperation(
    state: Exclude<PrinterJobState, 'idle'>,
  ): OutputToken | null {
    const start = beginOutput(outputGateRef.current, 'printer');
    if (start.token === null) return null;
    outputGateRef.current = start.gate;
    if (mountedRef.current) {
      dispatchPrinterFlow({ type: 'job_state', value: state });
    }
    return start.token;
  }

  function isCurrentOperation(token: OutputToken): boolean {
    return mountedRef.current && isCurrentOutput(outputGateRef.current, token);
  }

  function finishPrinterOperation(token: OutputToken) {
    const wasCurrent = isCurrentOutput(outputGateRef.current, token);
    outputGateRef.current = releaseOutput(outputGateRef.current, token);
    if (wasCurrent && mountedRef.current) {
      dispatchPrinterFlow({ type: 'job_finished' });
    }
  }

  function showPrinterError(error: unknown, retry: () => Promise<void>) {
    if (!mountedRef.current) return;
    if (error instanceof ThermalPrinterError) {
      const explicitReprint = createExplicitReprintAction(error.progress, retry);
      if (explicitReprint !== null) {
        Alert.alert(
          'El ticket pudo salir incompleto',
          `${error.message} Revisa el papel antes de decidir si quieres enviarlo otra vez.`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Reimprimir',
              onPress: () => {
                void explicitReprint.reprint();
              },
            },
          ],
        );
        return;
      }
      Alert.alert('No se pudo enviar el ticket', error.message);
      return;
    }
    Alert.alert('No se pudo enviar el ticket', 'Ocurrió un error inesperado. Intenta de nuevo.');
  }

  async function runNativePrinterJob(
    token: OutputToken,
    job: () => Promise<unknown>,
    successMessage: string,
    retry: () => Promise<void>,
  ) {
    if (!isCurrentOperation(token)) return;
    dispatchPrinterFlow({ type: 'job_state', value: 'connecting' });
    try {
      await waitForUiFrame();
      if (!isCurrentOperation(token)) return;
      dispatchPrinterFlow({ type: 'job_state', value: 'sending' });
      await job();
      if (isCurrentOperation(token)) Alert.alert('MP210', successMessage);
    } catch (error) {
      if (isCurrentOperation(token)) showPrinterError(error, retry);
    } finally {
      finishPrinterOperation(token);
    }
  }

  async function printTicketDocument(
    document: ThermalTicketDocument,
    successMessage = 'Ticket enviado a MP210',
  ) {
    const token = startPrinterOperation('connecting');
    if (token === null) return;
    const retry = () => printTicketDocument(document, successMessage);
    await runNativePrinterJob(
      token,
      () => thermalPrinterService.printTicket(document),
      successMessage,
      retry,
    );
  }

  async function printDiagnostic() {
    const token = startPrinterOperation('connecting');
    if (token === null) return;
    const retry = () => printDiagnostic();
    await runNativePrinterJob(
      token,
      () => thermalPrinterService.printDiagnostic(),
      'Diagnóstico enviado a MP210',
      retry,
    );
  }

  function showAccessFailure(result: Exclude<ThermalPrinterAccessResult, { status: 'ready' }>) {
    if (!mountedRef.current) return;
    switch (result.status) {
      case 'permission_denied':
        Alert.alert(
          'Permiso Bluetooth necesario',
          'Permite conectar con dispositivos cercanos para usar la MP210. El PDF sigue disponible.',
        );
        break;
      case 'permission_permanently_denied':
        Alert.alert(
          'Permiso Bluetooth bloqueado',
          'Activa el permiso de dispositivos cercanos en los ajustes. El PDF sigue disponible.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir ajustes', onPress: openAndroidAppSettings },
          ],
        );
        break;
      case 'permission_request_failed':
        Alert.alert(
          'No se pudo solicitar el permiso',
          'Intenta de nuevo o usa el PDF, que sigue disponible.',
        );
        break;
      case 'bluetooth_off':
        Alert.alert('Bluetooth apagado', 'Enciende Bluetooth y vuelve a intentarlo. El PDF sigue disponible.');
        break;
      case 'bluetooth_unsupported':
        Alert.alert('Bluetooth no disponible', 'Este dispositivo no admite esta conexión. El PDF sigue disponible.');
        break;
      case 'native_unavailable':
        Alert.alert(
          'MP210 no disponible en esta instalación',
          'Necesitas instalar una nueva compilación de Android para imprimir por Bluetooth. El PDF sigue disponible.',
        );
        break;
      case 'unsupported_platform':
        Alert.alert(
          'MP210 disponible solo en Android',
          'La impresión Bluetooth directa no está disponible aquí. El PDF sigue disponible.',
        );
        break;
      case 'native_error':
        Alert.alert(
          'No se pudo consultar Bluetooth',
          'Verifica la conexión e intenta de nuevo. El PDF sigue disponible.',
        );
        break;
    }
  }

  async function preparePrinterAccess(intent: 'print' | 'change') {
    const token = startPrinterOperation('permission');
    if (token === null) return;
    try {
      const result = await thermalPrinterService.prepare(selectedPrinter);
      if (!isCurrentOperation(token)) return;

      if (result.status !== 'ready') {
        showAccessFailure(result);
        return;
      }

      setBondedDevices(result.devices);
      if (intent === 'change' || result.savedPrinter === null) {
        dispatchPrinterFlow({ type: 'picker_opened' });
        return;
      }
      if (!result.savedPrinterBonded) {
        Alert.alert(
          'Impresora no vinculada',
          'La impresora seleccionada ya no está vinculada. Vincúlala en Android o elige otra.',
        );
        dispatchPrinterFlow({ type: 'picker_opened' });
        return;
      }
      if (!ticket) return;

      const document = buildThermalTicketDocument(ticket);
      const retry = () => printTicketDocument(document);
      await runNativePrinterJob(
        token,
        () => thermalPrinterService.printTicket(document),
        'Ticket enviado a MP210',
        retry,
      );
    } catch (error) {
      if (isCurrentOperation(token)) {
        Alert.alert(
          'No se pudo preparar la MP210',
          error instanceof Error ? error.message : 'Ocurrió un error inesperado.',
        );
      }
    } finally {
      finishPrinterOperation(token);
    }
  }

  async function handleSelectPrinter(device: BondedBluetoothDeviceSnapshot) {
    const saved = selectedPrinter === null
      ? await thermalPrinterService.selectPrinter(device)
      : await thermalPrinterService.changePrinter(device);
    if (!mountedRef.current) return;
    dispatchPrinterFlow({ type: 'printer_selected', printer: saved });
  }

  function handlePickerActionError(error: unknown) {
    if (!mountedRef.current) return;
    const message = error instanceof Error
      ? error.message
      : 'No se pudo completar la acción con la MP210.';
    Alert.alert('MP210', message);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Imprimir Ticket" showBack />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator
      >
        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando ticket...</Text>
          </View>
        ) : ticket ? (
          <>
            <View style={styles.ticketPreview}>
              <Text style={styles.ticketHeader}>GRUPO FRIO</Text>
              <Text style={styles.ticketLegalName}>{SALE_TICKET_LEGAL_NAME}</Text>
              <Text style={styles.ticketTaxId}>RFC: {SALE_TICKET_RFC}</Text>
              <View style={styles.divider} />
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Pedido</Text>
                <Text style={styles.ticketValue}>#{ticket.saleId}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Cliente</Text>
                <Text style={styles.ticketValue}>{ticket.customerName}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Vendedor</Text>
                <Text style={styles.ticketValue}>{ticket.sellerName}</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Pago</Text>
                <Text style={styles.ticketValue}>{ticket.paymentLabel}</Text>
              </View>
              <View style={styles.divider} />
              {ticket.lines.map((line) => (
                <View key={line.productId} style={styles.ticketLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.productName}>{line.productName}</Text>
                    <Text style={styles.productMeta}>
                      {line.qty} x {formatCurrency(line.unitPrice)}
                    </Text>
                  </View>
                  <Text style={styles.ticketValue}>{formatCurrency(line.lineTotal)}</Text>
                </View>
              ))}
              <View style={styles.divider} />
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Kg</Text>
                <Text style={styles.ticketValue}>{ticket.totalKg.toFixed(1)} kg</Text>
              </View>
              <View style={styles.ticketRow}>
                <Text style={styles.ticketLabel}>Total</Text>
                <Text style={styles.ticketTotal}>{formatCurrency(ticket.total)}</Text>
              </View>
              {ticket.paymentMethod === 'credit' ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.creditNote}>{SALE_TICKET_CREDIT_NOTE}</Text>
                </>
              ) : null}
            </View>

            <Button
              label="Imprimir en MP210"
              onPress={() => { void preparePrinterAccess('print'); }}
              loading={isPrintJobActive}
              disabled={isPrintJobActive || isOpening || isSelectionLoading}
              fullWidth
              style={{ marginBottom: spacing.md }}
            />
            <Button
              label="Abrir PDF"
              onPress={handleOpenPdf}
              loading={isOpening}
              disabled={isPrintJobActive}
              variant="secondary"
              fullWidth
              style={{ marginBottom: spacing.lg }}
            />

            <View style={styles.printerStatus}>
              <View style={styles.printerIdentity}>
                <Text style={styles.printerLabel}>Impresora seleccionada</Text>
                {isSelectionLoading ? (
                  <Text style={styles.printerValue}>Cargando selección...</Text>
                ) : selectedPrinter ? (
                  <>
                    <Text style={styles.printerValue}>
                      {selectedPrinter.name ?? 'Dispositivo sin nombre'}
                    </Text>
                    <Text style={styles.printerAddress}>{selectedPrinter.address}</Text>
                  </>
                ) : (
                  <Text style={styles.printerValue}>Sin impresora seleccionada</Text>
                )}
              </View>
              <Button
                label="Cambiar impresora"
                onPress={() => { void preparePrinterAccess('change'); }}
                disabled={isPrintJobActive || isSelectionLoading}
                variant="secondary"
                small
              />
            </View>

            {isPrintJobActive ? (
              <View style={styles.jobIndicator}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.jobIndicatorText}>
                  {PRINTER_JOB_COPY[printerJobState as Exclude<PrinterJobState, 'idle'>]}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Ticket no encontrado</Text>
            <Text style={styles.noticeText}>
              No se encontro el ticket local para el pedido #{orderId ?? '---'}.
            </Text>
          </View>
        )}

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Impresion Bluetooth</Text>
          <Text style={styles.noticeText}>
            En Android puedes enviar el ticket directamente a la MP210 vinculada.
            El PDF permanece disponible como alternativa.
          </Text>
        </View>
      </ScrollView>

      <ThermalPrinterPicker
        visible={pickerVisible}
        devices={bondedDevices}
        selectedPrinter={selectedPrinter}
        loading={isPrintJobActive}
        onCancel={() => dispatchPrinterFlow({ type: 'picker_closed' })}
        onSelectPrinter={handleSelectPrinter}
        onPrintDiagnostic={printDiagnostic}
        onPrintTicket={(document) => printTicketDocument(document, 'Ticket de prueba enviado a MP210')}
        onActionError={handlePickerActionError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    padding: spacing.lg,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    color: colors.textDim,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  ticketPreview: {
    backgroundColor: '#FAFAFA',
    borderRadius: radii.button,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  ticketHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
    marginBottom: 4,
  },
  ticketLegalName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1A1A1A',
    textAlign: 'center',
  },
  ticketTaxId: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: spacing.sm,
    borderStyle: 'dashed',
  },
  ticketRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  ticketLabel: {
    fontSize: 13,
    color: '#666',
  },
  ticketValue: {
    fontSize: 13,
    color: '#1A1A1A',
    fontWeight: '500',
  },
  ticketTotal: {
    fontSize: 16,
    color: '#1A1A1A',
    fontWeight: '700',
  },
  ticketLine: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  creditNote: {
    fontSize: 11,
    color: '#1A1A1A',
    lineHeight: 16,
    textAlign: 'justify',
  },
  productName: {
    fontSize: 12,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  productMeta: {
    fontSize: 11,
    color: '#666',
  },
  printerStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  printerIdentity: {
    flex: 1,
  },
  printerLabel: {
    fontSize: 11,
    color: colors.textDim,
    marginBottom: 2,
  },
  printerValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
  },
  printerAddress: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 2,
  },
  jobIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  jobIndicatorText: {
    fontSize: 13,
    color: colors.textDim,
  },
  notice: {
    backgroundColor: 'rgba(37,99,235,0.08)',
    borderRadius: radii.button,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: spacing.xs,
  },
  noticeText: {
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 20,
  },
});
