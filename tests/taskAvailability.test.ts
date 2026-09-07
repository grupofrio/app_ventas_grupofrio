import assert from 'node:assert/strict';

import {
  areEmployeeTasksEnabled,
  TASKS_UNAVAILABLE_MESSAGE,
} from '../src/services/taskAvailability.ts';

function main() {
  assert.equal(
    areEmployeeTasksEnabled(),
    false,
    'las tareas no deben llamar a un addon que producción aún no tiene instalado',
  );
  assert.match(TASKS_UNAVAILABLE_MESSAGE, /no est[aá]n disponibles/i);
  console.log('task availability tests: ok');
}

main();
