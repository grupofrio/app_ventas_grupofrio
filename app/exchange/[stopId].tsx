import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { CatalogProductPicker } from '../../src/components/domain/CatalogProductPicker';
import { deletePhoto, takePhoto } from '../../src/services/camera';
import { buildExchangeTicketSnapshot } from '../../src/services/exchangeTicket';
import { saveExchangeTicketSnapshot } from '../../src/services/exchangeTicketStorage';
import { createExchange } from '../../src/services/gfLogistics';
import { getLeadPartnerId } from '../../src/services/leadVisit';
import { enqueueVisitPhotos } from '../../src/services/visitPhotos';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useProductStore } from '../../src/stores/useProductStore';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { shouldRefreshProductsOnFocus } from '../../src/utils/productLoading';
import { createUuidV4 } from '../../src/utils/clientEvent';
import {
  applyExchangeStockViaLedger,
  buildExchangeLedgerMovements,
  buildLedgerBackedQueueItem,
  commitQueuedOperationWithLedger,
} from '../../src/services/inventoryLedgerAdapters';
import { decideExchangeFailureAction } from '../../src/services/exchangeSubmit';
import { isRetryableSyncErrorMessage } from '../../src/utils/syncFailure';
import { isSessionExpiredError } from '../../src/services/sessionError';

type ExchangeSection = 'delivery' | 'merma';

interface DraftLine {
  id: string;
  productId: number | null;
  qtyText: string;
}

interface PickerState {
  section: ExchangeSection;
  lineId: string;
}

interface ExchangeSnapshotSourceLine {
  productId: number;
  productName?: string;
  qty: number;
}

function makeDraftId(): string {
  return createUuidV4();
}

function makeIdempotencyKey(): string {
  return createUuidV4();
}

// F3.3: antes se regeneraba un idempotency_key NUEVO en cada tap de
// "Confirmar cambio" — si el primero fallaba de forma ambigua (respuesta
// perdida pero el cambio sí llegó a Odoo) y el vendedor reintentaba, el
// segundo intento mandaba una key distinta y no había forma de que el
// backend lo deduplicara. Ahora se mantiene estable hasta un envío exitoso.

function parsePositiveQty(value: string): number | null {
  const normalized = value.replace(',', '.').trim();
  if (!normalized) return null;
  const qty = Number(normalized);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return qty;
}

function buildPayloadLines(lines: DraftLine[]): Array<{ product_id: number; qty: number }> {
  return lines.flatMap((line) => {
    const qty = parsePositiveQty(line.qtyText);
    if (!line.productId || !qty) return [];
    return [{ product_id: line.productId, qty }];
  });
}

function hasIncompleteLines(lines: DraftLine[]): boolean {
  return lines.some((line) => line.productId == null || parsePositiveQty(line.qtyText) == null);
}

