import { create } from 'zustand';
import { fetchMyTasks, completeMyTask, updateMyTask } from '../services/gfTasks';
import type { TaskItem } from '../types/tasks';

interface TasksStore {
  tasks: TaskItem[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;

  /** Pending count — drives the red badge in the tab bar. */
  pendingCount: number;

  loadTasks: (employeeId: number) => Promise<void>;
  completeTask: (taskId: number, notes?: string) => Promise<void>;
  startTask: (taskId: number) => Promise<void>;
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,
  lastFetchedAt: null,
  pendingCount: 0,

  loadTasks: async (employeeId) => {
    set({ loading: true, error: null });
    try {
      const tasks = await fetchMyTasks(employeeId);
      const pendingCount = tasks.filter((t) => t.state === 'pending' || t.state === 'in_progress').length;
      set({ tasks, pendingCount, loading: false, lastFetchedAt: Date.now() });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : 'Error al cargar tareas' });
    }
  },

  completeTask: async (taskId, notes = '') => {
    try {
      const updated = await completeMyTask(taskId, notes);
      const tasks = get().tasks.map((t) => t.id === taskId ? updated : t);
      const pendingCount = tasks.filter((t) => t.state === 'pending' || t.state === 'in_progress').length;
      set({ tasks, pendingCount });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Error al completar tarea' });
    }
  },

  startTask: async (taskId) => {
    try {
      const updated = await updateMyTask(taskId, { state: 'in_progress' });
      const tasks = get().tasks.map((t) => t.id === taskId ? updated : t);
      const pendingCount = tasks.filter((t) => t.state === 'pending' || t.state === 'in_progress').length;
      set({ tasks, pendingCount });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Error al actualizar tarea' });
    }
  },
}));
