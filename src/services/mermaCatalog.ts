export interface DayBundleCatalogItem {
  id?: unknown;
  name?: unknown;
  default_code?: unknown;
}

export function mergeMermaCatalog<T extends { id: number }>(
  truckProducts: T[],
  catalog: DayBundleCatalogItem[],
  createExtra: (item: { id: number; name: string; default_code: string }) => T,
): T[] {
  const seen = new Set(truckProducts.map((product) => product.id));
  const extras: T[] = [];
  for (const item of catalog) {
    const id = typeof item.id === 'number' && item.id > 0 ? item.id : null;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    extras.push(createExtra({
      id,
      name,
      default_code: typeof item.default_code === 'string' ? item.default_code : '',
    }));
  }
  return [...truckProducts, ...extras];
}
