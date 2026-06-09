/**
 * Tasks screen — tareas asignadas al vendedor por su supervisor.
 * Endpoint: GET /pwa-supv/tasks?assignee_id=X
 */

import React, { useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { TopBar } from '../../src/components/ui/TopBar';
import { colors, spacing, radii } from '../../src/theme/tokens';
import { fonts } from '../../src/theme/typography';
import { useTasksStore } from '../../src/stores/useTasksStore';
import { useAuthStore } from '../../src/stores/useAuthStore';
import { useAsyncRefresh } from '../../src/hooks/useAsyncRefresh';
import type { TaskItem, TaskPriority, TaskState } from '../../src/types/tasks';

// ── Priority & state metadata ─────────────────────────────────────────────────

const PRIORITY_META: Record<TaskPriority, { label: string; color: string; bg: string }> = {
  low:    { label: 'Baja',  color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
  medium: { label: 'Media', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  high:   { label: 'Alta',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
};

const STATE_META: Record<TaskState, { label: string; color: string }> = {
  pending:     { label: 'Pendiente',  color: '#f59e0b' },
  in_progress: { label: 'En curso',   color: '#2563EB' },
  done:        { label: 'Completada', color: '#22c55e' },
  cancelled:   { label: 'Cancelada',  color: '#6b7280' },
};

// ── TaskCard ──────────────────────────────────────────────────────────────────

const TaskCard = React.memo(function TaskCard({
  task,
  onComplete,
  onStart,
}: {
  task: TaskItem;
  onComplete: (id: number) => void;
  onStart: (id: number) => void;
}) {
  const priority = PRIORITY_META[task.priority] ?? PRIORITY_META.medium;
  const state    = STATE_META[task.state] ?? STATE_META.pending;
  const isDone   = task.state === 'done' || task.state === 'cancelled';

  return (
    <View style={[styles.card, isDone && styles.cardDone]}>
      {/* Header row */}
      <View style={styles.cardHeader}>
        <View style={[styles.priorityBadge, { backgroundColor: priority.bg }]}>
          <Text style={[styles.priorityText, { color: priority.color }]}>{priority.label}</Text>
        </View>
        <View style={[styles.stateDot, { backgroundColor: state.color }]} />
        <Text style={[styles.stateText, { color: state.color }]}>{state.label}</Text>
      </View>

      {/* Title */}
      <Text style={[styles.cardTitle, isDone && styles.cardTitleDone]} numberOfLines={2}>
        {task.title}
      </Text>

      {/* Description */}
      {!!task.description && (
        <Text style={styles.cardDesc} numberOfLines={3}>{task.description}</Text>
      )}

      {/* Due date */}
      {!!task.due_date && (
        <Text style={styles.cardMeta}>📅 {task.due_date}</Text>
      )}

      {/* Actions */}
      {!isDone && (
        <View style={styles.cardActions}>
          {task.state === 'pending' && (
            <TouchableOpacity
              style={styles.btnStart}
              onPress={() => onStart(task.id)}
              activeOpacity={0.8}
            >
              <Text style={styles.btnStartText}>▶ Iniciar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.btnComplete}
            onPress={() => onComplete(task.id)}
            activeOpacity={0.8}
          >
            <Text style={styles.btnCompleteText}>✓ Completar</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

// ── Screen ────────────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const employeeId = useAuthStore((s) => s.employeeId);
  const { tasks, loading, error, pendingCount, loadTasks, completeTask, startTask } = useTasksStore();

  const doLoad = useCallback(async () => {
    if (employeeId) await loadTasks(employeeId);
  }, [employeeId, loadTasks]);

  useFocusEffect(useCallback(() => { void doLoad(); }, [doLoad]));

  const { refreshing, onRefresh } = useAsyncRefresh(doLoad);

  const handleComplete = useCallback((taskId: number) => {
    Alert.alert(
      'Completar tarea',
      '¿Confirmas que terminaste esta tarea?',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Completar', onPress: () => { void completeTask(taskId); } },
      ],
    );
  }, [completeTask]);

  const handleStart = useCallback((taskId: number) => {
    void startTask(taskId);
  }, [startTask]);

  const pending    = tasks.filter((t) => t.state === 'pending');
  const inProgress = tasks.filter((t) => t.state === 'in_progress');
  const done       = tasks.filter((t) => t.state === 'done' || t.state === 'cancelled');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar title="Mis Tareas" />

      {/* Summary chips */}
      <View style={styles.summaryRow}>
        <View style={[styles.chip, styles.chipPending]}>
          <Text style={[styles.chipNum, { color: '#f59e0b' }]}>{pending.length}</Text>
          <Text style={styles.chipLabel}>Pendientes</Text>
        </View>
        <View style={[styles.chip, styles.chipProgress]}>
          <Text style={[styles.chipNum, { color: colors.primary }]}>{inProgress.length}</Text>
          <Text style={styles.chipLabel}>En curso</Text>
        </View>
        <View style={[styles.chip, styles.chipDone]}>
          <Text style={[styles.chipNum, { color: colors.success }]}>{done.length}</Text>
          <Text style={styles.chipLabel}>Completadas</Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>⚠️ {error}</Text>
            <TouchableOpacity onPress={() => void doLoad()} style={styles.retryBtn}>
              <Text style={styles.retryText}>Reintentar</Text>
            </TouchableOpacity>
          </View>
        ) : tasks.length === 0 && !loading ? (
          <View style={styles.emptyBox}>
            <Text style={{ fontSize: 36 }}>✅</Text>
            <Text style={styles.emptyTitle}>Sin tareas pendientes</Text>
            <Text style={styles.emptyBody}>Tu supervisor no te ha asignado tareas por ahora.</Text>
          </View>
        ) : (
          <>
            {inProgress.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>EN CURSO</Text>
                {inProgress.map((t) => (
                  <TaskCard key={t.id} task={t} onComplete={handleComplete} onStart={handleStart} />
                ))}
              </>
            )}
            {pending.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>PENDIENTES</Text>
                {pending.map((t) => (
                  <TaskCard key={t.id} task={t} onComplete={handleComplete} onStart={handleStart} />
                ))}
              </>
            )}
            {done.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>COMPLETADAS / CANCELADAS</Text>
                {done.map((t) => (
                  <TaskCard key={t.id} task={t} onComplete={handleComplete} onStart={handleStart} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.screenPadding, paddingBottom: 100 },

  summaryRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.screenPadding,
    paddingVertical: 12,
    gap: 8,
  },
  chip: {
    flex: 1, borderRadius: radii.card, padding: 12,
    alignItems: 'center', borderWidth: 1,
  },
  chipPending:  { backgroundColor: 'rgba(245,158,11,0.07)',  borderColor: 'rgba(245,158,11,0.2)' },
  chipProgress: { backgroundColor: 'rgba(37,99,235,0.07)',   borderColor: 'rgba(37,99,235,0.2)' },
  chipDone:     { backgroundColor: 'rgba(34,197,94,0.07)',   borderColor: 'rgba(34,197,94,0.2)' },
  chipNum: { fontFamily: fonts.monoBold, fontSize: 22, fontWeight: '800' },
  chipLabel: { fontSize: 10, color: colors.textDim, marginTop: 2, fontWeight: '600' },

  sectionTitle: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, color: colors.textDim, marginTop: 16, marginBottom: 8,
  },

  card: {
    backgroundColor: colors.card, borderRadius: radii.card,
    padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border ?? 'rgba(255,255,255,0.06)',
  },
  cardDone: { opacity: 0.55 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  priorityText: { fontSize: 11, fontWeight: '700' },
  stateDot: { width: 7, height: 7, borderRadius: 4 },
  stateText: { fontSize: 11, fontWeight: '700' },

  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 4 },
  cardTitleDone: { textDecorationLine: 'line-through', color: colors.textDim },
  cardDesc: { fontSize: 13, color: colors.textDim, lineHeight: 18, marginBottom: 6 },
  cardMeta: { fontSize: 11, color: colors.textDim, marginBottom: 8 },

  cardActions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  btnStart: {
    flex: 1, paddingVertical: 11, borderRadius: radii.button,
    backgroundColor: colors.primaryAlpha12, borderWidth: 1, borderColor: colors.primary,
    alignItems: 'center',
  },
  btnStartText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  btnComplete: {
    flex: 2, paddingVertical: 11, borderRadius: radii.button,
    backgroundColor: colors.success,
    alignItems: 'center',
  },
  btnCompleteText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  errorBox: {
    backgroundColor: colors.errorAlpha08, borderRadius: radii.card,
    padding: 16, alignItems: 'center', marginTop: 20, gap: 10,
  },
  errorText: { color: colors.error, fontSize: 13, textAlign: 'center' },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 9, backgroundColor: colors.cardLighter, borderRadius: radii.button },
  retryText: { color: colors.text, fontSize: 13, fontWeight: '700' },

  emptyBox: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  emptyBody: { fontSize: 13, color: colors.textDim, textAlign: 'center', paddingHorizontal: 20 },
});
