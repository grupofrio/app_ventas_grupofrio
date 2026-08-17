import { getRest, postRest } from './api';
import type { TaskItem } from '../types/tasks';

const MAX_COMPLETION_NOTES_LENGTH = 1000;

function normalize(input: unknown): TaskItem {
  const t = (input ?? {}) as unknown as Record<string, unknown>;
  return {
    id: (t.task_id ?? t.id) as number,
    title: ((t.name ?? t.title ?? '') as string),
    description: (t.description ?? null) as string | null,
    state: (t.state ?? 'pending') as TaskItem['state'],
    priority: (t.priority ?? 'medium') as TaskItem['priority'],
    due_date: (t.due_date ?? null) as string | null,
    created_at: ((t.create_date ?? t.created_at ?? null) as string | null),
  };
}

/** Tareas derivadas de la identidad del empleado contenida en el Bearer token. */
export async function fetchMyTasks(): Promise<TaskItem[]> {
  const data = await getRest<{
    data?: { count?: number; tasks?: TaskItem[] };
    tasks?: TaskItem[];
  } | TaskItem[]>(
    '/gf/logistics/api/employee/tasks',
  );
  const raw = Array.isArray(data) ? data
    : Array.isArray(data?.data?.tasks) ? data.data.tasks
    : Array.isArray((data as { tasks?: TaskItem[] }).tasks) ? (data as { tasks: TaskItem[] }).tasks
    : [];
  return raw.map((t) => normalize(t));
}

/** Marca una tarea como completada. */
export async function completeMyTask(taskId: number, notes = ''): Promise<TaskItem> {
  const data = await postRest<Record<string, unknown>>('/gf/logistics/api/employee/tasks/complete', {
    task_id: taskId,
    completion_notes: notes.trim().slice(0, MAX_COMPLETION_NOTES_LENGTH),
  });
  return normalize(data?.data ?? data);
}

/** Inicia una tarea. */
export async function startMyTask(taskId: number): Promise<TaskItem> {
  const data = await postRest<Record<string, unknown>>('/gf/logistics/api/employee/tasks/start', {
    task_id: taskId,
  });
  return normalize(data?.data ?? data);
}
