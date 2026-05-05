/**
 * RoutePreparationCard — "Preparar ruta" card for the Home screen.
 *
 * Four states (see useRoutePreparationStore):
 *   A. No preparada    → invite to prepare with WiFi at CEDIS
 *   B. Preparando      → progress + currentStep + X/Y clientes
 *   C. Preparada       → time + counts + (optional) retry pendientes
 *   D. Sin conexión    → soft hint, does NOT block
 *
 * Reuses the in-flight dedupe + concurrency limit from PR #14, so it is
 * safe to mount alongside the auto-preload effect in Home.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, radii } from '../../theme/tokens';
import { fonts } from '../../theme/typography';
import { useRoutePreparationStore } from '../../stores/useRoutePreparationStore';
import { useRouteStore } from '../../stores/useRouteStore';
import { useSyncStore } from '../../stores/useSyncStore';
import {
  formatPreparedAt,
  isPreparationFreshForPlan,
} from '../../services/routePreparationLogic';

export function RoutePreparationCard() {
  const isPreparing = useRoutePreparationStore((s) => s.isPreparing);
  const currentStep = useRoutePreparationStore((s) => s.currentStep);
  const customersTotal = useRoutePreparationStore((s) => s.customersTotal);
  const customersPrepared = useRoutePreparationStore((s) => s.customersPrepared);
  const pricesPrepared = useRoutePreparationStore((s) => s.pricesPrepared);
  const preparedAt = useRoutePreparationStore((s) => s.preparedAt);
  const preparedPlanId = useRoutePreparationStore((s) => s.preparedPlanId);
  const failures = useRoutePreparationStore((s) => s.failures);
  const lastError = useRoutePreparationStore((s) => s.lastError);
  const prepareRouteData = useRoutePreparationStore((s) => s.prepareRouteData);
  const retryFailures = useRoutePreparationStore((s) => s.retryFailures);

  const planId = useRouteStore((s) => s.plan?.plan_id ?? null);
  const isOnline = useSyncStore((s) => s.isOnline);

  const isFresh = isPreparationFreshForPlan(preparedPlanId, planId);

  // ── State A — preparing ────────────────────────────────────────────────
  if (isPreparing) {
    const subtitle = customersTotal > 0
      ? `${customersPrepared}/${customersTotal} clientes`
      : currentStep || 'Preparando…';
    return (
      <View style={[styles.card, styles.cardPreparing]}>
        <View style={styles.headerRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.title}>Preparando ruta…</Text>
        </View>
        <Text style={styles.body}>{currentStep || 'Cargando datos'}</Text>
        <Text style={styles.metric}>{subtitle}</Text>
        <TouchableOpacity style={[styles.btn, styles.btnDisabled]} disabled>
          <Text style={styles.btnText}>Preparando…</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── State C — prepared (and same plan) ─────────────────────────────────
  if (isFresh && preparedAt) {
    const hasFailures = failures.length > 0;
    return (
      <View style={[styles.card, hasFailures ? styles.cardWarning : styles.cardOk]}>
        <View style={styles.headerRow}>
          <Text style={styles.icon}>{hasFailures ? '⚠️' : '✅'}</Text>
          <Text style={styles.title}>
            {hasFailures ? 'Ruta preparada con pendientes' : 'Ruta lista para salir'}
          </Text>
        </View>
        <Text style={styles.body}>Preparada a las {formatPreparedAt(preparedAt)}</Text>
        <Text style={styles.metric}>
          Clientes: {customersPrepared}/{customersTotal} · Precios precargados: {pricesPrepared}
        </Text>
        {hasFailures && (
          <>
            <Text style={[styles.metric, { color: '#EF4444' }]}>
              Pendientes: {failures.length}
            </Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => { void retryFailures(); }}
              accessibilityRole="button"
              accessibilityLabel="Reintentar pendientes de preparación"
            >
              <Text style={styles.btnText}>Reintentar pendientes</Text>
            </TouchableOpacity>
          </>
        )}
        {!isOnline && (
          <Text style={styles.hint}>Sin conexión: se usarán datos en caché.</Text>
        )}
      </View>
    );
  }

  // ── State A — not prepared (or stale) ──────────────────────────────────
  return (
    <View style={[styles.card, styles.cardIdle]}>
      <View style={styles.headerRow}>
        <Text style={styles.icon}>📦</Text>
        <Text style={styles.title}>Ruta no preparada</Text>
      </View>
      <Text style={styles.body}>
        Prepara la ruta en el CEDIS con WiFi antes de salir. Se cargarán clientes,
        productos y precios para operar offline.
      </Text>
      {lastError && (
        <Text style={styles.errorMsg} numberOfLines={3}>{lastError}</Text>
      )}
      <TouchableOpacity
        style={styles.btn}
        onPress={() => { void prepareRouteData(); }}
        accessibilityRole="button"
        accessibilityLabel="Preparar ruta para operar offline"
      >
        <Text style={styles.btnText}>Preparar ruta</Text>
      </TouchableOpacity>
      {!isOnline && (
        <Text style={styles.hint}>
          Recomendado hacerlo con WiFi en CEDIS.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  cardIdle: {
    borderColor: 'rgba(37,99,235,0.25)',
    backgroundColor: 'rgba(37,99,235,0.05)',
  },
  cardPreparing: {
    borderColor: 'rgba(37,99,235,0.4)',
    backgroundColor: 'rgba(37,99,235,0.07)',
  },
  cardOk: {
    borderColor: 'rgba(34,197,94,0.3)',
    backgroundColor: 'rgba(34,197,94,0.05)',
  },
  cardWarning: {
    borderColor: 'rgba(234,179,8,0.35)',
    backgroundColor: 'rgba(234,179,8,0.06)',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  icon: { fontSize: 18 },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
  },
  body: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
    marginBottom: 8,
  },
  metric: {
    fontFamily: fonts.monoBold,
    fontSize: 12,
    color: colors.text,
    marginBottom: 4,
  },
  errorMsg: {
    fontSize: 11,
    color: '#EF4444',
    marginBottom: 8,
  },
  btn: {
    marginTop: 6,
    backgroundColor: colors.primary,
    borderRadius: radii.button,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  hint: {
    fontSize: 10,
    color: colors.textDim,
    marginTop: 6,
    textAlign: 'center',
  },
});
