import { getRest, postRest } from './api';
import type { TaskItem } from '../types/tasks';

function normalize(t: Record<string, unknown>): TaskItem {
  return {
    ...t,
    id: (t.task_id ?? t.id) as number,
    title: ((t.name ?? t.title ?? '') as string),
    created_at: ((t.create_date ?? t.created_at ?? null) as string | null),
  } as TaskItem;
}

/** Tareas asignadas a un empleado. Requiere companyId (obligatorio en el backend). */
export async function fetchMyTasks(employeeId: number, companyId: number): Promise<TaskItem[]> {
  const data = await getRest<{ tasks?: TaskItem[] } | TaskItem[]>(
    `/pwa-supv/tasks?assignee_id=${employeeId}&company_id=${companyId}`,
  );
  const raw = Array.isArray(data) ? data
    : Array.isArray((data as { tasks?: TaskItem[] }).tasks) ? (data as { tasks: TaskItem[] }).tasks
    : [];
  return raw.map((t) => normalize(t as Record<string, unknown>));
}

/** Marca una tarea como completada. */
export async function completeMyTask(taskId: number, notes = ''): Promise<TaskItem> {
  const data = await postRest<Record<string, unknown>>('/pwa-supv/tasks/complete', {
    task_id: taskId,
    completion_notes: notes.trim(),
  });
  return normalize(data?.data ?? data);
}

/** Actualiza estado de una tarea (ej. in_progress). */
export async function updateMyTask(taskId: number, patch: Partial<Pick<TaskItem, 'state'>>): Promise<TaskItem> {
  const data = await postRest<Record<string, unknown>>('/pwa-supv/tasks/update', {
    task_id: taskId,
    patch,
  });
  return normalize(data?.data ?? data);
}
