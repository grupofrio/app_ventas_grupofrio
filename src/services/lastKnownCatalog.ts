import type { TruckProduct } from '../stores/useProductStore.ts';

export interface CatalogIdentity { companyId: number; employeeId: number; warehouseId: number; mobileLocationId: number }
interface RecentProduct { product: TruckProduct; usedAtMs: number }
export interface LastKnownCatalog {
  version: 1;
  context: CatalogIdentity;
  fetchedAtMs: number;
  products: TruckProduct[];
  recent: RecentProduct[];
}
const positiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
export function sameCatalogContext(a: CatalogIdentity | null, b: CatalogIdentity | null): boolean {
  return !!a && !!b && (['companyId','employeeId','warehouseId','mobileLocationId'] as const)
    .every(key => positiveId(a[key]) && a[key] === b[key]);
}
function cleanProduct(value: unknown): TruckProduct | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  if (!positiveId(p.id) || typeof p.name !== 'string' || !p.name.trim() || p.sale_ok !== true) return null;
  const finite = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  const weight = Math.max(0, finite(p.weight, 1));
  const qty = finite(p.qty_available);
  const reserved = Math.max(0, finite(p.qty_reserved));
  return {
    id: p.id, name: p.name.slice(0,512), default_code: typeof p.default_code === 'string' ? p.default_code.slice(0,128) : undefined,
    list_price: Math.max(0,finite(p.list_price)), qty_available: qty, sale_ok: true,
    product_tmpl_id: Array.isArray(p.product_tmpl_id) && positiveId(p.product_tmpl_id[0]) ? [p.product_tmpl_id[0],String(p.product_tmpl_id[1] ?? '').slice(0,512)] : false,
    categ_id: Array.isArray(p.categ_id) && positiveId(p.categ_id[0]) ? [p.categ_id[0],String(p.categ_id[1] ?? '').slice(0,512)] : false,
    weight, qty_reserved: reserved, qty_display: qty - reserved, _totalKg: (qty-reserved)*weight, _isGlobalFallback: false,
  };
}
function products(values: unknown): TruckProduct[] {
  if (!Array.isArray(values)) return [];
  const unique = new Map<number,TruckProduct>();
  for (const value of values.slice(0,5000)) { const p=cleanProduct(value); if(p) unique.set(p.id,p); }
  return [...unique.values()];
}
function recentProducts(values: unknown): RecentProduct[] {
  if (!Array.isArray(values)) return [];
  const unique = new Map<number,RecentProduct>();
  for (const item of values) {
    const p=cleanProduct(item?.product);
    if(p && typeof item.usedAtMs === 'number' && Number.isFinite(item.usedAtMs) && item.usedAtMs>0) {
      const previous=unique.get(p.id);
      if(!previous || previous.usedAtMs<item.usedAtMs) unique.set(p.id,{product:p,usedAtMs:item.usedAtMs});
    }
  }
  return [...unique.values()].sort((a,b)=>b.usedAtMs-a.usedAtMs || a.product.id-b.product.id).slice(0,100);
}
export function buildLastKnownCatalog(context: CatalogIdentity, values: unknown[], fetchedAtMs: number, previous: LastKnownCatalog | null): LastKnownCatalog {
  return { version:1,context:{...context},fetchedAtMs,products:products(values),recent:sameCatalogContext(context,previous?.context ?? null)?recentProducts(previous?.recent):[] };
}
export function rememberCatalogProduct(snapshot: LastKnownCatalog, productId: number, usedAtMs: number): LastKnownCatalog {
  const product=snapshot.products.find(p=>p.id===productId) ?? snapshot.recent.find(p=>p.product.id===productId)?.product;
  if(!product) return snapshot;
  return {...snapshot,recent:recentProducts([...snapshot.recent,{product,usedAtMs}])};
}
export function readLastKnownCatalog(raw: unknown, context: CatalogIdentity | null): LastKnownCatalog | null {
  if(!raw || typeof raw!=='object') return null;
  const value=raw as LastKnownCatalog;
  if(value.version!==1 || !sameCatalogContext(value.context,context) || !Number.isFinite(value.fetchedAtMs) || value.fetchedAtMs<=0 || !Array.isArray(value.products)) return null;
  const catalog=products(value.products), recent=recentProducts(value.recent), ids=new Set(catalog.map(p=>p.id));
  for(const {product} of recent) if(!ids.has(product.id)) {
    catalog.push({...product,qty_available:0,qty_reserved:0,qty_display:0,_totalKg:0}); ids.add(product.id);
  }
  return {version:1,context:{...value.context},fetchedAtMs:value.fetchedAtMs,products:catalog,recent};
}
