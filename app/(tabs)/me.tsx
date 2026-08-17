/**
 * Yo tab — profile, settings, ranking and account actions.
 * Tasks/Alerts live under Mi Día; this hub owns the personal surface.
 */

import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SyncBar } from '../../src/components/ui/SyncBar';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { typography, fonts } from '../../src/theme/typography';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useSyncStore } from '../../src/stores/useSyncStore';

type HubItem = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  href: string;
};

const HUB_ITEMS: HubItem[] = [
  {
    key: 'profile',
    title: 'Perfil',
    subtitle: 'Datos del empleado y sesión',
    icon: 'person-circle-outline',
    href: '/profile',
  },
  {
    key: 'ranking',
    title: 'Mi ranking',
    subtitle: 'Posición y desempeño del día',
    icon: 'trophy-outline',
    href: '/ranking',
  },
];

export default function MeScreen() {
  const router = useRouter();
  const employeeName = useAuthStore((s) => s.employeeName);
  const companyName = useAuthStore((s) => s.companyName);
  const warehouseId = useAuthStore((s) => s.warehouseId);
  const pendingCount = useSyncStore((s) => s.pendingCount);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <SyncBar />
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YO</Text>
        <Text style={styles.title}>{employeeName || 'Vendedor'}</Text>
        <Text style={styles.meta}>
          {[companyName, warehouseId ? `Almacén ${warehouseId}` : null]
            .filter(Boolean)
            .join(' · ') || 'Sin compañía'}
        </Text>
        {pendingCount > 0 ? (
          <Text style={styles.pending}>
            {pendingCount} operación(es) pendientes de sincronizar
          </Text>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {HUB_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={styles.row}
            onPress={() => router.push(item.href as never)}
            accessibilityRole="button"
            accessibilityLabel={item.title}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={item.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowSub}>{item.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
          </TouchableOpacity>
        ))}

        <Text style={styles.hint}>
          Ajustes avanzados y cierre de sesión están en Perfil.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  eyebrow: {
    ...typography.sectionTitle,
    letterSpacing: 1.2,
  },
  title: {
    ...typography.screenTitle,
    color: colors.text,
    marginTop: 4,
  },
  meta: {
    ...typography.bodySmall,
    color: colors.textDim,
    marginTop: 4,
  },
  pending: {
    ...typography.dimSmall,
    color: colors.warning,
    marginTop: spacing.sm,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.xxl * 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    padding: spacing.md,
    gap: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: {
    ...typography.body,
    fontFamily: fonts.bodyBold,
    fontWeight: '700',
  },
  rowSub: {
    ...typography.dimSmall,
    marginTop: 2,
  },
  hint: {
    ...typography.dim,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
