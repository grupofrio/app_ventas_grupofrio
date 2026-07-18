import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/**
 * Wiring del PR dirección + navegación externa:
 *  #1 RouteStopPanel conecta la prop onNavigate (antes muerta) a un botón real;
 *  #2 stop/[stopId] muestra dirección (formatCustomerAddress) + botón Abrir en Maps;
 *  #3 checkin muestra dirección antes del check-in;
 *  #4 StopCard muestra dirección;
 *  #5 la cadena off-route conserva street/city hasta la parada virtual;
 *  #6 los mapas aclaran que la línea es orden de visita, no ruta por calles;
 *  #7 map.tsx usa el helper compartido (no duplica URIs nativas).
 */
const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const panel = read('src/components/domain/RouteStopPanel.tsx');
const stop = read('app/stop/[stopId].tsx');
const checkin = read('app/checkin/[stopId].tsx');
const stopCard = read('src/components/domain/StopCard.tsx');
const searchLogic = read('src/services/offrouteSearchLogic.ts');
const factory = read('src/services/virtualStopFactory.ts');
const store = read('src/stores/useRouteStore.ts');
const offroute = read('app/offroute.tsx');
const routeMap = read('src/components/domain/RouteMap.tsx');
const map = read('app/map.tsx');
const nav = read('src/services/locationNavigation.ts');

// #1 onNavigate ya NO es prop muerta: se invoca en el panel.
assert(/onNavigate\(focus\)/.test(panel), 'RouteStopPanel debe llamar onNavigate(focus)');
assert(panel.includes('formatCustomerAddress'), 'el panel muestra la dirección del focus');

// #2 stop/[stopId]: dirección + botón Maps con el helper.
assert(stop.includes('formatCustomerAddress'), 'stop debe formatear la dirección');
assert(stop.includes('buildStopNavigationUrls'), 'stop debe construir URLs de navegación');
assert(/Abrir en Maps/.test(stop), 'stop debe exponer botón Abrir en Maps');

// #3 checkin: dirección visible en pre-check-in.
assert(checkin.includes('formatCustomerAddress'), 'checkin debe mostrar la dirección');

// #4 StopCard: dirección.
assert(stopCard.includes('formatCustomerAddress'), 'StopCard debe mostrar la dirección');

// #5 off-route conserva street/city end-to-end.
assert(/street: customer\.street/.test(searchLogic), 'search result conserva street del customer');
assert(/street: lead\.street/.test(searchLogic), 'search result conserva street del lead');
assert(/street\?: string \| null/.test(factory) || factory.includes('street?: string'),
  'el factory acepta street');
assert(/street: input\.street/.test(factory), 'el factory setea street en la parada virtual');
assert(/street: opts\?\.street/.test(store), 'addVirtualStop pasa street al factory');
assert(/street: result\.street/.test(offroute), 'offroute pasa street del resultado');

// #6 leyenda "orden de visita, no ruta por calles" en ambos mapas.
assert(/no es ruta por calles/.test(routeMap), 'RouteMap debe aclarar que la línea no es ruta');
assert(/no es ruta por calles/.test(map), 'map.tsx debe aclarar que la línea no es ruta');
assert(/showOrderLegend/.test(routeMap), 'RouteMap solo muestra la leyenda con línea recta visible');

// #7 map.tsx unificado con el helper (sin URIs nativas duplicadas).
assert(map.includes('buildStopNavigationUrls'), 'map.tsx usa el helper compartido');
assert(!/google\.navigation:/.test(map), 'map.tsx no debe duplicar URIs nativas');
assert(!/maps:\/\/app\?daddr=/.test(map), 'map.tsx no debe duplicar URIs nativas de iOS');

// #8 el helper tiene fallback por dirección (no solo geo).
assert(nav.includes('formatCustomerAddress'), 'el helper usa la dirección para el fallback');
assert(/formatted\.hasAddress/.test(nav), 'el helper navega por dirección cuando no hay geo');

console.log('address + external nav wiring tests: ok');
