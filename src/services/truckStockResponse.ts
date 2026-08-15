import type { OdooMany2one } from '../types/odoo';
import type { Product } from '../types/product';

export class TruckStockPayloadError extends Error {
  constructor() {
    super('La respuesta de inventario autorizado no tiene un catálogo válido.');
    this.name = 'TruckStockPayloadError';
  }
}

export interface TruckStockResponse {
  products: Product[];
  hasStockData: boolean;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isMany2one(value: unknown): value is OdooMany2one {
  return value === false || (
    Array.isArray(value)
    && value.length === 2
    && isFiniteNumber(value[0])
    && value[0] > 0
    && typeof value[1] === 'string'
  );
}

function isTruckProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const product = value as Record<string, unknown>;
  return isFiniteNumber(product.id)
    && product.id > 0
    && typeof product.name === 'string'
    && product.name.trim().length > 0
    && typeof product.default_code === 'string'
    && isFiniteNumber(product.list_price)
    && isFiniteNumber(product.qty_available)
    && typeof product.sale_ok === 'boolean'
    && Array.isArray(product.product_tmpl_id)
    && isMany2one(product.product_tmpl_id)
    && isFiniteNumber(product.weight)
    && isMany2one(product.categ_id);
}

/** Validates the complete employee truck-stock envelope before store mutation. */
export function parseTruckStockResponse(result: unknown): TruckStockResponse {
  if (!result || typeof result !== 'object') throw new TruckStockPayloadError();
  const envelope = result as Record<string, unknown>;
  if (envelope.ok !== true || !envelope.data || typeof envelope.data !== 'object') {
    throw new TruckStockPayloadError();
  }
  const data = envelope.data as Record<string, unknown>;
  if (typeof data.has_stock_data !== 'boolean' || !Array.isArray(data.products)) {
    throw new TruckStockPayloadError();
  }
  if (!data.products.every(isTruckProduct)) throw new TruckStockPayloadError();
  return { products: data.products, hasStockData: data.has_stock_data };
}
