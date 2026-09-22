import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as productLoading from '../src/utils/productLoading.ts';
import * as preparationLogic from '../src/services/routePreparationLogic.ts';
import * as trustSignals from '../src/services/trustSignals.ts';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const transpile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React,
} }).outputText;

for (const file of ['app/sale/[stopId].tsx', 'app/gift/[stopId].tsx', 'app/exchange/[stopId].tsx', 'app/(tabs)/inventory.tsx']) {
  test(`${file}: one automatic attempt per focus, none offline, reconnect can retry`, async () => {
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let focus;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'useFocusEffect') focus = node.getText(source);
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(focus);
    let calls = 0, previousDeps, previousCallback, activeCallback;
    const listeners = new Set();
    const state = { isLoading: false, productCount: 0, lastSync: null, error: null };
    const loadProducts = async () => { calls++; state.isLoading = true; };
    const loadPlan = async () => {};
    const route = { plan: { plan_id: 7005 }, loadPlan };
    const context = {
      warehouseId: 103, planId: 7005, isOnline: true, loadProducts, loadPlan,
      ...productLoading,
      useProductStore: { getState: () => ({ ...state, loadProducts }), subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); } },
      useRouteStore: { getState: () => route },
      useSyncStore: { getState: () => ({ isOnline: context.isOnline }) },
      useCallback(fn, deps) {
        if (!previousDeps || deps.some((x, i) => x !== previousDeps[i])) { previousCallback = fn; previousDeps = deps; }
        return previousCallback;
      },
      useFocusEffect(fn) { if (fn !== activeCallback) { activeCallback?.cleanup?.(); activeCallback = fn; fn.cleanup = fn(); } },
    };
    const render = async () => {
      for (const notify of [...listeners]) notify();
      Object.assign(context, { isLoading: state.isLoading, isLoadingProducts: state.isLoading,
        productCount: state.productCount, productsLastSync: state.lastSync, productError: state.error, error: state.error });
      vm.runInNewContext(transpile(focus), context);
      await new Promise(resolve => setImmediate(resolve));
    };
    context.isOnline = false; await render(); assert.equal(calls, 0);
    context.isOnline = true; await render(); assert.equal(calls, 1);
    await render(); // loading render
    state.isLoading = false; state.error = 'Network request failed';
    await render(); await render();
    assert.equal(calls, 1, 'failed request must not retrigger itself');
    context.isOnline = false; await render();
    assert.equal(calls, 1, 'offline must use cached products');
    context.isOnline = true; await render();
    assert.equal(calls, 2, 'reconnection gets one new attempt');
    route.plan = { plan_id: 7006 }; context.planId = 7006;
    await render(); assert.equal(calls, 2, 'wait for the previous context request');
    state.isLoading = false; state.error = 'Changed context';
    await render(); assert.equal(calls, 3, 'load new plan once after previous request settles');
    state.isLoading = false; await render(); assert.equal(calls, 3);
    activeCallback?.cleanup?.(); activeCallback = null;
    await render(); assert.equal(calls, 4, 'real refocus may retry once');
  });
}

test('a successful empty inventory does not immediately trigger another refresh', () => {
  assert.equal(productLoading.shouldRefreshProductsOnFocus(103, false, 0, Date.now()), false);
});

function renderPreparationCard(access, productCount = 2, bundleError = null, stops = [{ id: 1 }], locked = false) {
  const prep = { isPreparing: false, preparedAt: Date.now(), preparedPlanId: 7005,
    customersTotal: 9, customersPrepared: 9, pricesPrepared: 18, failures: [], bundleExpired: false };
  let renewed = 0;
  prep.prepareRouteData = () => { renewed++; };
  const route = { plan: { plan_id: 7005 }, stops };
  const element = (type, props, ...children) => ({ type, props: { ...props, children } });
  const exports = {};
  const dependencies = {
    react: { default: { createElement: element } },
    'react-native': { View: 'View', Text: 'Text', TouchableOpacity: 'Button', ActivityIndicator: 'Spinner', StyleSheet: { create: x => x } },
    '../../theme/tokens': { colors: {}, spacing: {}, radii: {} },
    '../../theme/typography': { fonts: {} },
    '../../stores/useRoutePreparationStore': { useRoutePreparationStore: select => select(prep) },
    '../../stores/useRouteStore': { useRouteStore: select => select(route) },
    '../../stores/useSyncStore': { useSyncStore: select => select({ isOnline: true }) },
    '../../stores/useEmployeeDayBundleStore': { useEmployeeDayBundleStore: select => select({ access, error: bundleError }) },
    '../../stores/useProductStore': { useProductStore: select => select({ productCount }) },
    '../../services/routePreparationLogic': preparationLogic,
    '../../services/trustSignals': trustSignals,
  };
  vm.runInNewContext(transpile(read('src/components/domain/RoutePreparationCard.tsx')), {
    exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  const tree = exports.RoutePreparationCard({ locked });
  const nodes = [];
  function walk(node) { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') { nodes.push(node); walk(node.props?.children); } }
  walk(tree);
  return { text: JSON.stringify(tree), nodes, renewed: () => renewed };
}

for (const [label, access, count] of [['missing bundle', null, 2], ['expired bundle', {canStartRoute:false}, 2], ['missing catalog', {canStartRoute:true}, 0]]) {
  test(`restored receipt with ${label} offers recovery instead of claiming ready`, () => {
    const card = renderPreparationCard(access, count);
    assert.ok(!card.text.includes('Ruta lista para salir'));
    const button = card.nodes.find(n => n.props?.accessibilityLabel === 'Renovar datos del día');
    assert.ok(button, 'must offer data recovery without repeating checklist or accepting load');
    button.props.onPress(); assert.equal(card.renewed(), 1);
  });
}

test('valid restored data remains ready', () => {
  assert.ok(renderPreparationCard({canStartRoute:true}).text.includes('Ruta lista para salir'));
});


test('missing stops offers recovery, while a checklist/load lock remains respected', () => {
  const card = renderPreparationCard({canStartRoute:true}, 2, null, []);
  assert.ok(!card.text.includes('Ruta lista para salir'));
  assert.ok(card.nodes.some(n => n.props?.accessibilityLabel === 'Renovar datos del día'));
  const locked = renderPreparationCard(null, 2, null, [], true);
  assert.ok(!locked.nodes.some(n => n.props?.accessibilityLabel === 'Renovar datos del día'));
});

test('waiting refresh is cancelled on blur or loss of connectivity', () => {
  for (const cancelByBlur of [true, false]) {
    let current = true, calls = 0;
    const state = { isLoading: true, productCount: 0, lastSync: null, loadProducts: async () => { calls++; } };
    const listeners = new Set();
    const cancel = productLoading.startFocusedProductRefresh({
      getState: () => state,
      subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
      isCurrent: () => current,
    });
    if (cancelByBlur) cancel(); else current = false;
    state.isLoading = false;
    for (const notify of [...listeners]) notify();
    assert.equal(calls, 0); assert.equal(listeners.size, 0);
  }
});
