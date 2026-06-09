export type TaskState = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface TaskItem {
  id: number;
  title: string;
  description?: string | null;
  state: TaskState;
  priority: TaskPriority;
  assignee_id?: number | null;
  assignee_name?: string | null;
  due_date?: string | null;
  created_at?: string | null;
}
