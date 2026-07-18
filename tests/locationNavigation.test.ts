import assert from 'node:assert/strict';

interface LocationNavigationModule {
  buildStopNavigationUrls: (stop: {
    customer_name: string;
    google_maps_url?: string;
    customer_latitude?: number;
    customer_longitude?: number;
    street?: string | null;
    city?: string | null;
    landmark?: string | null;
    location_reference?: string | null;
  }) => {
    primaryUrl: string | null;
    fallbackUrl: string | null;
  };
}

function testUsesGoogleMapsUrlFirst(module: LocationNavigationModule) {
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Prospecto Centro',
    google_maps_url: 'https://maps.google.com/?q=19.4,-99.1',
    customer_latitude: 19.4,
    customer_longitude: -99.1,
  });

  assert.equal(urls.primaryUrl, 'https://maps.google.com/?q=19.4,-99.1');
  assert.equal(
    urls.fallbackUrl,
    'https://www.google.com/maps/dir/?api=1&destination=19.4,-99.1',
  );
}

function testBuildsCoordsUrl(module: LocationNavigationModule) {
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Prospecto Centro',
    customer_latitude: 19.4,
    customer_longitude: -99.1,
  });

  // P3 (Codex): destino por lat/lon SIN destination_place_id (no era Place ID).
  assert.equal(urls.primaryUrl, 'https://www.google.com/maps/dir/?api=1&destination=19.4,-99.1');
  assert.equal(urls.fallbackUrl, null);
  assert.ok(
    !(urls.primaryUrl ?? '').includes('destination_place_id'),
    'no debe emitir destination_place_id=customer_name',
  );
}

function testReturnsNullWhenNoLocation(module: LocationNavigationModule) {
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Sin ubicación',
  });

  assert.equal(urls.primaryUrl, null);
  assert.equal(urls.fallbackUrl, null);
}

function testAddressFallbackWhenNoGeo(module: LocationNavigationModule) {
  // Sin geo pero con dirección textual → navega por texto (no null).
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Abarrotes Estrada',
    street: 'Av. Juárez 100',
    city: 'Puebla',
  });
  assert.equal(
    urls.primaryUrl,
    'https://www.google.com/maps/dir/?api=1&destination=' +
      encodeURIComponent('Av. Juárez 100, Puebla'),
  );
  assert.equal(urls.fallbackUrl, null);
}

function testGeoBeatsAddress(module: LocationNavigationModule) {
  // Con geo Y dirección, la geo manda para el primary (sin place_id).
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Cliente',
    customer_latitude: 19.4,
    customer_longitude: -99.1,
    street: 'Av. Juárez 100',
  });
  assert.equal(urls.primaryUrl, 'https://www.google.com/maps/dir/?api=1&destination=19.4,-99.1');
  assert.equal(urls.fallbackUrl, null);
}

function testNoNavForReferenceOnly(module: LocationNavigationModule) {
  // P2 (Codex): referencia/landmark NO sirve como destino de navegación textual.
  const urls = module.buildStopNavigationUrls({
    customer_name: 'Sin dirección real',
    landmark: 'junto al OXXO',
    location_reference: 'portón azul',
  });
  assert.equal(urls.primaryUrl, null);
  assert.equal(urls.fallbackUrl, null);
}

async function main() {
  // @ts-ignore -- Node v24 runs this ESM test harness directly.
  const module = await import(
    // @ts-ignore -- import.meta is only for the test runtime, not app compilation.
    new URL('../src/services/locationNavigation.ts', import.meta.url).pathname
  ) as LocationNavigationModule;

  testUsesGoogleMapsUrlFirst(module);
  testBuildsCoordsUrl(module);
  testReturnsNullWhenNoLocation(module);
  testAddressFallbackWhenNoGeo(module);
  testGeoBeatsAddress(module);
  testNoNavForReferenceOnly(module);
  console.log('location navigation tests: ok');
}

void main();
