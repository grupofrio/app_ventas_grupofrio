/**
 * Collect screen — s-collect in mockup (lines 408-422).
 * Invoice collection / payment registration.
 *
 * FE-1: single-flight + stable operation_id (see collectPaymentIntent).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { formatCurrency } from '../../src/utils/time';
import { Invoice } from '../../src/types/product';
import { createCollectPaymentController } from '../../src/services/collectPaymentIntent';
import { describeCollectPaymentAlert } from '../../src/services/collectPaymentCopy';

const PAYMENT_METHODS = [
  { id: 'cash', label: '💵 Efectivo' },
  { id: 'transfer', label: '💳 Transferencia' },
  { id: 'check', label: '🏦 Cheque' },
];

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function CollectScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const router = useRouter();
  const enqueue = useSyncStore((s) => s.enqueue);
  const defaultPaymentJournalId = useAuthStore((s) => s.defaultPaymentJournalId);

  // In V1, invoices are loaded from Odoo. F6 will cache them.
  // For now, show empty state with clear explanation.
  const [invoices] = useState<Invoice[]>([]); // F6: load from cache
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [submitting, setSubmitting] = useState(false);

  const partnerNum = Number(partnerId);
  const numAmount = parseFloat(amount);

  const paymentController = useMemo(
    () =>
      createCollectPaymentController({
        uuid: uuidV4,
        enqueue: (type, payload, opts) => enqueue(type, payload, opts),
      }),
    [enqueue],
  );

  useEffect(() => {
    const amt = Number.isFinite(numAmount) ? numAmount : 0;
    paymentController.onIntentInputsChanged(partnerNum, amt);
  }, [paymentController, partnerNum, numAmount]);

  const totalPending = invoices.reduce((sum, inv) => sum + inv.amount_residual, 0);

  function handleCollect() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const outcome = paymentController.submit({
        partnerId: partnerNum,
        amount: numAmount,
        journalId: defaultPaymentJournalId,
        paymentMethod,
        reference: 'Cobro visita',
      });

      if (outcome.status === 'invalid') {
        Alert.alert('Monto invalido', outcome.message);
        return;
      }

      const copy = describeCollectPaymentAlert({
        outcome,
        amountLabel: formatCurrency(numAmount),
      });
      if (!copy) return;

      const leaveAfterOk =
        outcome.status === 'enqueued' || outcome.status === 'ignored_done';
      Alert.alert(copy.title, copy.body, [
        {
          text: 'OK',
          onPress: () => {
            if (leaveAfterOk) router.back();
          },
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo encolar el cobro';
      Alert.alert('Error', msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Cobrar Facturas" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Text style={styles.hint}>
          Partner #{partnerId} — Saldo pendiente
        </Text>

        {/* Invoice list */}
        {invoices.length === 0 ? (
          <Card>
            <Text style={typography.dim}>Sin facturas pendientes cargadas</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              F6: Las facturas se cargaran desde Odoo al sincronizar.
              Por ahora puedes registrar un cobro manual.
            </Text>
          </Card>
        ) : (
          invoices.map((inv) => (
            <View key={inv.id} style={styles.invoiceRow}>
              <View>
                <Text style={styles.invoiceName}>{inv.name}</Text>
                <Text style={styles.invoiceDate}>
                  {inv.invoice_date}
                  {inv.amount_residual > 0 ? ' · Pendiente' : ' · Pagada'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.invoiceAmount, {
                  color: inv.amount_residual > 0 ? colors.error : colors.success
                }]}>
                  {formatCurrency(inv.amount_residual)}
                </Text>
                {inv.amount_residual > 0 && (
                  <Button
                    label="Cobrar"
                    variant="success"
                    small
                    onPress={() => setAmount(inv.amount_residual.toString())}
                    style={{ marginTop: 4, paddingHorizontal: 12, paddingVertical: 6 }}
                  />
                )}
              </View>
            </View>
          ))
        )}

        {totalPending > 0 && (
          <>
            <View style={styles.divider} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Saldo total</Text>
              <Text style={styles.totalValue}>{formatCurrency(totalPending)}</Text>
            </View>
          </>
        )}

        {/* Amount input */}
        <Text style={styles.inputLabel}>MONTO A COBRAR</Text>
        <TextInput
          style={styles.amountInput}
          value={amount}
          onChangeText={setAmount}
          placeholder="0.00"
          placeholderTextColor={colors.textDim}
          keyboardType="numeric"
        />

        <Text style={styles.inputLabel}>METODO DE PAGO (nota local)</Text>
        <Text style={[typography.dimSmall, { marginBottom: 6 }]}>
          El servidor confirma el cobro por diario de pago, no por esta etiqueta.
          El estado final aparece en Sync cuando Odoo responde.
        </Text>
        <View style={styles.chipContainer}>
          {PAYMENT_METHODS.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[styles.chip, paymentMethod === m.id && styles.chipSelected]}
              onPress={() => setPaymentMethod(m.id)}
            >
              <Text style={[styles.chipText, paymentMethod === m.id && styles.chipTextSelected]}>
                {m.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Button
          label="💰 Guardar cobro"
          onPress={handleCollect}
          fullWidth
          disabled={submitting || !amount || parseFloat(amount) <= 0}
          style={{ marginTop: 14 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  hint: { fontSize: 12, color: colors.textDim, marginBottom: 14 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  inputLabel: {
    fontSize: 11, fontWeight: '600', textTransform: 'uppercase',
    letterSpacing: 0.4, color: colors.textDim, marginTop: 14, marginBottom: 5,
  },
  invoiceRow: {
    backgroundColor: colors.card, borderRadius: radii.button,
    padding: 10, paddingHorizontal: 14, marginBottom: 5,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  invoiceName: { fontSize: 13, fontWeight: '600', color: colors.text },
  invoiceDate: { fontSize: 11, color: colors.textDim },
  invoiceAmount: { fontFamily: fonts.monoBold, fontSize: 14, fontWeight: '700' },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.05)', marginVertical: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  totalLabel: { fontSize: 14, fontWeight: '700', color: colors.text },
  totalValue: { fontFamily: fonts.monoBold, fontSize: 16, fontWeight: '700', color: colors.error },
  amountInput: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: radii.button, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 20, textAlign: 'center',
    fontFamily: fonts.monoBold,
  },
  chipContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
    backgroundColor: colors.cardLighter, borderWidth: 1, borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primaryAlpha12, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text },
  chipTextSelected: { color: colors.primary },
});
