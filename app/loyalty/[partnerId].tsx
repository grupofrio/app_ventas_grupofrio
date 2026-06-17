/**
 * Programa de Lealtad — Puntos, nivel y beneficios del cliente.
 *
 * MVP de LECTURA. Lee campos de res.partner (gf_partner_loyalty) vía
 * fetchPartnerLoyalty. No hay redención (el backend no tiene modelo de
 * recompensas) — ver docs/KOLDFIELD_LOYALTY_QA.md.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useSyncStore } from '../../src/stores/useSyncStore';
import {
  fetchPartnerLoyalty,
  describeLoyaltyLevel,
  hasLoyaltyData,
  type PartnerLoyalty,
} from '../../src/services/loyalty';

export default function ProgramadeLealtadScreen() {
  const { partnerId } = useLocalSearchParams<{ partnerId: string }>();
  const id = Number(partnerId);
  const isOnline = useSyncStore((s) => s.isOnline);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<PartnerLoyalty | null>(null);

  const load = useCallback(async () => {
    if (!id || id <= 0) { setError('Cliente inválido.'); setLoading(false); return; }
    if (!isOnline) { setError(null); setLoading(false); return; } // sin caché de lealtad
    setLoading(true);
    setError(null);
    try {
      setLoyalty(await fetchPartnerLoyalty(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la lealtad.');
      setLoyalty(null);
    } finally {
      setLoading(false);
    }
  }, [id, isOnline]);

  useEffect(() => { void load(); }, [load]);

  const levelInfo = describeLoyaltyLevel(loyalty?.level ?? null);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="⭐ Programa de Lealtad" showBack />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
      >
        {/* Sin conexión (no hay caché de lealtad) */}
        {!isOnline && !loyalty ? (
          <Card>
            <Text style={styles.bigIcon}>📶</Text>
            <Text style={[typography.body, styles.center]}>Sin conexión</Text>
            <Text style={[typography.dim, styles.center, { marginTop: 4 }]}>
              La lealtad se consulta en línea. Conéctate para ver puntos y nivel.
            </Text>
          </Card>
        ) : loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[typography.dim, { marginTop: 10 }]}>Cargando lealtad…</Text>
          </View>
        ) : error ? (
          <Card>
            <Text style={[styles.errorText, styles.center]}>{error}</Text>
            <Button label="Reintentar" variant="secondary" small onPress={load} style={{ marginTop: 10, alignSelf: 'center' }} />
          </Card>
        ) : !hasLoyaltyData(loyalty) ? (
          <Card>
            <Text style={styles.bigIcon}>⭐</Text>
            <Text style={[typography.body, styles.center]}>
              {loyalty?.name || 'Cliente'}
            </Text>
            <Text style={[typography.dim, styles.center, { marginTop: 6 }]}>
              Este cliente aún no tiene programa de lealtad activo.
            </Text>
          </Card>
        ) : (
          <>
            <Card>
              <Text style={styles.bigIcon}>{levelInfo.emoji}</Text>
              <Text style={[styles.levelLabel, styles.center]}>{levelInfo.label}</Text>
              <Text style={[typography.dim, styles.center, { marginTop: 2 }]}>
                {loyalty?.name || 'Cliente'}
              </Text>
              {levelInfo.next ? (
                <Text style={[typography.dimSmall, styles.center, { marginTop: 8 }]}>
                  Siguiente nivel: {levelInfo.next}
                </Text>
              ) : (
                <Text style={[typography.dimSmall, styles.center, { marginTop: 8 }]}>
                  Nivel máximo alcanzado 🎉
                </Text>
              )}
            </Card>

            <Card style={{ marginTop: spacing.md }}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Racha (semanas con compra)</Text>
                <Text style={styles.metricValue}>{loyalty?.streakWeeks ?? 0}</Text>
              </View>
              {loyalty?.lastOrderWeek != null ? (
                <View style={styles.metricRow}>
                  <Text style={styles.metricLabel}>Última compra (semana ISO)</Text>
                  <Text style={styles.metricValue}>{loyalty.lastOrderWeek}</Text>
                </View>
              ) : null}
            </Card>

            <Text style={[typography.dimSmall, styles.center, { marginTop: spacing.md }]}>
              Solo lectura. La redención de beneficios no está disponible en la app.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100, paddingTop: spacing.md },
  center: { textAlign: 'center' },
  bigIcon: { fontSize: 40, textAlign: 'center', marginBottom: 8 },
  loadingBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  errorText: { fontSize: 13, color: '#EF4444', fontWeight: '600' },
  levelLabel: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  metricRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  metricLabel: { fontSize: 14, color: colors.textDim, flex: 1 },
  metricValue: { fontFamily: fonts.monoBold, fontSize: 18, fontWeight: '800', color: colors.primary },
});
