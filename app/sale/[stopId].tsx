/**
 * Sale screen — s-sale in mockup (lines 283-306).
 * Product lines with +/- qty, totals, payment method, mandatory photo.
 */

import React, { useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Button } from '../../src/components/ui/Button';
import { Card } from '../../src/components/ui/Card';
import { AlertBanner } from '../../src/components/ui/AlertBanner';
import {
  describeSaleOfflineUx,
  describeSaleRecoveryNotice,
  saleConfirmButtonLabel,
} from '../../src/services/saleOfflineUx';
import { describeSaleConfirmBlock } from '../../src/services/trustSignals';
import { getSaleSyncState } from '../../src/services/saleSyncState';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useRouteStore } from '../../src/stores/useRouteStore';
import { useVisitStore } from '../../src/stores/useVisitStore';
import { useProductStore } from '../../src/stores/useProductStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useSyncStore } from '../../src/stores/useSyncStore';
import { useLocationStore } from '../../src/stores/useLocationStore';
import { formatCatalogPrice, formatCurrency } from '../../src/utils/time';
import { takePhoto } from '../../src/services/camera';
import { ProductPicker } from '../../src/components/domain/ProductPicker';
import { shouldSkipStopCheckout } from '../../src/services/virtualStops';
import { OperationGate } from '../../src/components/OperationGate';
import { findFreshStockIssues } from '../../src/services/saleStockValidation';
import { getInsufficientStockDetail, describeInsufficientStock } from '../../src/services/insufficientStock';
import { insufficientStockActionHint } from '../../src/services/secondaryFlowCopy';
import {
  getEffectiveSalesCompanyId,
  getPartnerPricelistId,
  peekResolvedPartnerPricelistId,
} from '../../src/services/pricelist';
import { decideSalePricelist } from '../../src/services/salePricelistDecision';
import { resolveImplicitSaleAnalytics } from '../../src/services/saleAnalytics';
import { logError, logInfo } from '../../src/utils/logger';
import { getLeadPartnerId } from '../../src/services/leadVisit';
import { shouldRefreshProductsOnFocus } from '../../src/utils/productLoading';
import {
  buildRouteLoadAcceptanceState,
  canStartSaleWithRouteLoad,
} from '../../src/services/routeLoadAcceptance';
import { createSale, closeOffrouteVisit } from '../../src/services/gfLogistics';
import { assertCurrentEmployeeDayBundleAllowsActions } from '../../src/services/dayBundleMutationGate';
import { buildLocalStockDelta } from '../../src/services/stockRollback';
import { applySaleStockViaLedger, buildSaleLedgerMovements, commitQueuedOperationWithLedger } from '../../src/services/inventoryLedgerAdapters';
import { buildSalesCreatePayload } from '../../src/services/gfLogisticsContracts';
import {
  buildSaleTicketSnapshot,
  withSaleTicketOdooFolio,
} from '../../src/services/saleTicket';
import { saveSaleTicketSnapshot } from '../../src/services/saleTicketStorage';
import { enqueueVisitPhotos } from '../../src/services/visitPhotos';
import {
  classifySaleSubmissionError,
  readSaleSubmissionErrorMetadata,
} from '../../src/services/saleSubmissionOutcome';
import { persistAmbiguousSaleRecovery } from '../../src/services/saleAmbiguousRecovery';
import { createSaleRecoveryIntent } from '../../src/services/saleRecoveryIntent';
import {
  createSaleConfirmationSingleFlight,
  hasQueuedSaleOrderRecoveryEvidence,
  safeUnknownErrorMessage,
  shouldResumeAfterSale,
} from '../../src/services/saleConfirmationFlow';
import { describeOperationIntentDiagnostics } from '../../src/services/operationIntentDiagnostics';

