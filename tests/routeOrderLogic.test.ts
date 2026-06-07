/**
 * P1: advertencia de orden de visita (no bloquea). evaluateVisitOrder.
 */
import assert from 'node:assert/strict';
import type { GFStop } from '../src/types/plan';

interface Mod {
  evaluateVisitOrder: (stops: GFStop[], selectedStopId: number) => {
    outOfOrder: boolean; nextStop: GFStop | null; selected: GFStop | null;
  };
}

function stop(id: number, seq: number, state: string): GFStop {
  return { id, route_sequence: seq, state, customer_name: `C${id}` } as unknown as GFStop;
}

function run(m: Mod) {
  const stops = [
    stop(1, 1, 'pending'),
    stop(2, 2, 'pending'),
    stop(3, 3, 'pending'),
  ];

  // Abrir el siguiente recomendado (seq 1) → NO es desviación.
  assert.equal(m.evaluateVisitOrder(stops, 1).outOfOrder, false);

  // Abrir el #3 cuando el siguiente es #1 → desviación.
  const dev = m.evaluateVisitOrder(stops, 3);
  assert.equal(dev.outOfOrder, true);
  assert.equal(dev.nextStop?.id, 1);

  // in_progress tiene prioridad como "siguiente".
  const withProgress = [stop(1, 1, 'pending'), stop(2, 2, 'in_progress'), stop(3, 3, 'pending')];
  assert.equal(m.evaluateVisitOrder(withProgress, 2).outOfOrder, false); // 2 es el siguiente
  assert.equal(m.evaluateVisitOrder(withProgress, 3).outOfOrder, true);

  // Clientes completados NO se marcan como desviación.
  const withDone = [stop(1, 1, 'done'), stop(2, 2, 'pending')];
  assert.equal(m.evaluateVisitOrder(withDone, 1).outOfOrder, false);

  // Sin secuencia → no desviación.
  const noSeq = [stop(1, 1, 'pending'), stop(2, 0, 'pending')];
  assert.equal(m.evaluateVisitOrder(noSeq, 2).outOfOrder, false);

  // Stop inexistente → no desviación.
  assert.equal(m.evaluateVisitOrder(stops, 999).outOfOrder, false);

  console.log('route order logic tests: ok');
}

async function main() {
  const m = await import(
    // @ts-ignore
    new URL('../src/services/routeOrderLogic.ts', import.meta.url).pathname
  ) as Mod;
  run(m);
}
void main();