export default function CambioProductoScreen() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stop = useRouteStore((s) => s.stops.find((item) => item.id === Number(stopId)));
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const products = useProductStore((s) => s.products);
  const productCount = useProductStore((s) => s.productCount);
  const productsLastSync = useProductStore((s) => s.lastSync);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  const enqueue = useSyncStore((s) => s.enqueue);
  const persistQueue = useSyncStore((s) => s.persistQueue);
  const isOnline = useSyncStore((s) => s.isOnline);

  const [deliveryLines, setDeliveryLines] = useState<DraftLine[]>([]);
  const [mermaLines, setMermaLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState('');
  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [saving, setSaving] = useState(false);
  const idempotencyKeyRef = useRef<string | null>(null);
  function getExchangeIdempotencyKey(): string {
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = makeIdempotencyKey();
    return idempotencyKeyRef.current;
  }
  const [capturingPhoto, setCapturingPhoto] = useState(false);
  const capturingPhotoRef = useRef(false);
  const [photoUris, setPhotoUris] = useState<string[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (shouldRefreshProductsOnFocus(
        warehouseId,
        isLoadingProducts,
        productCount,
        productsLastSync,
      )) {
        void loadProducts(warehouseId!);
      }
    }, [warehouseId, isLoadingProducts, productCount, productsLastSync, loadProducts]),
  );

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const partnerId = stop ? (getLeadPartnerId(stop) ?? stop.customer_id) : null;
  const deliveryPayloadLines = useMemo(() => buildPayloadLines(deliveryLines), [deliveryLines]);
  const mermaPayloadLines = useMemo(() => buildPayloadLines(mermaLines), [mermaLines]);
  const hasAtLeastOneLine = deliveryPayloadLines.length > 0 || mermaPayloadLines.length > 0;

  const currentSectionLines = pickerState?.section === 'delivery' ? deliveryLines : mermaLines;
  const excludedProductIds = pickerState
    ? currentSectionLines
        .filter((line) => line.id !== pickerState.lineId && line.productId != null)
        .map((line) => line.productId as number)
    : [];

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <TopBar title="Cambio de Producto" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const currentStop = stop;

  function addLine(section: ExchangeSection) {
    const nextLine: DraftLine = { id: makeDraftId(), productId: null, qtyText: '' };
    if (section === 'delivery') {
      setDeliveryLines((prev) => [...prev, nextLine]);
    } else {
      setMermaLines((prev) => [...prev, nextLine]);
    }
  }

  function updateLine(section: ExchangeSection, lineId: string, patch: Partial<DraftLine>) {
    const setter = section === 'delivery' ? setDeliveryLines : setMermaLines;
    setter((prev) => prev.map((line) => (
      line.id === lineId ? { ...line, ...patch } : line
    )));
  }

  function removeLine(section: ExchangeSection, lineId: string) {
    const setter = section === 'delivery' ? setDeliveryLines : setMermaLines;
    setter((prev) => prev.filter((line) => line.id !== lineId));
  }

  function openPicker(section: ExchangeSection, lineId: string) {
    setPickerState({ section, lineId });
  }

  function handleSelectProduct(productId: number) {
    if (!pickerState) return;
    updateLine(pickerState.section, pickerState.lineId, {
      productId,
      qtyText: currentSectionLines.find((line) => line.id === pickerState.lineId)?.qtyText || '1',
    });
    setPickerState(null);
  }

  async function handleAddExchangePhoto() {
    if (saving || capturingPhoto || capturingPhotoRef.current) return;
    capturingPhotoRef.current = true;
    setCapturingPhoto(true);
    try {
      const photo = await takePhoto();
      if (!photo) {
        Alert.alert('Foto requerida', 'No se pudo capturar la foto. Intenta de nuevo.');
        return;
      }
      setPhotoUris((previous) => [...previous, photo.localUri]);
    } finally {
      capturingPhotoRef.current = false;
      setCapturingPhoto(false);
    }
  }

  async function handleRemoveExchangePhoto(uri: string) {
    if (saving || capturingPhoto) return;
    await deletePhoto(uri);
    setPhotoUris((current) => current.filter((photoUri) => photoUri !== uri));
  }

  async function handleSubmit() {
    if (saving || capturingPhoto) return;
    if (photoUris.length === 0) {
      Alert.alert('Evidencia requerida', 'Toma al menos una foto antes de registrar el cambio.');
      return;
    }
    if (hasIncompleteLines(deliveryLines) || hasIncompleteLines(mermaLines)) {
      Alert.alert('Líneas incompletas', 'Completa producto y cantidad en cada línea o elimínala.');
      return;
    }
    if (!hasAtLeastOneLine) {
      Alert.alert('Sin movimientos', 'Agrega al menos una línea con cantidad mayor a 0.');
      return;
    }

    setSaving(true);
    const idempotencyKey = getExchangeIdempotencyKey();
    const deliveryLedgerLines = deliveryPayloadLines.map((line) => ({
      product_id: line.product_id,
      qty: line.qty,
    }));
    const damagedLedgerLines = mermaPayloadLines.map((line) => ({
      product_id: line.product_id,
      qty: line.qty,
    }));
    const exchangeCapturePayload: Record<string, unknown> = {
      idempotency_key: idempotencyKey,
      stop_id: currentStop.id,
      delivery_lines: deliveryPayloadLines,
      merma_lines: mermaPayloadLines,
      notes,
      validate: true,
    };

    const queueExchangeWithLedger = async () => {
      const movements = buildExchangeLedgerMovements({
        operationId: idempotencyKey,
        delivery: deliveryLedgerLines,
        returnDamaged: damagedLedgerLines,
        stopId: currentStop.id,
        partnerId,
      });
      await commitQueuedOperationWithLedger({
        queueItem: buildLedgerBackedQueueItem({
          operationId: idempotencyKey,
          type: 'exchange',
          payload: {
          ...exchangeCapturePayload,
          _ledgerApplied: true,
          },
        }),
        movements,
      });
    };

    const enqueueEvidence = async () => {
      try {
        enqueueVisitPhotos({
          stopId: currentStop.id,
          photoUris,
          enqueue,
          imageType: 'exchange',
          dependsOn: [idempotencyKey],
        });
        await persistQueue();
      } catch (error) {
        const detail = error instanceof Error ? `\n\nDetalle: ${error.message}` : '';
        Alert.alert(
          'Evidencia pendiente',
          `Cambio guardado, pero la evidencia quedó pendiente de sincronizar. No repitas el cambio.${detail}`,
        );
      }
    };

    const finishWithTicket = async (args: {
      exchangeName: string;
      exchangeId: number | null;
      registeredMessage: string;
      clearIdempotency: boolean;
    }) => {
      if (args.clearIdempotency) {
        idempotencyKeyRef.current = null; // siguiente cambio = nueva key
      }
      const deliverySnapshotLines: ExchangeSnapshotSourceLine[] = deliveryPayloadLines.map((line) => ({
        productId: line.product_id,
        productName: productMap.get(line.product_id)?.name,
        qty: line.qty,
      }));
      const mermaSnapshotLines: ExchangeSnapshotSourceLine[] = mermaPayloadLines.map((line) => ({
        productId: line.product_id,
        productName: productMap.get(line.product_id)?.name,
        qty: line.qty,
      }));
      const snapshot = buildExchangeTicketSnapshot({
        snapshotId: idempotencyKey,
        exchangeName: args.exchangeName,
        exchangeId: args.exchangeId,
        customerName: currentStop.customer_name,
        createdAt: new Date().toISOString(),
        deliveryLines: deliverySnapshotLines,
        mermaLines: mermaSnapshotLines,
        notes,
      });
      try {
        await saveExchangeTicketSnapshot(snapshot);
      } catch (error) {
        const detail = error instanceof Error
          ? error.message
          : undefined;
        const message = 'Cambio registrado, pero no se pudo preparar el ticket. No repitas el cambio.';
        Alert.alert(
          'Ticket no preparado',
          `${message}${detail ? `\n\nDetalle: ${detail}` : ''}`,
        );
        router.replace({
          pathname: '/checkin/[stopId]',
          params: {
            stopId: String(currentStop.id),
            exchangeMessage: args.registeredMessage,
          },
        } as never);
        return;
      }
      router.replace({
        pathname: '/print-exchange/[snapshotId]',
        params: { snapshotId: snapshot.snapshotId },
      } as never);
    };

    try {
      if (!isOnline) {
        await queueExchangeWithLedger();
        await enqueueEvidence();
        await finishWithTicket({
          exchangeName: `PENDIENTE/${idempotencyKey.slice(0, 8)}`,
          exchangeId: null,
          registeredMessage: 'Cambio guardado para sincronizar',
          clearIdempotency: true,
        });
        return;
      }

      let registeredMessage = 'Cambio procesado';
      let response;
      try {
        response = await createExchange(exchangeCapturePayload);
        registeredMessage = response.user_message || registeredMessage;
      } catch (error) {
        const code = (error as { code?: string }).code;
        const message = error instanceof Error ? error.message : 'No se pudo registrar el cambio.';
        const action = decideExchangeFailureAction({
          isSessionExpired: isSessionExpiredError(error),
          isRetryable: isRetryableSyncErrorMessage(message) || code === 'LOCK_BUSY',
        });
        if (action === 'session_relogin') {
          Alert.alert('Sesión expirada', 'Vuelve a iniciar sesión para registrar el cambio.');
          return;
        }
        if (action === 'enqueue') {
          await queueExchangeWithLedger();
          await enqueueEvidence();
          Alert.alert(
            'Sincronización pendiente',
            'No pudimos confirmar si el cambio se completó. Quedó guardado con el mismo identificador para reintento.',
          );
          await finishWithTicket({
            exchangeName: `PENDIENTE/${idempotencyKey.slice(0, 8)}`,
            exchangeId: null,
            registeredMessage: 'Cambio guardado para sincronizar',
            clearIdempotency: true,
          });
          return;
        }
        let friendly = message;
        switch (code) {
          case 'LOCK_BUSY':
            friendly = 'El sistema está ocupado. Reintenta en unos segundos.';
            break;
          case 'SERVER_MISCONFIG':
            friendly = 'Falta configuración en Odoo. Avisa al administrador.';
            break;
          case 'FORBIDDEN':
            friendly = 'La van no pertenece a la sucursal activa. Verifica tu asignación.';
            break;
          case 'VALIDATION_ERROR':
            friendly = message;
            break;
          default:
            break;
        }
        Alert.alert('Cambio no registrado', friendly);
        return;
      }

      // Online success: evidence + ledger (post-hoc; server already committed).
      await enqueueEvidence();
      try {
        await applyExchangeStockViaLedger({
          operationId: idempotencyKey,
          delivery: deliveryLedgerLines,
          returnDamaged: damagedLedgerLines,
          stopId: currentStop.id,
          partnerId,
        });
      } catch (ledgerError) {
        const detail = ledgerError instanceof Error ? `\n\nDetalle: ${ledgerError.message}` : '';
        Alert.alert(
          'Inventario local no actualizado',
          `Cambio registrado en servidor, pero el ledger local falló. No repitas el cambio.${detail}`,
        );
      }

      await finishWithTicket({
        exchangeName: response.data.exchange_name,
        exchangeId: response.data.exchange_id,
        registeredMessage,
        clearIdempotency: true,
      });
    } finally {
      setSaving(false);
    }
  }

  function renderSection(
    section: ExchangeSection,
    title: string,
    subtitle: string,
    lines: DraftLine[],
  ) {
    return (
      <Card style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>{title}</Text>
            <Text style={styles.sectionSubtitle}>{subtitle}</Text>
          </View>
          <Button
            label="+ Agregar línea"
            variant="secondary"
            small
            onPress={() => addLine(section)}
          />
        </View>

        {lines.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={typography.dim}>Sin líneas en esta sección.</Text>
          </View>
        ) : (
          lines.map((line) => {
            const product = line.productId ? productMap.get(line.productId) : null;
            return (
              <View key={line.id} style={styles.lineCard}>
                <Text style={styles.lineLabel}>PRODUCTO</Text>
                <TouchableOpacity
                  style={styles.selector}
                  activeOpacity={0.85}
                  onPress={() => openPicker(section, line.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={product ? styles.selectorValue : styles.selectorPlaceholder}>
                      {product?.name || 'Seleccionar producto'}
                    </Text>
                    {product ? (
                      <Text style={styles.selectorMeta}>
                        {product.default_code || 'Sin código'} · {product.qty_display} disp.
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.selectorAction}>Buscar</Text>
                </TouchableOpacity>

                <Text style={styles.lineLabel}>CANTIDAD</Text>
                <View style={styles.qtyRow}>
                  <TextInput
                    style={styles.qtyInput}
                    placeholder="0"
                    placeholderTextColor={colors.textDim}
                    value={line.qtyText}
                    onChangeText={(value) => updateLine(section, line.id, { qtyText: value })}
                    keyboardType="decimal-pad"
                  />
                  <Button
                    label="Eliminar"
                    variant="danger"
                    small
                    onPress={() => removeLine(section, line.id)}
                  />
                </View>
              </View>
            );
          })
        )}
      </Card>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Cambio de Producto" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.customerName}>{currentStop.customer_name}</Text>
          <Text style={styles.contextText}>
            Registra producto nuevo entregado y producto dañado recogido. No se genera cobro.
          </Text>
          <Text style={styles.contextMeta}>
            Parada #{currentStop.id}
          </Text>
        </Card>

        {isLoadingProducts && products.length === 0 ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.loadingText}>Cargando catálogo de productos...</Text>
          </View>
        ) : null}

        {!isLoadingProducts && productError && products.length === 0 ? (
          <View style={styles.loadingState}>
            <Text style={styles.errorText}>{productError}</Text>
            {warehouseId ? (
              <Button
                label="Reintentar catálogo"
                variant="secondary"
                small
                onPress={() => void loadProducts(warehouseId)}
              />
            ) : null}
          </View>
        ) : null}

        {renderSection(
          'delivery',
          'Producto Nuevo (Entrega)',
          'Productos que el chofer entrega al cliente.',
          deliveryLines,
        )}

        {renderSection(
          'merma',
          'Producto Dañado (Merma)',
          'Productos dañados que el chofer recoge del cliente.',
          mermaLines,
        )}

        <Text style={styles.inputLabel}>NOTAS</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Notas opcionales del cambio..."
          placeholderTextColor={colors.textDim}
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
        />

        <Card style={styles.evidenceCard}>
          <View style={styles.evidenceHeader}>
            <View style={{ flex: 1 }}>
              <Text style={styles.evidenceTitle}>Evidencia del cambio (obligatoria)</Text>
              <Text style={styles.evidenceCopy}>
                Mínimo 1 foto. Puedes agregar varias fotos para documentar el cambio.
              </Text>
            </View>
            {photoUris.length > 0 ? (
              <Text style={styles.photoCount}>{photoUris.length} foto{photoUris.length === 1 ? '' : 's'}</Text>
            ) : null}
          </View>

          {photoUris.length === 0 ? (
            <Button
              label="Tomar foto"
              variant="secondary"
              onPress={() => void handleAddExchangePhoto()}
              disabled={saving || capturingPhoto}
            />
          ) : (
            <>
              <Button
                label="Agregar otra foto"
                variant="secondary"
                onPress={() => void handleAddExchangePhoto()}
                disabled={saving || capturingPhoto}
              />
              <View style={styles.photoGrid}>
                {photoUris.map((uri) => (
                  <View key={uri} style={styles.photoItem}>
                    <Image source={{ uri }} style={styles.photoThumbnail} />
                    <Button
                      label="Eliminar"
                      variant="danger"
                      small
                      onPress={() => void handleRemoveExchangePhoto(uri)}
                      disabled={saving || capturingPhoto}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </Card>

        <Button
          label="Registrar Cambio"
          onPress={() => void handleSubmit()}
          fullWidth
          loading={saving}
          disabled={saving || capturingPhoto || photoUris.length === 0}
          style={styles.submitButton}
        />
      </ScrollView>

      <CatalogProductPicker
        visible={pickerState != null}
        title="Seleccionar producto"
        excludedProductIds={excludedProductIds}
        onClose={() => setPickerState(null)}
        onSelect={(product) => handleSelectProduct(product.id)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, gap: 12 },
  customerName: { ...typography.cardValue },
  contextText: {
    ...typography.bodySmall,
    color: colors.textDim,
    marginTop: 6,
  },
  contextMeta: {
    ...typography.dim,
    marginTop: 8,
  },
  loadingState: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: 14,
    gap: 8,
    alignItems: 'center',
  },
  loadingText: { ...typography.dim },
  errorText: {
    ...typography.dim,
    color: colors.error,
    textAlign: 'center',
  },
  sectionCard: {
    gap: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  sectionTitle: { ...typography.bodySmall, fontFamily: fonts.bodyBold, fontWeight: '700' },
  sectionSubtitle: {
    ...typography.dim,
    marginTop: 3,
  },
  emptyState: {
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    padding: 12,
    alignItems: 'center',
  },
  lineCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.button,
    padding: 12,
    gap: 8,
  },
  lineLabel: { ...typography.inputLabel, marginTop: 0, marginBottom: 0 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectorPlaceholder: { ...typography.body, color: colors.textDim },
  selectorValue: { ...typography.body, fontFamily: fonts.bodyBold, fontWeight: '700' },
  selectorMeta: {
    ...typography.dimSmall,
    marginTop: 2,
  },
  selectorAction: { ...typography.dim, color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qtyInput: {
    ...typography.body,
    flex: 1,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  inputLabel: {
    ...typography.inputLabel,
    marginTop: 4,
    marginBottom: -4,
  },
  notesInput: {
    ...typography.body,
    backgroundColor: colors.card,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  evidenceCard: {
    gap: 12,
  },
  evidenceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  evidenceTitle: { ...typography.body, fontFamily: fonts.bodyBold, fontWeight: '700' },
  evidenceCopy: {
    ...typography.dim,
    marginTop: 4,
  },
  photoCount: { ...typography.dim, color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  photoItem: {
    width: '31%',
    gap: 6,
  },
  photoThumbnail: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  submitButton: {
    marginTop: 8,
    marginBottom: 12,
  },
});
