/**
 * Profile screen — employee info, settings, logout.
 */

import React, { useCallback, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, Share, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { TopBar } from '../src/components/ui/TopBar';
import { Button } from '../src/components/ui/Button';
import { Card } from '../src/components/ui/Card';
import { Badge } from '../src/components/ui/Badge';
import { colors, spacing, radii } from '../src/theme/tokens';
import { typography, fonts } from '../src/theme/typography';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useSyncStore } from '../src/stores/useSyncStore';
import { getDiagnosticsExport, getLocalHealthSnapshot } from '../src/utils/healthCheck';

export default function ProfileScreen() {
  const router = useRouter();
  const {
    employeeName, companyName, warehouseId,
    isSupervisor, allowCreateCustomer, logout,
  } = useAuthStore();
  const pendingCount = useSyncStore((s) => s.pendingCount);

  // V2: Hidden diagnostics — tap version 5 times
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const handleVersionTap = useCallback(() => {
    tapCountRef.current += 1;

    // Reset after 3 seconds of inactivity
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => { tapCountRef.current = 0; }, 3000);

    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      setShowDiagnostics(true);
    }
  }, []);

  const handleExportDiagnostics = useCallback(async () => {
    try {
      const diagnostics = getDiagnosticsExport();
      const text = JSON.stringify(diagnostics, null, 2);
      await Share.share({
        message: text,
        title: 'KOLD Field Diagnostics',
      });
    } catch {
      Alert.alert('Error', 'No se pudo exportar diagnosticos');
    }
  }, []);

  async function handleLogout() {
    if (pendingCount > 0) {
      Alert.alert(
        'Operaciones pendientes',
        `Tienes ${pendingCount} operacion(es) sin sincronizar. Si sales, se perderan.`,
        [
          { text: 'Cancelar' },
          { text: 'Salir de todos modos', style: 'destructive', onPress: doLogout },
        ]
      );
    } else {
      doLogout();
    }
  }

  async function doLogout() {
    await logout();
    router.replace('/(auth)/login' as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Perfil" showBack />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        {/* Employee info */}
        <Card>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={{ fontSize: 24 }}>👤</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={typography.screenTitle}>{employeeName || 'Vendedor'}</Text>
              <Text style={typography.dim}>{companyName || 'Grupo Frio'}</Text>
            </View>
          </View>
          <View style={styles.badges}>
            {isSupervisor && <Badge label="SUPERVISOR" variant="orange" />}
            {allowCreateCustomer && <Badge label="CREA CLIENTES" variant="blue" />}
          </View>
        </Card>

        {/* Quick actions */}
        <Text style={styles.sectionTitle}>ACCIONES</Text>
        <Button
          label="💰 Corte de Caja"
          variant="secondary"
          fullWidth
          onPress={() => router.push('/cashclose' as never)}
          style={{ marginBottom: 8 }}
        />
        {allowCreateCustomer && (
          <Button
            label="➕ Nuevo Cliente"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/newcustomer' as never)}
            style={{ marginBottom: 8 }}
          />
        )}
        <Button
          label="🔄 Cola de Sincronizacion"
          variant="secondary"
          fullWidth
          onPress={() => router.push('/sync' as never)}
          style={{ marginBottom: 8 }}
        />

        {/* App info */}
        <Text style={styles.sectionTitle}>APP</Text>
        <Card>
          <TouchableOpacity onPress={handleVersionTap} activeOpacity={1}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Version</Text>
              <Text style={styles.infoValue}>2.0.0-pilot</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Almacen</Text>
            <Text style={styles.infoValue}>#{warehouseId || '--'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Pendientes sync</Text>
            <Text style={[styles.infoValue, pendingCount > 0 ? { color: colors.warning } : {}]}>
              {pendingCount}
            </Text>
          </View>
        </Card>

        {/* V2: Hidden diagnostics panel — visible after 5 taps on version */}
        {showDiagnostics && (
          <>
            <Text style={styles.sectionTitle}>DIAGNOSTICOS</Text>
            <Card>
              <DiagnosticsSummary />
              <Button
                label="Exportar Diagnosticos"
                variant="secondary"
                fullWidth
                onPress={handleExportDiagnostics}
                style={{ marginTop: 8 }}
              />
              <Button
                label="Cerrar"
                variant="secondary"
                fullWidth
                onPress={() => setShowDiagnostics(false)}
                style={{ marginTop: 4 }}
              />
            </Card>
          </>
        )}

        {/* Logout */}
        <Button
          label="Cerrar Sesion"
          variant="danger"
          fullWidth
          onPress={handleLogout}
          style={{ marginTop: 20 }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Lightweight diagnostics summary — no heavy renders. */
function DiagnosticsSummary() {
  const snapshot = getLocalHealthSnapshot();
  const statusColor = snapshot.status === 'healthy'
    ? colors.success
    : snapshot.status === 'degraded'
      ? colors.warning
      : colors.error;

  return (
    <View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Estado</Text>
        <Text style={[styles.infoValue, { color: statusColor }]}>
          {snapshot.status.toUpperCase()}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Pendientes</Text>
        <Text style={styles.infoValue}>{snapshot.pendingCount}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Fallidos</Text>
        <Text style={[styles.infoValue, snapshot.deadCount > 0 ? { color: colors.error } : {}]}>
          {snapshot.deadCount}
        </Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>GPS cola</Text>
        <Text style={styles.infoValue}>{snapshot.gpsQueueSize}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>GPS modo</Text>
        <Text style={styles.infoValue}>{snapshot.gpsMode}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Inventario</Text>
        <Text style={styles.infoValue}>{snapshot.inventorySource}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 8 },
  avatar: {
    width: 50, height: 50, borderRadius: 25,
    backgroundColor: colors.cardLighter, alignItems: 'center', justifyContent: 'center',
  },
  badges: { flexDirection: 'row', gap: 6 },
  sectionTitle: {
    fontSize: 12, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.7, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  infoLabel: { fontSize: 12, color: colors.textDim },
  infoValue: { fontFamily: fonts.monoBold, fontSize: 12, fontWeight: '700', color: colors.text },
});
