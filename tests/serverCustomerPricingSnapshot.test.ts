import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

import {
  validateServerPriceSnapshot,
  type ValidatedServerPriceSnapshot,
} from '../src/services/customerPricingSnapshot.ts';

type PricingProduct = {
  id: number;
  list_price: number;
};

type PricingRequest = (
  url: string,
  payload: Record<string, unknown>,
  options: { timeoutMs?: number },
) => Promise<unknown>;

type PricingOptions = {
  companyId?: number | null;
  fallbackPricelistId?: number | null;
  requestServerPricing?: PricingRequest;
};

type ParseServerCustomerPricingSnapshot = (
  response: unknown,
  requestedProductIds: number[],
) => ValidatedServerPriceSnapshot;

type FetchServerCustomerPricingSnapshot = (
  partnerId: number,
  products: PricingProduct[],
  options?: PricingOptions,
) => Promise<ValidatedServerPriceSnapshot>;

type DeriveCustomerPriceOverrides = (
  snapshot: ValidatedServerPriceSnapshot,
  products: PricingProduct[],
) => Map<number, number>;

const REPO_ROOT = (
  globalThis as unknown as { process: { cwd: () => string } }
).process.cwd();
const PRICELIST_SOURCE = readFileSync(
  resolve(REPO_ROOT, 'src/services/pricelist.ts'),
  'utf8',
);

function extractFunctionSource(source: string, name: string): string {
  const candidates = [
    `export async function ${name}`,
    `export function ${name}`,
    `async function ${name}`,
    `function ${name}`,
  ];
  const start = candidates
    .map((candidate) => source.indexOf(candidate))
    .find((index) => index >= 0) ?? -1;
  assert.notEqual(start, -1, `${name} must exist`);

  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `${name} must have a body`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  throw new Error(`Could not extract ${name}`);
}

function compileFunctions(
  names: string[],
  dependencies: Record<string, unknown>,
  exposePrivate: string[] = [],
): Record<string, unknown> {
  const source = [
    ...names.map((name) => extractFunctionSource(PRICELIST_SOURCE, name)),
    ...exposePrivate.map((name) => `export { ${name} };`),
  ].join('\n');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const dependencyNames = Object.keys(dependencies);
  const evaluate = new Function(
    'module',
    'exports',
    ...dependencyNames,
    compiled,
  );
  evaluate(
    module,
    module.exports,
    ...dependencyNames.map((name) => dependencies[name]),
  );
  return module.exports;
}

const pricingRuntime = compileFunctions(
  [
    'parseServerCustomerPricingSnapshot',
    'fetchServerSidePrices',
    'fetchServerCustomerPricingSnapshot',
    'deriveCustomerPriceOverrides',
  ],
  {
    validateServerPriceSnapshot,
    shouldTryServerPricingEndpoint: () => true,
    postRest: async () => {
      throw new Error('Unexpected production request in focused test');
    },
    GF_BASE: 'gf/logistics/api/employee',
    DEFAULT_READ_TIMEOUT_MS: 10_000,
    markServerPricingEndpointAvailable: () => undefined,
    disableServerPricingEndpointIfMissing: () => false,
  },
  ['deriveCustomerPriceOverrides'],
);
const parseServerCustomerPricingSnapshot =
  pricingRuntime.parseServerCustomerPricingSnapshot as ParseServerCustomerPricingSnapshot;
const fetchServerCustomerPricingSnapshot =
  pricingRuntime.fetchServerCustomerPricingSnapshot as FetchServerCustomerPricingSnapshot;
const deriveCustomerPriceOverrides =
  pricingRuntime.deriveCustomerPriceOverrides as DeriveCustomerPriceOverrides;

test('parses a complete response and retains a server price equal to public price', () => {
  const result = parseServerCustomerPricingSnapshot({
    data: {
      partner_id: 99,
      pricelist_id: 81,
      prices: [
        { product_id: 10, price_unit: 100 },
        { product_id: 20, price_unit: 42 },
      ],
    },
  }, [10, 20]);

  assert.equal(result.resolvedPricelistId, 81);
  assert.deepEqual([...result.prices], [[10, 100], [20, 42]]);
});

test('requires a positive resolved data.pricelist_id', () => {
  for (const pricelistId of [undefined, null, 0, -1, 1.5]) {
    assert.throws(
      () => parseServerCustomerPricingSnapshot({
        data: {
          pricelist_id: pricelistId,
          prices: [{ product_id: 10, price_unit: 42 }],
        },
      }, [10]),
      /invalid_resolved_pricelist/,
    );
  }
});

test('surfaces invalid requested product IDs and missing requested coverage', () => {
  const response = {
    data: {
      pricelist_id: 81,
      prices: [{ product_id: 10, price_unit: 42 }],
    },
  };

  assert.throws(
    () => parseServerCustomerPricingSnapshot(response, [10, 0]),
    /invalid_requested_product.*0/,
  );
  assert.throws(
    () => parseServerCustomerPricingSnapshot(response, [10, 20]),
    /incomplete_product_coverage.*20/,
  );
});

