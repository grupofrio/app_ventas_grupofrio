export type TaskState = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskItem {
  id: number;
  title: string;
  description?: string | null;
  state: TaskState;
  priority: TaskPriority;
  due_date?: string | null;
  created_at?: string | null;
}
