import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { buildPostvisitPayload } from '../../src/services/postvisitPayload';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { closeOffrouteVisit, fetchLeadStages, upsertLeadData } from '../../src/services/gfLogistics';
import { applyLeadUpsertToStop, getLeadPartnerId, LeadStageOption } from '../../src/services/leadVisit';
import { hasContactPhone } from '../../src/services/customerContactUpdate';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';

const DEFAULT_LEAD_COMPANY_ID = 34;

const INTEREST_OPTIONS = [
  { value: 'high', label: 'Alto' },
  { value: 'medium', label: 'Medio' },
  { value: 'low', label: 'Bajo' },
] as const;

const FREEZER_OPTIONS = [
  { value: 'yes', label: 'Sí' },
  { value: 'no', label: 'No' },
] as const;

export default function ProspeccionScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stop = useRouteStore((s) => s.stops.find((item) => item.id === Number(stopId)));
  const removeStop = useRouteStore((s) => s.removeStop);
  const patchStop = useRouteStore((s) => s.patchStop);
  const enqueue = useSyncStore((s) => s.enqueue);
  const isOnline = useSyncStore((s) => s.isOnline);
  const resetVisit = useVisitStore((s) => s.resetVisit);
  const offrouteVisitId = useVisitStore((s) => s.offrouteVisitId);
  const companyId = useAuthStore((s) => s.companyId);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);

  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [freezer, setFreezer] = useState<'yes' | 'no'>('no');
  const [interestLevel, setInterestLevel] = useState<'high' | 'medium' | 'low'>('medium');
  const [notes, setNotes] = useState('');
  const [stages, setStages] = useState<LeadStageOption[]>([]);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);
  const [loadingStages, setLoadingStages] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stageError, setStageError] = useState<string | null>(null);

  const isLead = stop?._entityType === 'lead';
  const title = 'Datos';
  const effectiveCompanyId = companyId ?? DEFAULT_LEAD_COMPANY_ID;

  const canSave = useMemo(() => {
    return selectedStageId != null;
  }, [selectedStageId]);


  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isOnline) {
        setLoadingStages(false);
        setStageError('Conéctate para cargar las etapas.');
        return;
      }

      setLoadingStages(true);
      setStageError(null);
      try {
        const response = await fetchLeadStages(effectiveCompanyId);
        if (cancelled) return;
        const normalized = [...response].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
        setStages(normalized);
        setSelectedStageId((prev) => prev ?? normalized[0]?.id ?? null);
        if (normalized.length === 0) {
          setStageError('No hay etapas disponibles para esta empresa.');
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'No se pudieron cargar las etapas.';
        setStageError(message);
      } finally {
        if (!cancelled) setLoadingStages(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId, isOnline]);

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Prospección" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentStop = stop;

  // F1.8: la conversión de prospecto a cliente ya sucedía implícita dentro
  // de "Guardar Datos" (applyLeadUpsertToStop refleja el partner_id que
  // regrese el backend). Aquí solo se hace explícita con nombre y
  // requisitos visibles — el flujo/endpoint no cambia.
  const alreadyCustomer = !isLead || getLeadPartnerId(currentStop) != null;
  const hasPhoneReq = hasContactPhone(currentStop) || phone.trim().length > 0;
  const hasLocationReq = typeof currentStop.customer_latitude === 'number' && typeof currentStop.customer_longitude === 'number';
  const readyToConvert = isLead && !alreadyCustomer && hasPhoneReq && hasLocationReq;

  function finalizeAfterSave() {
    router.replace(`/checkin/${currentStop.id}` as never);
  }

  function handleCloseSpecialVisit() {
    if (!currentStop._isOffroute) return;
    Alert.alert(
      'Cerrar visita especial',
      'Esta visita especial solo existe localmente en la app. Se cerrará y ya podrás abrir otra visita.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar visita',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const closePayload = offrouteVisitId
                ? {
                    visit_id: offrouteVisitId,
                    result_status: 'lead_data' as const,
                    latitude: latitude || 0,
                    longitude: longitude || 0,
                  }
                : null;
              if (closePayload) {
                if (!isOnline) {
                  enqueue('offroute_visit_close', {
                    ...closePayload,
                    timestamp: Date.now(),
                  });
                } else {
                  try {
                    await closeOffrouteVisit(closePayload);
                  } catch (error) {
                    const message = error instanceof Error ? error.message : 'No se pudo cerrar la visita especial.';
                    if (isRetryableSyncErrorMessage(message)) {
                      enqueue('offroute_visit_close', {
                        ...closePayload,
                        timestamp: Date.now(),
                      });
                    } else {
                      Alert.alert(
                        'Cierre pendiente en servidor',
                        'La visita especial se cerrará solo localmente porque backend rechazó el cierre.',
                      );
                    }
                  }
                }
              }
              removeStop(currentStop.id);
              resetVisit();
              router.replace('/(tabs)' as never);
            })();
          },
        },
      ],
    );
  }

  async function handleSave() {
    if (!canSave) {
      Alert.alert('Falta etapa', 'Selecciona la etapa a la que debe caer la oportunidad.');
      return;
    }
    if (saving) return;

    const payload = buildPostvisitPayload({
      stop: currentStop,
      form: {
        contactName,
        phone,
        email,
        competitor,
        freezer,
        interestLevel,
        notes,
      },
      stageId: selectedStageId as number,
      companyId: effectiveCompanyId,
    });

    if (!isOnline) {
      enqueue('prospection', {
        ...payload,
        timestamp: Date.now(),
      });
      Alert.alert(
        'Datos pendientes',
        'No hay conexión. Los datos quedaron en cola y la venta se habilitará cuando el prospecto se sincronice.',
        [{ text: 'Continuar visita', onPress: finalizeAfterSave }],
      );
      return;
    }

    setSaving(true);
    try {
      const wasCustomerBefore = getLeadPartnerId(currentStop) != null;
      const lead = await upsertLeadData(payload);
      let nextStop = currentStop;
      if (lead) {
        nextStop = applyLeadUpsertToStop(currentStop, lead as any);
        patchStop(currentStop.id, nextStop);
        const visitState = useVisitStore.getState();
        if (visitState.currentStopId === currentStop.id && visitState.currentStop) {
          useVisitStore.setState({ currentStop: nextStop });
        }
      }

      const nowCustomer = getLeadPartnerId(nextStop) != null;
      const justConverted = !wasCustomerBefore && nowCustomer;

      Alert.alert(
        justConverted ? 'Prospecto convertido a cliente' : 'Datos guardados',
        justConverted
          ? 'Ya se creó el contacto en Odoo — la venta se habilitó en esta misma visita.'
          : 'La oportunidad quedó actualizada.',
        [{ text: 'Continuar visita', onPress: finalizeAfterSave }],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar la información.';
      if (isRetryableSyncErrorMessage(message)) {
        enqueue('prospection', {
          ...payload,
          timestamp: Date.now(),
        });
        Alert.alert(
          'Datos pendientes',
          'No se pudo confirmar con el servidor. Los datos quedaron en cola de sincronización.',
          [{ text: 'Continuar visita', onPress: finalizeAfterSave }],
        );
      } else {
        Alert.alert('Datos rechazados', message);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title={title} showBack />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.headerTitle}>{currentStop.customer_name}</Text>
          <Text style={styles.headerSubtitle}>
            {isLead ? 'Actualiza la información comercial del prospecto u oportunidad.' : 'Registra información comercial de la visita.'}
          </Text>
        </Card>

        {isLead && !alreadyCustomer && (
          <>
            <Text style={styles.inputLabel}>PARA CONVERTIR A CLIENTE</Text>
            <Card>
              <View style={styles.reqRow}>
                <Text style={styles.reqLabel}>Teléfono</Text>
                <Text style={[styles.reqStatus, hasPhoneReq ? styles.reqOk : styles.reqPending]}>
                  {hasPhoneReq ? '✓ Completo' : '▢ Falta'}
                </Text>
              </View>
              <View style={styles.reqRow}>
                <Text style={styles.reqLabel}>Ubicación GPS</Text>
                <Text style={[styles.reqStatus, hasLocationReq ? styles.reqOk : styles.reqPending]}>
                  {hasLocationReq ? '✓ Completa' : '▢ Falta'}
                </Text>
              </View>
              <View style={styles.reqRow}>
                <Text style={styles.reqLabel}>Etapa seleccionada</Text>
                <Text style={[styles.reqStatus, selectedStageId != null ? styles.reqOk : styles.reqPending]}>
                  {selectedStageId != null ? '✓ Completa' : '▢ Falta'}
                </Text>
              </View>
            </Card>
          </>
        )}

        <Text style={styles.inputLabel}>ETAPA</Text>
        {loadingStages ? (
          <View style={styles.loadingStageCard}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.loadingStageText}>Cargando etapas...</Text>
          </View>
        ) : (
          <>
            <View style={styles.chipRow}>
              {stages.map((stage) => (
                <TouchableOpacity
                  key={stage.id}
                  style={[styles.chip, selectedStageId === stage.id && styles.chipSelected]}
                  onPress={() => setSelectedStageId(stage.id)}
                >
                  <Text style={[styles.chipText, selectedStageId === stage.id && styles.chipTextSelected]}>
                    {stage.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {stageError ? (
              <Text style={styles.errorText}>{stageError}</Text>
            ) : null}
          </>
        )}

        <Text style={styles.inputLabel}>CONTACTO</Text>
        <TextInput
          style={styles.input}
          placeholder="Nombre del contacto"
          placeholderTextColor={colors.textDim}
          value={contactName}
          onChangeText={setContactName}
        />

        <Text style={styles.inputLabel}>TELÉFONO</Text>
        <TextInput
          style={styles.input}
          placeholder="Teléfono"
          placeholderTextColor={colors.textDim}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />

        <Text style={styles.inputLabel}>EMAIL</Text>
        <TextInput
          style={styles.input}
          placeholder="correo@ejemplo.com"
          placeholderTextColor={colors.textDim}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.inputLabel}>COMPETIDOR</Text>
        <TextInput
          style={styles.input}
          placeholder="Competidor detectado"
          placeholderTextColor={colors.textDim}
          value={competitor}
          onChangeText={setCompetitor}
        />

        <Text style={styles.inputLabel}>¿TIENE FREEZER?</Text>
        <View style={styles.chipRow}>
          {FREEZER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, freezer === option.value && styles.chipSelected]}
              onPress={() => setFreezer(option.value)}
            >
              <Text style={[styles.chipText, freezer === option.value && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.inputLabel}>NIVEL DE INTERÉS</Text>
        <View style={styles.chipRow}>
          {INTEREST_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[styles.chip, interestLevel === option.value && styles.chipSelected]}
              onPress={() => setInterestLevel(option.value)}
            >
              <Text style={[styles.chipText, interestLevel === option.value && styles.chipTextSelected]}>
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.inputLabel}>NOTAS</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Observaciones de la visita"
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={4}
        />

        <Button
          label={readyToConvert ? 'Convertir a cliente y habilitar venta' : 'Guardar Datos'}
          onPress={() => { void handleSave(); }}
          fullWidth
          disabled={!canSave || saving || loadingStages}
          loading={saving}
          style={{ marginTop: 16 }}
        />

        {currentStop._isOffroute ? (
          <Button
            label="Cerrar visita especial"
            variant="danger"
            onPress={handleCloseSpecialVisit}
            fullWidth
            style={{ marginTop: 8 }}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  headerSubtitle: { fontSize: 12, color: colors.textDim, marginTop: 6 },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    color: colors.textDim,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
  },
  textArea: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 14,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  loadingStageCard: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingStageText: {
    color: colors.textDim,
    fontSize: 13,
  },
  chipRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primaryAlpha12,
    borderColor: colors.primary,
  },
  chipText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.primary },
  errorText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.error,
  },
  reqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  reqLabel: { fontSize: 13, color: colors.text },
  reqStatus: { fontSize: 12, fontWeight: '700' },
  reqOk: { color: colors.success },
  reqPending: { color: colors.textDim },
});
