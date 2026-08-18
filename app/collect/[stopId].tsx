import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { formatCurrency } from '../../src/utils/time';
import { loadCurrentEmployeeDayBundle, prepareCurrentEmployeeDayBundle } from '../../src/services/employeeDayBundle';
import { createCurrentInvoiceCollectionPersistence } from '../../src/services/invoiceCollectionPersistence';
import { captureCurrentInvoiceCollection, isInvoiceCollectionCaptureFailure } from '../../src/services/invoiceCollectionSync';
import { assertVisitCollectionAmount, buildVisitCollectionState, collectionCaptureFailureNotice, collectionCaptureResultNotice, createVisitCollectionLifecycle, type VisitCollectionState } from '../../src/services/invoiceCollectionVisit';
import type { InvoiceCollectionPaymentMethod } from '../../src/services/invoiceCollection';
import { useAuthStore } from '../../src/stores/useAuthStore';

const PAYMENT_METHODS: readonly { id: InvoiceCollectionPaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'transfer', label: 'Transferencia' },
  { id: 'check', label: 'Cheque' },
];

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export default function CollectScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const beginReauthentication = useAuthStore((state) => state.beginReauthentication);
  const numericStopId = Number(stopId);
  const lifecycle = useRef(createVisitCollectionLifecycle()).current;
  const [collection, setCollection] = useState<VisitCollectionState | null>(null);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<InvoiceCollectionPaymentMethod>('cash');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requiresFreshBundle, setRequiresFreshBundle] = useState(false);
  const [reconciliationPending, setReconciliationPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVisit = useCallback(async (refreshBundle = false) => {
    const requestGeneration = lifecycle.beginLoad();
    if (!Number.isSafeInteger(numericStopId) || numericStopId <= 0) {
      if (lifecycle.canPublishLoad(requestGeneration)) {
        setError('La parada no es válida.');
        setLoading(false);
      }
      return;
    }
    if (lifecycle.canPublishLoad(requestGeneration)) {
      refreshBundle ? setRefreshing(true) : setLoading(true);
      setError(null);
    }
    try {
      if (refreshBundle) await prepareCurrentEmployeeDayBundle();
      const [loaded, persistence] = await Promise.all([
        loadCurrentEmployeeDayBundle(),
        createCurrentInvoiceCollectionPersistence(),
      ]);
      if (!loaded || !loaded.access.canRead) throw new Error('No hay un bundle de día disponible para esta visita.');
      const storedIntents = await persistence.list();
      if (lifecycle.canPublishLoad(requestGeneration)) {
        setCollection(buildVisitCollectionState(loaded.record.bundle, numericStopId, storedIntents));
        if (refreshBundle) setRequiresFreshBundle(false);
        setReconciliationPending(false);
      }
    } catch (loadError) {
      if (lifecycle.canPublishLoad(requestGeneration)) {
        setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la cobranza de esta parada.');
      }
    } finally {
      if (lifecycle.canPublishLoad(requestGeneration)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [lifecycle, numericStopId]);

  useEffect(() => {
    void loadVisit();
  }, [loadVisit]);

  useEffect(() => () => lifecycle.dispose(), [lifecycle]);

  const selectedInvoice = useMemo(
    () => collection?.invoices.find((entry) => entry.invoice.invoice_id === selectedInvoiceId) ?? null,
    [collection, selectedInvoiceId],
  );

  useEffect(() => {
    if (requiresFreshBundle || reconciliationPending || !collection) {
      setSelectedInvoiceId(null);
      return;
    }
    const selectedIsReady = collection.invoices.some((entry) => entry.invoice.invoice_id === selectedInvoiceId && entry.collection_state === 'ready');
    if (selectedIsReady) return;
    setSelectedInvoiceId(collection.invoices.find((entry) => entry.collection_state === 'ready')?.invoice.invoice_id ?? null);
  }, [collection, reconciliationPending, requiresFreshBundle, selectedInvoiceId]);

  useEffect(() => {
    setAmount(selectedInvoice ? String(selectedInvoice.invoice.amount_residual) : '');
  }, [selectedInvoice?.invoice.invoice_id, selectedInvoice?.invoice.amount_residual]);

  const numericAmount = Number(amount);
  const amountIsValid = !!selectedInvoice
    && selectedInvoice.collection_state === 'ready'
    && Number.isFinite(numericAmount)
    && numericAmount > 0
    && numericAmount <= selectedInvoice.invoice.amount_residual;
  const snapshotRequiresRefresh = collection?.invoices.some((entry) => entry.collection_state === 'requires_refresh') ?? false;
  const mustRefreshBundle = requiresFreshBundle || snapshotRequiresRefresh;
  const interactionDisabled = loading || refreshing || submitting || mustRefreshBundle || reconciliationPending;
  const canCollect = !interactionDisabled && amountIsValid;

  async function refreshIntents(): Promise<void> {
    await loadVisit(false);
  }

  async function handleCollect() {
    if (!selectedInvoice || !canCollect) return;
    let validAmount: number;
    try {
      validAmount = assertVisitCollectionAmount(selectedInvoice.invoice, numericAmount);
    } catch {
      const notice = collectionCaptureFailureNotice(false);
      Alert.alert(notice.title, notice.message);
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await captureCurrentInvoiceCollection({
        operation_id: uuidV4(),
        stop_id: numericStopId,
        invoice_id: selectedInvoice.invoice.invoice_id,
        amount: validAmount,
        payment_method: paymentMethod,
        snapshot_residual: selectedInvoice.invoice.amount_residual,
        snapshot_as_of: collection?.snapshot_as_of ?? null,
        now_ms: Date.now(),
      });

      if (!lifecycle.isActive()) return;
      await refreshIntents();
      if (!lifecycle.isActive()) return;
      if (outcome.status === 'applied') {
        const notice = collectionCaptureResultNotice(outcome);
        setRequiresFreshBundle(true);
        setSelectedInvoiceId(null);
        Alert.alert('Confirmado', `${notice.message} Operación: ${outcome.operationId}.`, [
          { text: 'Actualizar bundle', onPress: () => void loadVisit(true) },
          { text: 'Volver', onPress: () => router.back() },
        ]);
        return;
      }
      if (outcome.status === 'pending' || outcome.status === 'captured_pending') {
        const notice = collectionCaptureResultNotice(outcome);
        setReconciliationPending(true);
        setSelectedInvoiceId(null);
        Alert.alert('Pendiente de confirmación', notice.message, [
          { text: 'Volver', onPress: () => router.back() },
          { text: 'Quedarme' },
        ]);
        return;
      }
      if (outcome.status === 'review_required') {
        const notice = collectionCaptureResultNotice(outcome);
        Alert.alert('Revisión requerida', notice.message);
        return;
      }
      const notice = collectionCaptureResultNotice(outcome);
      Alert.alert('Inicia sesión de nuevo', notice.message, [
        { text: 'Iniciar sesión', onPress: beginReauthentication },
        { text: 'Quedarme', style: 'cancel' },
      ]);
    } catch (captureError) {
      if (lifecycle.isActive()) {
        const durableIntent = isInvoiceCollectionCaptureFailure(captureError) ? captureError.durableIntent : true;
        if (durableIntent) {
          setReconciliationPending(true);
          setSelectedInvoiceId(null);
        }
        const notice = collectionCaptureFailureNotice(durableIntent);
        Alert.alert(notice.title, notice.message);
      }
    } finally {
      if (lifecycle.isActive()) setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Cobrar facturas" showBack />
        <View style={styles.center}><Text style={typography.dim}>Cargando facturas de esta parada…</Text></View>
      </SafeAreaView>
    );
  }

  if (error || !collection) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Cobrar facturas" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>{error ?? 'No hay facturas disponibles para esta parada.'}</Text>
          <Button label="Reintentar" onPress={() => void loadVisit(true)} variant="secondary" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Cobrar facturas" showBack />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={typography.dim}>Parada #{collection.stop_id}</Text>
        {collection.customer_name ? <Text style={typography.body}>{collection.customer_name}</Text> : null}
        {collection.snapshot_as_of ? <Text style={typography.dimSmall}>Snapshot: {collection.snapshot_as_of}</Text> : null}

        {mustRefreshBundle ? (
          <Card style={styles.notice}>
            <Text style={typography.body}>El cobro aplicado invalidó este snapshot.</Text>
            <Text style={typography.dim}>Actualiza el bundle antes de intentar otro cobro en esta parada.</Text>
            <Button label="Actualizar bundle" onPress={() => void loadVisit(true)} loading={refreshing} variant="secondary" />
          </Card>
        ) : null}

        {reconciliationPending ? (
          <Card style={styles.notice}>
            <Text style={typography.body}>Pendiente de confirmación</Text>
            <Text style={typography.dim}>No registres otro pago para esta factura hasta que la app actualice su estado.</Text>
            <Button label="Actualizar estado" onPress={() => void loadVisit(true)} loading={refreshing} variant="secondary" />
          </Card>
        ) : null}

        {collection.invoices.length === 0 ? <Card><Text style={typography.dim}>No hay facturas abiertas en el snapshot de esta parada.</Text></Card> : null}
        {collection.invoices.map((entry) => {
          const selected = entry.invoice.invoice_id === selectedInvoiceId;
          const blocked = entry.collection_state !== 'ready';
          return (
            <TouchableOpacity
              key={entry.invoice.invoice_id}
              style={[styles.invoice, selected && styles.invoiceSelected, blocked && styles.invoiceBlocked]}
              disabled={interactionDisabled || blocked}
              onPress={() => setSelectedInvoiceId(entry.invoice.invoice_id)}
            >
              <View style={styles.invoiceCopy}>
                <Text style={typography.body}>{entry.invoice.name}</Text>
                <Text style={typography.dimSmall}>{entry.invoice.due_date ? `Vence ${entry.invoice.due_date}` : 'Sin fecha de vencimiento'} · {entry.invoice.currency}</Text>
                {blocked ? <Text style={[typography.dimSmall, styles.blockedText]}>{
                  entry.collection_state === 'pending'
                    ? 'Pendiente de confirmación · no se generará otro envío.'
                    : entry.collection_state === 'requires_refresh'
                    ? 'Confirmado · actualiza el bundle antes de volver a cobrar.'
                    : 'Revisión requerida · no se generará otro envío.'
                }</Text> : null}
              </View>
              <Text style={[typography.metricValue, styles.invoiceAmount]}>{formatCurrency(entry.invoice.amount_residual)}</Text>
            </TouchableOpacity>
          );
        })}

        {selectedInvoice && !mustRefreshBundle ? (
          <Card style={styles.form}>
            <Text style={typography.sectionTitle}>Factura seleccionada</Text>
            <Text style={typography.body}>{selectedInvoice.invoice.name}</Text>
            <Text style={typography.dim}>Saldo: {formatCurrency(selectedInvoice.invoice.amount_residual)}</Text>
            <Text style={typography.inputLabel}>Monto a cobrar</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              editable={!interactionDisabled}
              placeholder="0.00"
              placeholderTextColor={colors.textDim}
            />
            {!amountIsValid ? <Text style={[typography.dimSmall, styles.validation]}>Ingresa un monto finito mayor a cero y no mayor al saldo.</Text> : null}
            <Text style={typography.inputLabel}>Método de pago</Text>
            <View style={styles.methods}>
              {PAYMENT_METHODS.map((method) => (
                <TouchableOpacity
                  key={method.id}
                  style={[styles.method, paymentMethod === method.id && styles.methodSelected]}
                  disabled={interactionDisabled}
                  onPress={() => setPaymentMethod(method.id)}
                >
                  <Text style={[typography.bodySmall, paymentMethod === method.id && styles.methodTextSelected]}>{method.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button label="Registrar cobro" onPress={() => void handleCollect()} fullWidth loading={submitting} disabled={!canCollect} />
          </Card>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  notice: { gap: spacing.sm },
  invoice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, padding: spacing.md, borderRadius: radii.card, backgroundColor: colors.card },
  invoiceSelected: { borderWidth: 1, borderColor: colors.primary },
  invoiceBlocked: { opacity: 0.62 },
  invoiceCopy: { flex: 1, gap: 2 },
  invoiceAmount: { textAlign: 'right' },
  blockedText: { color: colors.warning },
  form: { gap: spacing.sm },
  amountInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, color: colors.text, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontFamily: typography.metricValue.fontFamily },
  validation: { color: colors.error },
  methods: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  method: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radii.button, backgroundColor: colors.cardLighter },
  methodSelected: { backgroundColor: colors.primary },
  methodTextSelected: { color: colors.textOnPrimary },
});
