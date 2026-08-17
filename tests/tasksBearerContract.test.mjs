import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path) => readFileSync(resolve(path), 'utf8');

const service = read('src/services/gfTasks.ts');
const store = read('src/stores/useTasksStore.ts');
const tasksScreen = read('app/(tabs)/tasks.tsx');
const miDia = read('app/(tabs)/index.tsx');

function section(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.notEqual(to, -1, `missing end marker ${end}`);
  return source.slice(from, to);
}

function testEmployeeTaskServiceHasNoClientSelectedAuthority() {
  const list = section(service, 'export async function fetchMyTasks', '/** Marca una tarea');

  assert.match(list, /fetchMyTasks\(\): Promise<TaskItem\[\]>/,
    'task list must derive its employee scope solely from the Bearer token');
  assert.match(list, /getRest[\s\S]*?['"]\/gf\/logistics\/api\/employee\/tasks['"]/,
    'task list must use the employee-scoped REST endpoint');
  assert.doesNotMatch(list, /\/tasks\?|assignee_id|company_id|employeeId|companyId|branchId/,
    'task list must not send or accept client-selected authority');

  for (const forbidden of [
    /\/pwa-supv\/tasks/,
    /odooRpc|postRpc|jsonrpc|call_kw|execute_kw/,
    /api[_-]?key|supervisor/,
  ]) {
    assert.doesNotMatch(service, forbidden,
      `mobile tasks service must not retain privileged transport: ${forbidden}`);
  }
}

function testTaskMutationsUseDedicatedEmployeeEndpointsAndAllowlistedBodies() {
  const complete = section(service, 'export async function completeMyTask', '/** Inicia una tarea');
  const start = section(service, 'export async function startMyTask', undefined);

  assert.match(complete,
    /postRest<Record<string, unknown>>\(\s*['"]\/gf\/logistics\/api\/employee\/tasks\/complete['"],\s*\{\s*task_id:\s*taskId,\s*completion_notes:\s*notes\.trim\(\)\.slice\(0, MAX_COMPLETION_NOTES_LENGTH\),?\s*\}\s*\)/,
    'complete body must contain only the bounded task id and completion notes');
  assert.doesNotMatch(complete, /employeeId|companyId|assignee_id|company_id|patch|state/,
    'complete must not send privileged scope or arbitrary mutation fields');

  assert.match(start,
    /postRest<Record<string, unknown>>\(\s*['"]\/gf\/logistics\/api\/employee\/tasks\/start['"],\s*\{\s*task_id:\s*taskId,?\s*\}\s*\)/,
    'start body must contain only task_id');
  assert.doesNotMatch(start, /employeeId|companyId|assignee_id|company_id|patch|state/,
    'start must not send privileged scope or arbitrary mutation fields');
  assert.match(service, /const MAX_COMPLETION_NOTES_LENGTH = \d+;/,
    'completion notes must have a client-side bound');
}

function testStoreAndMiDiaOnlyUseTheScopedTaskAdapter() {
  assert.match(store, /loadTasks:\s*\(\)\s*=>[\s\S]*?fetchMyTasks\(\)/,
    'task store must load through the Bearer-scoped list adapter without authority arguments');
  assert.match(store, /startTask:[\s\S]*?startMyTask\(taskId\)/,
    'task store must call the dedicated start adapter');
  assert.doesNotMatch(store, /updateMyTask|employeeId|companyId|assignee_id|company_id/,
    'task store must not compose employee/company authority or legacy updates');

  assert.match(tasksScreen, /from ['"]\.\.\/\.\.\/src\/stores\/useTasksStore['"]/,
    'Tasks screen must use the task store');
  assert.match(tasksScreen, /await loadTasks\(\);/,
    'Tasks screen must refresh through the scoped store call');
  assert.doesNotMatch(tasksScreen, /useAuthStore|employeeId|companyId|assignee_id|company_id|gfTasks/,
    'Tasks screen must not read identity merely to construct task requests');

  assert.match(miDia, /from ['"]\.\.\/\.\.\/src\/stores\/useTasksStore['"]/,
    'Mi Día must obtain task state from the store');
  assert.match(miDia, /loadTasks\(\)/,
    'Mi Día must refresh task state without passing identity selectors');
  assert.doesNotMatch(miDia, /loadTasks\(\s*(?:employeeId|companyId)/,
    'Mi Día must not pass identity selectors to task requests');
  assert.doesNotMatch(miDia, /from ['"][^'"]*gfTasks['"]|\/pwa-supv\/tasks|odooRpc|postRpc|jsonrpc/,
    'Mi Día must not make a direct privileged task request');
}

testEmployeeTaskServiceHasNoClientSelectedAuthority();
testTaskMutationsUseDedicatedEmployeeEndpointsAndAllowlistedBodies();
testStoreAndMiDiaOnlyUseTheScopedTaskAdapter();
console.log('tasks Bearer contract tests: ok');