function SaleScreenInner() {
  const { stopId } = useLocalSearchParams<{ stopId: string }>();
  const router = useRouter();
  const stops = useRouteStore((s) => s.stops);
  const plan = useRouteStore((s) => s.plan);
  const removeStop = useRouteStore((s) => s.removeStop);
  const updateStopState = useRouteStore((s) => s.updateStopState);
  const stop = stops.find((s) => s.id === Number(stopId));
  const companyId = useAuthStore((s) => s.companyId);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const employeeName = useAuthStore((s) => s.employeeName);
  const employeeAnalyticPlazaId = useAuthStore((s) => s.employeeAnalyticPlazaId);
  const employeeAnalyticPlazaName = useAuthStore((s) => s.employeeAnalyticPlazaName);
  const products = useProductStore((s) => s.products);
  const isLoadingProducts = useProductStore((s) => s.isLoading);
  const productError = useProductStore((s) => s.error);
  const loadProducts = useProductStore((s) => s.loadProducts);
  // BLD-20260424-LOOP: pasamos productCount y lastSync al guard del
  // useFocusEffect para evitar el loop de /truck_stock (18 reqs en 7s).
  const productCount = useProductStore((s) => s.productCount);
  const productsLastSync = useProductStore((s) => s.lastSync);

  // Perf Fase 1C: selectors por campo. Antes el destructuring del store hacía
  // que la pantalla de venta re-renderizara cada segundo por el tick del timer
  // (elapsedSeconds), aunque la venta NO lo muestra. Con selectors deja de
  // re-renderizar por el timer.
  const saleLines = useVisitStore((s) => s.saleLines);
  const salePaymentMethod = useVisitStore((s) => s.salePaymentMethod);
  const salePhotoTaken = useVisitStore((s) => s.salePhotoTaken);
  const salePhotoUris = useVisitStore((s) => s.salePhotoUris);
  const updateSaleQty = useVisitStore((s) => s.updateSaleQty);
  const setSalePayment = useVisitStore((s) => s.setSalePayment);
  const saleSubtotal = useVisitStore((s) => s.saleSubtotal);
  const saleTax = useVisitStore((s) => s.saleTax);
  const saleTotal = useVisitStore((s) => s.saleTotal);
  const saleTotalKg = useVisitStore((s) => s.saleTotalKg);
  const resetVisit = useVisitStore((s) => s.resetVisit);
  const offrouteVisitId = useVisitStore((s) => s.offrouteVisitId);

  const isOnline = useSyncStore((s) => s.isOnline);
  const enqueue = useSyncStore((s) => s.enqueue);
  const persistQueue = useSyncStore((s) => s.persistQueue);
  const processQueue = useSyncStore((s) => s.processQueue);
  const releaseProcessingHolds = useSyncStore((s) => s.releaseProcessingHolds);
  const syncQueue = useSyncStore((s) => s.queue);
  const latitude = useLocationStore((s) => s.latitude);
  const longitude = useLocationStore((s) => s.longitude);

  const [pickerVisible, setPickerVisible] = React.useState(false);
  const [lastSaleTicketId, setLastSaleTicketId] = React.useState<string | null>(null);
  const [afterSaleAction, setAfterSaleAction] = React.useState<'checkout' | 'route' | null>(null);
  const [saleSubmitting, setSaleSubmitting] = React.useState(false);
  const saleConfirmationSingleFlightRef = React.useRef<
    ReturnType<typeof createSaleConfirmationSingleFlight> | null
  >(null);
  if (!saleConfirmationSingleFlightRef.current) {
    saleConfirmationSingleFlightRef.current = createSaleConfirmationSingleFlight();
  }
  const saleConfirmationSingleFlight = saleConfirmationSingleFlightRef.current;

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
    }, [warehouseId, isLoadingProducts, productCount, productsLastSync, loadProducts])
  );

  if (!stop) {
    return (
      <SafeAreaView style={styles.safe}>
        <TopBar title="Venta" showBack />
        <View style={styles.center}>
          <Text style={typography.dim}>Parada no encontrada</Text>
        </View>
      </SafeAreaView>
    );
  }

  const subtotal = saleSubtotal();
  const tax = saleTax();
  const total = saleTotal();
  const totalKg = saleTotalKg();
  const forecast = stop._koldForecast;

  // V1.2: Stock validation + anti-duplicate
  const saleConfirmed = useVisitStore((s) => s.saleConfirmed);
  const getStockIssues = useVisitStore((s) => s.getStockIssues);
  // Stock referencial: el vendedor puede confirmar por encima de la
  // referencia local tras un aviso explícito; este ref evita re-preguntar
  // en el re-intento inmediato disparado por "Enviar de todos modos".
  const overStockAckRef = React.useRef(false);
  const lockSaleConfirm = useVisitStore((s) => s.lockSaleConfirm);
  const unlockSaleConfirm = useVisitStore((s) => s.unlockSaleConfirm);
  const persistSaleConfirmationLock = useVisitStore((s) => s.persistSaleConfirmationLock);
  const saleReadyToContinue = useVisitStore((s) => s.saleReadyToContinue);
  const saleRecoveryPersistenceFailed = useVisitStore((s) => s.saleRecoveryPersistenceFailed);
  const saleRecoveryIntent = useVisitStore((s) => s.saleRecoveryIntent);
  const markSaleReadyToContinue = useVisitStore((s) => s.markSaleReadyToContinue);
  const clearSaleConfirmationLock = useVisitStore((s) => s.clearSaleConfirmationLock);
  const setSaleRecoveryPersistenceFailed = useVisitStore(
    (s) => s.setSaleRecoveryPersistenceFailed,
  );
  const stockIssues = getStockIssues();
  const implicitAnalytics = resolveImplicitSaleAnalytics({
    employeeAnalyticPlazaId,
  });
  const hasAnalyticSelection = !!implicitAnalytics.analytic_plaza_id && !!implicitAnalytics.analytic_un_id;
  const hasWarehouse = typeof warehouseId === 'number' && warehouseId > 0;
  const routeLoadState = buildRouteLoadAcceptanceState(plan);
  const canStartSale = canStartSaleWithRouteLoad(plan);
  const canConfirm = saleLines.length > 0 && salePhotoTaken && salePaymentMethod
                     && hasAnalyticSelection && hasWarehouse
                     && canStartSale && !saleConfirmed;
  const salePartnerId = getLeadPartnerId(stop) ?? stop.customer_id;
  // Aviso offline + estado del pedido. Con pedido offline pendiente (S1), el
  // pedido se encola como sale_order y su estado se rastrea por saleOperationId.
  const saleOffline = describeSaleOfflineUx(isOnline);
  const recoveryNotice = describeSaleRecoveryNotice({
    saleConfirmed,
    saleRecoveryPersistenceFailed,
    hasRecoveryIntent: saleRecoveryIntent !== null,
  });
  const saleOperationId = useVisitStore((s) => s.saleOperationId);
  const saleSync = getSaleSyncState(saleOperationId, syncQueue);
  const hasSaleOrderRecoveryEvidence = hasQueuedSaleOrderRecoveryEvidence(
    saleOperationId,
    syncQueue,
  );

  // P0-2 (hardening): si la venta ya estaba confirmada (p.ej. restaurada tras
  // un crash entre confirmar y checkout), reanuda el estado post-venta para que
  // el vendedor continúe al cobro/checkout en vez de re-confirmar (evita venta
  // duplicada). No crea nada: solo reabre la guía "Próxima visita".
  React.useEffect(() => {
    if (shouldResumeAfterSale({
      saleConfirmed,
      hasAfterSaleAction: afterSaleAction !== null,
      stopExists: stop !== undefined,
      saleSubmitting,
      saleRecoveryPersistenceFailed,
      saleReadyToContinue,
      hasQueuedSaleOrderEvidence: hasSaleOrderRecoveryEvidence,
    })) {
      setAfterSaleAction(shouldSkipStopCheckout(stop.id) ? 'route' : 'checkout');
    }
  }, [
    saleConfirmed,
    afterSaleAction,
    stop?.id,
    saleSubmitting,
    saleRecoveryPersistenceFailed,
    saleReadyToContinue,
    saleOperationId,
    hasSaleOrderRecoveryEvidence,
  ]);

  function setSaleQtyFromText(productId: number, qtyText: string) {
    const digits = qtyText.replace(/\D/g, '');
    updateSaleQty(productId, digits ? Number(digits) : 0);
  }

  async function handleAddSalePhoto() {
    const photo = await takePhoto();
    if (photo) {
      useVisitStore.getState().setSalePhoto(photo.localUri);
    } else {
      Alert.alert('Foto requerida', 'No se pudo capturar la foto. Intenta de nuevo.');
    }
  }

  function handleOpenTicket() {
    if (!lastSaleTicketId) return;
    router.push(`/print/${lastSaleTicketId}` as never);
  }

  function handleContinueAfterSale() {
    if (!stop || !afterSaleAction) return;
    if (afterSaleAction === 'route') {
      resetVisit();
      router.replace('/(tabs)/route' as never);
      return;
    }
    router.push(`/checkout/${stop.id}` as never);
  }

  async function handleConfirm() {
    if (saleConfirmed) return; // V1.2: Anti double-tap
    if (saleSubmitting) return;
    try {
      await assertCurrentEmployeeDayBundleAllowsActions();
    } catch (error) {
      Alert.alert('Bundle vencido', safeUnknownErrorMessage(error, 'Renueva el bundle del día antes de vender.'));
      return;
    }

    if (!canStartSale) {
      const pending = routeLoadState.nextPendingLoad;
      Alert.alert(
        pending?.isRefill ? 'Recarga pendiente' : 'Carga pendiente',
        pending
          ? `Acepta ${pending.name} antes de vender.`
          : 'Acepta tu carga pendiente antes de vender.',
      );
      return;
    }

    // Stock REFERENCIAL (auditoría julio, cerrado 2026-08-06): el inventario
    // local/cacheado ya no es tope duro. Cantidades incoherentes (0/NaN)
    // siguen bloqueando; exceder el stock de referencia solo pide
    // confirmación — el backend valida el stock real (insufficient_stock ya
    // refresca inventario y conserva el carrito).
    const freshIssues = findFreshStockIssues(saleLines, useProductStore.getState().products);
    const invalidIssues = freshIssues.filter((i) => i.kind === 'invalid_qty');
    if (invalidIssues.length > 0) {
      Alert.alert(
        'Cantidad inválida',
        invalidIssues.map((i) => `${i.name}: cantidad inválida`).join('\n'),
      );
      return;
    }
    const overStockIssues = freshIssues.filter((i) => i.kind === 'over_stock');
    if (overStockIssues.length > 0 && !overStockAckRef.current) {
      Alert.alert(
        'Stock de referencia excedido',
        overStockIssues
          .map((i) => `${i.name}: pides ${i.requested}, referencia ${i.available}`)
          .join('\n')
          + '\n\nEl inventario local es referencial. El servidor validará el stock real al confirmar.',
        [
          { text: 'Revisar', style: 'cancel' },
          {
            text: 'Enviar de todos modos',
            onPress: () => {
              overStockAckRef.current = true;
              void handleConfirm();
            },
          },
        ],
      );
      return;
    }
    if (overStockIssues.length > 0) {
      overStockAckRef.current = false;
    }

    if (!canConfirm) {
      const missing = [];
      if (saleLines.length === 0) missing.push('productos');
      if (!salePhotoTaken) missing.push('foto del congelador');
      if (!salePaymentMethod) missing.push('metodo de pago');
      if (!implicitAnalytics.analytic_plaza_id) missing.push('plaza del empleado');
      if (!hasWarehouse) missing.push('almacén del empleado');
      Alert.alert('Faltan datos', `Completa: ${missing.join(', ')}`);
      return;
    }

    if (!stop) return;
    if (stop._entityType === 'lead' && !getLeadPartnerId(stop)) {
      Alert.alert('Prospecto no vendible', 'Primero completa Datos para crear o enlazar el contacto del prospecto.');
      return;
    }
    const confirmedPaymentMethod = salePaymentMethod;
    if (!confirmedPaymentMethod) return;

    if (useVisitStore.getState().saleConfirmed) return;
    if (!saleConfirmationSingleFlight.tryAcquire()) return;
    setSaleSubmitting(true);

    // V1.2: Lock to prevent duplicate
    const operationId = lockSaleConfirm();

    // BLD-20260408-P0: Detect off-route sales (virtual stops have negative IDs)
    const isOffRoute = stop.id < 0;
    const saleOffrouteVisitId = offrouteVisitId ?? stop._offrouteVisitId ?? null;
    const effectiveCompanyId = getEffectiveSalesCompanyId(companyId);
    // Only send a pricelist_id when we have one confirmed from the partner's own
    // data (source: partner_field or get_records). Company fallback
    // is cached as null to prevent "Empresas incompatibles" when the partner
    // belongs to a different Odoo company — Odoo assigns its default server-side.
    const stopPricelistId = typeof stop._pricelistId === 'number' && stop._pricelistId > 0
      ? stop._pricelistId
      : null;
    const cachedPricelistId = peekResolvedPartnerPricelistId(
      salePartnerId,
      { companyId: effectiveCompanyId },
    );
    const pricelistDecision = decideSalePricelist({
      isOnline,
      stopPricelistId,
      cachedPricelistId,
    });
    let pricelistId = pricelistDecision.pricelistId;
    try {
      if (pricelistDecision.shouldResolvePartnerPricelist) {
        await getPartnerPricelistId(salePartnerId, { companyId: effectiveCompanyId });
        const resolvedPricelistId = peekResolvedPartnerPricelistId(
          salePartnerId,
          { companyId: effectiveCompanyId },
        );
        pricelistId =
          typeof resolvedPricelistId === 'number' && resolvedPricelistId > 0
            ? resolvedPricelistId
            : null;
      }
    } catch (error) {
      setSaleSubmitting(false);
      saleConfirmationSingleFlight.release();
      unlockSaleConfirm();
      const message = safeUnknownErrorMessage(
        error,
        'No se pudo resolver la lista de precios.',
      );
      Alert.alert('Venta rechazada', message);
      return;
    }

    // Create sale order payload with idempotency key
    const payload = {
      partner_id: salePartnerId,
      stop_id: isOffRoute ? null : stop.id, // Don't send negative virtual IDs to backend
      offroute_visit_id: isOffRoute ? saleOffrouteVisitId : null,
      warehouse_id: warehouseId ?? null,
      _operationId: operationId,
      pricelist_id: pricelistId ?? null,
      analytic_plaza_id: implicitAnalytics.analytic_plaza_id,
      analytic_un_id: implicitAnalytics.analytic_un_id,
      analytic_distribution: implicitAnalytics.analytic_distribution,
      payment_method: salePaymentMethod,
      create_invoice: salePaymentMethod === 'cash',
      lines: saleLines.map((l) => ({
        product_id: l.productId,
        quantity: l.qty,
        discount: 0,
      })),
    };
    const ticketSnapshot = buildSaleTicketSnapshot({
      saleId: operationId,
      customerName: stop.customer_name,
      sellerName: employeeName,
      paymentMethod: confirmedPaymentMethod,
      createdAt: new Date().toISOString(),
      lines: saleLines,
    });
    // F3.2: descuento óptimo de inventario local (S2 — antes S1 no descontaba
    // nada, permitiendo sobreventa offline; ver hallazgo P0 de la auditoría).
    // El delta viaja en el payload encolado para que, si esta venta muere en
    // la cola (rechazo definitivo tras reintentos agotados), el rollback
    // genérico de useSyncStore.ts la revierta sola — no se llama aquí para el
    // caso online-síntesis porque ahí no hay nada que revertir (ya se
    // confirmó con Odoo).
    const localStockDelta = buildLocalStockDelta(
      saleLines.map((l) => ({ product_id: l.productId, qty: l.qty })),
      -1,
    );
    const recoveryIntent = createSaleRecoveryIntent({
      version: 1,
      operationId,
      queuePayload: {
        ...payload,
        _clientCustomerName: stop.customer_name,
        _clientTotal: total,
        _localStockDelta: localStockDelta,
        _ledgerApplied: true,
      },
      stopId: stop.id,
      ticketSnapshot,
      photoUris: [...salePhotoUris],
    });
    const saleLedgerLines = saleLines.map((l) => ({ product_id: l.productId, qty: l.qty }));
    /** Online-confirmed path: ledger RMW only (no new queue row). */
    const deductLocalStockOptimistically = async () => {
      await applySaleStockViaLedger({
        operationId,
        lines: saleLedgerLines,
        stopId: stop.id,
        partnerId: salePartnerId,
      });
    };
    /** Offline/ambiguous: enqueue in memory then ONE envelope write for queue+ledger. */
    const commitQueuedSaleWithLedger = async () => {
      const previousQueue = useSyncStore.getState().queue;
      try {
        await persistAmbiguousSaleRecovery({
          operationId: recoveryIntent.operationId,
          payload: recoveryIntent.queuePayload,
          customerName: recoveryIntent.ticketSnapshot.customerName,
          total: recoveryIntent.ticketSnapshot.total,
          stopId: recoveryIntent.stopId,
          photoUris: recoveryIntent.photoUris,
          enqueue,
          persistQueue,
          deferDurablePersist: true,
          releaseProcessingHolds,
        });
        const movements = buildSaleLedgerMovements({
          operationId,
          lines: saleLedgerLines,
          stopId: stop.id,
          partnerId: salePartnerId,
        });
        await commitQueuedOperationWithLedger({
          nextQueue: useSyncStore.getState().queue,
          movements,
        });
      } catch (error) {
        useSyncStore.getState().replaceQueueFromDurable(previousQueue);
        throw error;
      }
    };

    logInfo('general', 'sale_confirm_payload', {
      partner_id: salePartnerId,
      stop_id: payload.stop_id,
      offroute_visit_id: payload.offroute_visit_id,
      warehouse_id: payload.warehouse_id,
      pricelist_id: payload.pricelist_id,
      analytic_plaza_id: payload.analytic_plaza_id,
      analytic_un_id: payload.analytic_un_id,
      employee_analytic_plaza_id: employeeAnalyticPlazaId,
      employee_analytic_plaza_name: employeeAnalyticPlazaName,
      line_count: payload.lines.length,
      company_id: companyId,
      effective_company_id: effectiveCompanyId,
    });

    try {
      const lockPersisted = await persistSaleConfirmationLock(operationId, recoveryIntent);
      if (!lockPersisted) {
        throw new Error('The sale confirmation lock no longer matches the active visit');
      }
    } catch (lockPersistError) {
      setSaleRecoveryPersistenceFailed(true);
      setSaleSubmitting(false);
      logError('sync', 'sale_confirmation_lock_persist_failed', {
        operation_id: operationId,
        message: safeUnknownErrorMessage(
          lockPersistError,
          'Error desconocido al guardar el identificador de la venta.',
        ),
      });
      Alert.alert(
        'Pedido no enviado',
        'No se envió el pedido porque no pudimos guardar de forma segura su identificador. No cierres la aplicación; mantén esta pantalla abierta.',
      );
      return;
    }

    // Pedido offline pendiente (S1): sin señal, NO bloqueamos — encolamos el
    // pedido como `sale_order` (+ foto) para enviarlo a Odoo al reconectar. NO
    // se marca como venta confirmada ni se crea pago/stock definitivo: el
    // dispatcher de la cola ejecuta createSale (que confirma+cobra en Odoo) solo
    // cuando hay conexión. Idempotente por _operationId. cashclose/route-close
    // ya bloquean el cierre/liquidación mientras haya pendientes en la cola.
    if (!isOnline) {
      try {
        await saveSaleTicketSnapshot(recoveryIntent.ticketSnapshot);
      } catch (ticketError) {
        setSaleRecoveryPersistenceFailed(true);
        setSaleSubmitting(false);
        logError('sync', 'offline_sale_ticket_persist_failed', {
          operation_id: operationId,
          message: safeUnknownErrorMessage(
            ticketError,
            'Error desconocido al guardar el comprobante sin conexión.',
          ),
        });
        Alert.alert(
          'Comprobante local no guardado',
          'No pudimos guardar de forma segura el comprobante local. La operación permanece bloqueada y se recuperará con el mismo identificador; mantén esta pantalla abierta.',
        );
        return;
      }

      try {
        // POST-R1A closure: queue + ledger in one encrypted envelope write.
        await commitQueuedSaleWithLedger();
      } catch (persistError) {
        setSaleRecoveryPersistenceFailed(true);
        setSaleSubmitting(false);
        logError('sync', 'offline_sale_queue_ledger_persist_failed', {
          operation_id: operationId,
          message: safeUnknownErrorMessage(
            persistError,
            'Error desconocido al guardar el pedido sin conexión.',
          ),
        });
        Alert.alert(
          'No cierres la aplicación',
          'No pudimos guardar de forma atómica el pedido y el inventario local. La operación permanece bloqueada y se recuperará con el mismo identificador.',
        );
        return;
      }
      // checkout/ruta rastrean el pedido por el mismo id durable del lock.
      setLastSaleTicketId(operationId);
      setSaleSubmitting(false);
      Alert.alert(
        'Pedido guardado',
        'Pedido pendiente de envío. Se enviará a Odoo cuando haya conexión; no queda confirmado hasta entonces.',
      );
      if (shouldSkipStopCheckout(stop.id)) {
        updateStopState(stop.id, 'done');
        setAfterSaleAction('route');
      } else {
        setAfterSaleAction('checkout');
      }
      return;
    }

    let confirmedTicketSnapshot: typeof recoveryIntent.ticketSnapshot;
    try {
      const saleResult = await createSale(buildSalesCreatePayload(payload));
      confirmedTicketSnapshot = withSaleTicketOdooFolio(
        recoveryIntent.ticketSnapshot,
        saleResult.name,
      );
      // F3.2 / POST-R1A: Odoo confirmed — ledger apply for sellable projection.
      await deductLocalStockOptimistically();
    } catch (error) {
      const outcome = classifySaleSubmissionError(error);
      const metadata = readSaleSubmissionErrorMetadata(error);
      logInfo('general', 'sale_submission_outcome', {
        operation_id: operationId,
        outcome: outcome.kind,
        http_status: metadata.httpStatus,
        code: metadata.code,
        ...(outcome.kind === 'ambiguous_result'
          ? describeOperationIntentDiagnostics({
            operationType: 'sale_order',
            operationId,
            payload: recoveryIntent.queuePayload,
            recoveryState: saleRecoveryPersistenceFailed ? 'persist_failed' : 'pending',
            queueState: 'submitting',
          })
          : {}),
      });

      if (outcome.kind === 'definitive_rejection') {
        try {
          const cleared = await clearSaleConfirmationLock(operationId);
          if (!cleared) {
            throw new Error('The rejected sale no longer matches the active visit');
          }
        } catch (clearError) {
          setSaleRecoveryPersistenceFailed(true);
          setSaleSubmitting(false);
          logError('sync', 'sale_definitive_clear_persist_failed', {
            operation_id: operationId,
            message: safeUnknownErrorMessage(
              clearError,
              'Error desconocido al limpiar el bloqueo de la venta rechazada.',
            ),
          });
          Alert.alert(
            'Venta rechazada con bloqueo local',
            'Odoo rechazó la venta, pero no pudimos guardar de forma segura el desbloqueo. La operación permanece bloqueada para evitar duplicados.',
          );
          return;
        }
        setSaleSubmitting(false);
        saleConfirmationSingleFlight.release();
        // insufficient_stock: el backend rechazó por stock. Refrescamos el
        // inventario para mostrar el available_qty REAL y dejamos el carrito
        // intacto para que el vendedor ajuste cantidades. NO se marca como venta.
        const insufficient = getInsufficientStockDetail(error);
        if (insufficient) {
          if (warehouseId) void loadProducts(warehouseId);
          Alert.alert(
            'Stock insuficiente (servidor)',
            `${describeInsufficientStock(insufficient)}\n\n${insufficientStockActionHint()}`,
          );
          return;
        }
        Alert.alert(
          'Venta rechazada',
          metadata.message ?? 'No se pudo confirmar la venta en Odoo.',
        );
        return;
      }

      try {
        await saveSaleTicketSnapshot(recoveryIntent.ticketSnapshot);
        // POST-R1A closure: queue + ledger atomic (same operation_id).
        await commitQueuedSaleWithLedger();
        setSaleRecoveryPersistenceFailed(false);
      } catch (persistError) {
        setSaleRecoveryPersistenceFailed(true);
        setSaleSubmitting(false);
        logError('sync', 'ambiguous_sale_queue_ledger_persist_failed', {
          operation_id: operationId,
          message: safeUnknownErrorMessage(
            persistError,
            'Error desconocido al guardar la recuperación.',
          ),
        });
        Alert.alert(
          'No cierres la aplicación',
          'No pudimos guardar de forma atómica el pedido y el inventario local. La operación permanece bloqueada; mantén abierta la aplicación e intenta sincronizar nuevamente.',
        );
        return;
      }

      void processQueue().catch((processError) => logError(
        'sync',
        'ambiguous_sale_process_start_failed',
        {
          operation_id: operationId,
          message: safeUnknownErrorMessage(
            processError,
            'Error desconocido al iniciar la sincronización.',
          ),
        },
      ));

      useVisitStore.setState({ saleOperationId: operationId });
      setLastSaleTicketId(operationId);
      setSaleSubmitting(false);
      Alert.alert(
        'Pedido pendiente de verificación',
        'No pudimos confirmar la respuesta del servidor. El pedido quedó pendiente de verificación y se reintentará con el mismo identificador.',
      );
      if (shouldSkipStopCheckout(stop.id)) {
        updateStopState(stop.id, 'done');
        setAfterSaleAction('route');
      } else {
        setAfterSaleAction('checkout');
      }
      return;
    }

    try {
      const markedReadyToContinue = await markSaleReadyToContinue(
        operationId,
        { clearOperationId: true },
      );
      if (!markedReadyToContinue) {
        throw new Error('The confirmed sale no longer matches the active visit');
      }
    } catch (persistError) {
      setSaleRecoveryPersistenceFailed(true);
      setSaleSubmitting(false);
      logError('sync', 'sale_remote_confirmation_state_persist_failed', {
        operation_id: operationId,
        message: safeUnknownErrorMessage(
          persistError,
          'Error desconocido al guardar el estado confirmado.',
        ),
      });
      Alert.alert(
        'La venta se confirmó',
        'La venta se confirmó en Odoo, pero no pudimos guardar de forma segura el estado para continuar. No cierres la aplicación; mantén esta pantalla abierta.',
      );
      return;
    }

    try {
      enqueueVisitPhotos({
        stopId: stop.id,
        photoUris: salePhotoUris,
        enqueue,
        imageType: 'sale',
      });
      await saveSaleTicketSnapshot(confirmedTicketSnapshot);
      setLastSaleTicketId(operationId);
    } catch (error) {
      const message = safeUnknownErrorMessage(
        error,
        'Error desconocido al completar los datos locales.',
      );
      logError('sync', 'sale_post_confirmation_failed', {
        operation_id: operationId,
        message,
      });
      Alert.alert(
        'Venta confirmada con aviso',
        `La venta se confirmó, pero no pudimos completar las fotos o el comprobante local. ${message}`,
      );
    }

    setSaleSubmitting(false);
    if (warehouseId) {
      void loadProducts(warehouseId);
    }

    if (shouldSkipStopCheckout(stop.id)) {
      if (offrouteVisitId) {
        try {
          await closeOffrouteVisit({
            visit_id: offrouteVisitId,
            result_status: 'sale' as const,
            latitude: latitude || 0,
            longitude: longitude || 0,
          });
        } catch (error) {
          const message = safeUnknownErrorMessage(
            error,
            'La venta se confirmó, pero no se pudo cerrar la visita especial.',
          );
          Alert.alert('Cierre pendiente en Odoo', message);
        }
      }
      updateStopState(stop.id, 'done');
      setAfterSaleAction('route');
      return;
    }

    setAfterSaleAction('checkout');
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <TopBar title="Nueva Venta" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Customer + forecast hint */}
        <Text style={[typography.dim, styles.customerName]}>{stop.customer_name}</Text>
        {forecast && (
          <Text style={[typography.dimSmall, styles.forecastHint]}>
            Sugerido KoldDemand: {forecast.predicted_kg.toFixed(0)} kg
          </Text>
        )}

        {/* Aviso offline temprano: la venta se confirma online-first. */}
        {saleOffline.showBanner && (
          <AlertBanner variant="warning" icon="📶" message={saleOffline.bannerText} />
        )}
        {recoveryNotice.show && (
          <AlertBanner variant="warning" icon="⚠️" message={recoveryNotice.message} />
        )}

        {/* Product lines */}
        {saleLines.length === 0 ? (
          <View style={styles.emptyProducts}>
            <Text style={typography.dim}>Agrega productos a la venta</Text>
            <Text style={[typography.dimSmall, { marginTop: 4 }]}>
              F4: Integración con catálogo de productos
            </Text>
          </View>
        ) : (
          saleLines.map((line) => (
            <View key={line.productId} style={styles.productLine}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.bodySmall, styles.productName]}>{line.productName}</Text>
                <Text style={[typography.dimSmall, styles.productInfo]}>
                  {formatCatalogPrice(line.price)} · Stock: {line.stock}{!isOnline ? ' · ref.' : ''}
                </Text>
              </View>
              <View style={styles.qtyControls}>
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateSaleQty(line.productId, line.qty - 1)}
                >
                  <Text style={typography.stepperGlyph}>−</Text>
                </TouchableOpacity>
                <TextInput
                  accessibilityLabel={`Piezas de ${line.productName}`}
                  style={[typography.scoreValue, styles.qtyValue]}
                  value={String(line.qty)}
                  onChangeText={(text) => setSaleQtyFromText(line.productId, text)}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  selectTextOnFocus
                  maxLength={4}
                />
                <TouchableOpacity
                  style={styles.qtyBtn}
                  onPress={() => updateSaleQty(line.productId, line.qty + 1)}
                >
                  <Text style={typography.stepperGlyph}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {/* Product picker */}
        {isLoadingProducts && saleLines.length === 0 && (
          <View style={styles.emptyProducts}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[typography.dim, { marginTop: 8 }]}>Cargando productos...</Text>
          </View>
        )}
        {!isLoadingProducts && productError && products.length === 0 && (
          <View style={styles.emptyProducts}>
            <Text style={typography.dim}>{productError}</Text>
          </View>
        )}
        <Button
          label="+ Agregar producto"
          variant="secondary"
          small
          fullWidth
          onPress={() => setPickerVisible(true)}
          disabled={isLoadingProducts || (!!productError && products.length === 0)}
          style={{ marginVertical: 10 }}
        />
        <ProductPicker
          visible={pickerVisible}
          onClose={() => setPickerVisible(false)}
          existingProductIds={saleLines.map((l) => l.productId)}
          partnerId={salePartnerId}
          pricelistId={stop._pricelistId}
          allowPendingPrice
        />

        {/* Totals card */}
        <Card style={styles.totalsCard}>
          <View style={styles.totalRow}>
            <Text style={[typography.dim, styles.totalLabel]}>Subtotal</Text>
            <Text style={typography.metricValue}>{formatCurrency(subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[typography.dim, styles.totalLabel]}>Impuestos</Text>
            <Text style={typography.metricValue}>{formatCurrency(tax)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={[typography.dim, styles.totalLabel]}>Total kg</Text>
            <Text style={[typography.metricValue, { color: colors.primary }]}>
              {totalKg.toFixed(1)} kg
            </Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <Text style={[typography.body, styles.grandTotalLabel]}>TOTAL</Text>
            <Text style={[typography.kpiValueLarge, styles.grandTotalValue]}>{formatCurrency(total)}</Text>
          </View>
          {!isOnline && (
            <Text style={[typography.dimSmall, styles.referentialNote]}>
              ⚠️ Precios y stock REFERENCIALES (sin conexión). Odoo confirma el monto al sincronizar.
            </Text>
          )}
        </Card>

        {/* Payment method */}
        <View style={styles.paymentRow}>
          <Button
            label="💵 Efectivo"
            variant={salePaymentMethod === 'cash' ? 'primary' : 'secondary'}
            onPress={() => setSalePayment('cash')}
            style={{ flex: 1 }}
          />
          <Button
            label="💳 Crédito"
            variant={salePaymentMethod === 'credit' ? 'primary' : 'secondary'}
            onPress={() => setSalePayment('credit')}
            style={{ flex: 1 }}
          />
        </View>

        <View style={styles.analyticsInfo}>
          <Text style={typography.sectionTitle}>Analiticas</Text>
          <Text style={[typography.dim, styles.analyticsInfoText]}>
            Plaza: {employeeAnalyticPlazaName || 'Sin configurar en empleado'}
          </Text>
          <Text style={[typography.dim, styles.analyticsInfoText]}>
            Unidad de negocio: CEDIS
          </Text>
        </View>

        {/* Mandatory photo */}
        <Text style={typography.sectionTitle}>📸 Foto del congelador (obligatoria)</Text>
        {salePhotoTaken ? (
          <View style={styles.photoDone}>
            <Text style={typography.stateIcon}>📸</Text>
            <Text style={[typography.dim, { color: colors.success, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              {salePhotoUris.length} {salePhotoUris.length === 1 ? 'foto capturada' : 'fotos capturadas'}
            </Text>
            <TouchableOpacity style={styles.addPhotoBtn} onPress={handleAddSalePhoto}>
              <Text style={[typography.buttonSmall, styles.addPhotoText]}>Agregar otra foto</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.photoReq}
            onPress={handleAddSalePhoto}
          >
            <Text style={typography.stateIcon}>📸</Text>
            <Text style={[typography.bodySmall, { color: colors.primary, fontFamily: fonts.bodyBold, fontWeight: '700' }]}>
              Tomar foto del congelador
            </Text>
            <Text style={typography.dimSmall}>
              Encuadra el congelador con el producto acomodado
            </Text>
          </TouchableOpacity>
        )}

        {routeLoadState.hasPendingLoad && routeLoadState.nextPendingLoad && (
          <View style={styles.loadWarning}>
            <Text style={[typography.dim, styles.loadWarningTitle]}>
              {routeLoadState.nextPendingLoad.isRefill ? 'Recarga pendiente' : 'Carga pendiente'}
            </Text>
            <Text style={[typography.dimSmall, styles.loadWarningLine]}>
              Acepta {routeLoadState.nextPendingLoad.name} en Inicio antes de confirmar ventas.
            </Text>
          </View>
        )}

        {/* Stock referencial: aviso, no bloqueo — el backend valida el real */}
        {stockIssues.length > 0 && (
          <View style={styles.stockWarning}>
            <Text style={[typography.dim, styles.stockWarningTitle]}>⚠️ Sobre stock de referencia</Text>
            {stockIssues.map((issue) => (
              <Text key={issue.productId} style={[typography.dimSmall, styles.stockWarningLine]}>
                {issue.name}: pides {issue.requested}, referencia {issue.available}
              </Text>
            ))}
            <Text style={[typography.dimSmall, styles.stockWarningLine]}>
              El servidor validará el stock real al confirmar.
            </Text>
          </View>
        )}

      </ScrollView>

      {/* Barra fija de acción: total siempre visible + CTA. Reemplaza el
          patrón anterior de "botón al fondo del scroll con FABs encima". */}
      <View style={styles.fixedBar}>
        <View style={styles.fixedBarTotal}>
          <Text style={[typography.dim, styles.fixedBarTotalLabel]}>
            TOTAL{saleLines.length > 0 ? ` · ${saleLines.reduce((sum, l) => sum + l.qty, 0)} piezas` : ''}
          </Text>
          <Text style={[typography.kpiValueLarge, styles.fixedBarTotalValue]}>{formatCurrency(total)}</Text>
        </View>

        {saleConfirmed && afterSaleAction ? (
          <>
            {lastSaleTicketId ? (
              <Button
                label="Ver ticket PDF"
                variant="secondary"
                onPress={handleOpenTicket}
                fullWidth
                style={{ marginBottom: 8 }}
              />
            ) : null}
            <Button
              label={afterSaleAction === 'route' ? 'Volver a ruta' : 'Próxima visita'}
              onPress={handleContinueAfterSale}
              fullWidth
            />
          </>
        ) : (
          <>
            {/* Etiqueta refleja: pendiente de envío / enviado / error (pedido
                offline) · guardar pendiente (offline pre-confirm) ·
                confirmado (venta online directa) · confirmar. */}
            <Button
              label={saleConfirmButtonLabel({
                saleSyncStatus: saleSync.status,
                isOnline,
                saleConfirmed,
                saleRecoveryPersistenceFailed,
                hasRecoveryIntent: saleRecoveryIntent !== null,
              })}
              onPress={handleConfirm}
              fullWidth
              disabled={saleConfirmed}
              loading={false}
            />

            {/* Aviso offline bajo el botón (no se deshabilita: conectividad
                intermitente; el guard de confirmación cubre el caso offline). */}
            {saleOffline.buttonHint && (
              <Text style={[typography.dimSmall, styles.validationHint]}>{saleOffline.buttonHint}</Text>
            )}

            {/* Validation feedback — razón única y clara de por qué está
                bloqueado (helper puro describeSaleConfirmBlock, testeable). */}
            {(() => {
              const reason = describeSaleConfirmBlock({
                hasLines: saleLines.length > 0,
                photoTaken: salePhotoTaken,
                paymentSelected: !!salePaymentMethod,
                hasPlaza: !!implicitAnalytics.analytic_plaza_id,
                hasWarehouse,
                routeLoadAccepted: canStartSale,
              });
              return reason ? <Text style={[typography.dimSmall, styles.validationHint]}>{reason}</Text> : null;
            })()}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// P0-4 (hardening): gate de readiness — no permitir vender sin plan activo +
// checklist + KM inicial + carga aceptada (evita salto de flujo por deep link).
export default function SaleScreen() {
  return (
    <OperationGate title="Venta">
      <SaleScreenInner />
    </OperationGate>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 16 },
  customerName: { color: colors.textDim, marginBottom: 2 },
  forecastHint: { color: colors.primary, marginBottom: 14 },
  emptyProducts: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 20,
    alignItems: 'center',
    marginBottom: 10,
  },
  // Product line (.pl in mockup)
  productLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    marginBottom: 5,
  },
  productName: { fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.text },
  productInfo: { color: colors.textDim },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  qtyBtn: {
    width: 46, height: 46, borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  qtyValue: {
    minWidth: 48, height: 46, textAlign: 'center',
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.borderLight,
    borderRadius: radii.button,
    paddingHorizontal: 6, paddingVertical: 0,
  },
  // Totals
  totalsCard: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  totalLabel: { color: colors.textDim },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  referentialNote: { color: colors.warning, fontFamily: fonts.bodyBold, fontWeight: '700', marginTop: 8, lineHeight: 15 },
  grandTotalLabel: { fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.text },
  grandTotalValue: { color: colors.success },
  // Payment
  paymentRow: { flexDirection: 'row', gap: 6, marginVertical: 10 },
  analyticsInfo: {
    backgroundColor: colors.cardLighter,
    borderRadius: radii.card,
    padding: 12,
    marginBottom: 10,
  },
  analyticsInfoText: {
    color: colors.text,
    marginTop: 4,
  },
  // Photo
  photoReq: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(0,119,187,0.3)',
    borderRadius: radii.card, padding: 28, alignItems: 'center', gap: 6,
  },
  photoDone: {
    backgroundColor: colors.cardLighter,
    borderWidth: 2, borderColor: colors.success,
    borderRadius: radii.card, padding: 14, alignItems: 'center', gap: 4,
  },
  addPhotoBtn: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.button,
    backgroundColor: colors.primaryAlpha12,
  },
  addPhotoText: {
    color: colors.primary,
  },
  validationHint: {
    color: colors.warning, textAlign: 'center', marginTop: 8,
  },
  fixedBar: {
    paddingHorizontal: spacing.screenPadding,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.bg,
  },
  fixedBarTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  fixedBarTotalLabel: {
    fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.textDim,
  },
  fixedBarTotalValue: {
    fontWeight: '800', color: colors.success,
  },
  loadWarning: {
    backgroundColor: colors.warningAlpha08,
    borderWidth: 1,
    borderColor: 'rgba(180,83,9,0.28)',
    borderRadius: radii.button,
    padding: 10,
    marginTop: 8,
  },
  loadWarningTitle: {
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
    color: colors.warning,
    marginBottom: 4,
  },
  loadWarningLine: {
    color: colors.warning,
    lineHeight: 16,
  },
  // V1.2
  stockWarning: {
    backgroundColor: colors.errorAlpha08, borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.15)', borderRadius: radii.button,
    padding: 10, marginTop: 8,
  },
  stockWarningTitle: {
    fontFamily: fonts.bodyBold, fontWeight: '700', color: colors.error, marginBottom: 4,
  },
  stockWarningLine: {
    color: colors.error, lineHeight: 16,
  },
});