test('discards extra rows before validating exact requested coverage', () => {
  const result = parseServerCustomerPricingSnapshot({
    data: {
      pricelist_id: 81,
      prices: [
        { product_id: 999, price_unit: Number.NEGATIVE_INFINITY },
        { product_id: 20, price_unit: 42 },
        { product_id: 10, price_unit: 100 },
      ],
    },
  }, [20, 10]);

  assert.deepEqual(result.prices, [[10, 100], [20, 42]]);
});

test('accepts equal duplicate rows and rejects conflicting requested rows', () => {
  const duplicate = parseServerCustomerPricingSnapshot({
    data: {
      pricelist_id: 81,
      prices: [
        { product_id: 10, price_unit: 42 },
        { product_id: 10, price_unit: 42 },
      ],
    },
  }, [10, 10]);
  assert.deepEqual(duplicate.prices, [[10, 42]]);

  assert.throws(
    () => parseServerCustomerPricingSnapshot({
      data: {
        pricelist_id: 81,
        prices: [
          { product_id: 10, price_unit: 42 },
          { product_id: 10, price_unit: 43 },
        ],
      },
    }, [10]),
    /conflicting_product_rows.*10/,
  );
});

test('fetches the strict full snapshot with existing endpoint transport conventions', async () => {
  const calls: Array<{
    url: string;
    payload: Record<string, unknown>;
    options: { timeoutMs?: number };
  }> = [];
  const requestServerPricing: PricingRequest = async (url, payload, options) => {
    calls.push({ url, payload, options });
    return {
      data: {
        partner_id: 99,
        pricelist_id: 81,
        prices: [
          { product_id: 10, price_unit: 100 },
          { product_id: 20, price_unit: 42 },
          { product_id: 999, price_unit: 1 },
        ],
      },
    };
  };

  const result = await fetchServerCustomerPricingSnapshot(
    99,
    [
      { id: 10, list_price: 100 },
      { id: 20, list_price: 50 },
    ],
    {
      companyId: 34,
      fallbackPricelistId: 104,
      requestServerPricing,
    },
  );

  assert.deepEqual(result.prices, [[10, 100], [20, 42]]);
  assert.deepEqual(calls, [{
    url: 'gf/logistics/api/employee/pricing/by_partner',
    payload: {
      partner_id: 99,
      product_ids: [10, 20],
      pricelist_id: 104,
    },
    options: { timeoutMs: 10_000 },
  }]);
});

test('surfaces API errors and invalid full responses without client-side fallback', async () => {
  const sentinel = new Error('Odoo pricing unavailable');
  let requestCount = 0;

  await assert.rejects(
    fetchServerCustomerPricingSnapshot(
      99,
      [{ id: 10, list_price: 100 }],
      {
        requestServerPricing: async () => {
          requestCount += 1;
          throw sentinel;
        },
      },
    ),
    (error) => error === sentinel,
  );

  await assert.rejects(
    fetchServerCustomerPricingSnapshot(
      99,
      [{ id: 10, list_price: 100 }],
      {
        requestServerPricing: async () => {
          requestCount += 1;
          return {
            data: {
              pricelist_id: 81,
              prices: [],
            },
          };
        },
      },
    ),
    /incomplete_product_coverage/,
  );

  assert.equal(requestCount, 2);
});

test('rejects invalid partner and product inputs before requesting prices', async () => {
  let requestCount = 0;
  const options: PricingOptions = {
    requestServerPricing: async () => {
      requestCount += 1;
      return {};
    },
  };

  await assert.rejects(
    fetchServerCustomerPricingSnapshot(0, [{ id: 10, list_price: 100 }], options),
    /invalid_partner/,
  );
  await assert.rejects(
    fetchServerCustomerPricingSnapshot(99, [{ id: Number.NaN, list_price: 100 }], options),
    /invalid_requested_product/,
  );
  await assert.rejects(
    fetchServerCustomerPricingSnapshot(99, [], options),
    /empty_product_set/,
  );
  assert.equal(requestCount, 0);
});

test('legacy override derivation omits only prices matching the public price', () => {
  const products = [
    { id: 10, list_price: 100 },
    { id: 20, list_price: 50 },
  ];
  const snapshot = parseServerCustomerPricingSnapshot({
    data: {
      pricelist_id: 81,
      prices: [
        { product_id: 10, price_unit: 100 },
        { product_id: 20, price_unit: 42 },
      ],
    },
  }, products.map((product) => product.id));

  assert.deepEqual(
    [...deriveCustomerPriceOverrides(snapshot, products)],
    [[20, 42]],
  );
});
