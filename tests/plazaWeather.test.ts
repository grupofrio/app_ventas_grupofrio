import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildOpenMeteoForecastUrl,
  formatPlazaWeatherCard,
  parseBranchWeather,
  parseOpenMeteoForecast,
  resolveKnownPlaza,
  resolveWeatherTarget,
} from '../src/services/plazaWeatherLogic.ts';

test('branch weather reads current, max, min and condition without inventing demand', () => {
  const snapshot = parseBranchWeather({
    place: 'Iguala',
    current_c: 32.4,
    max_c: 34,
    min_c: 21,
    condition: 'Parcialmente nublado',
    observed_at: '2026-10-09T14:16:00.000Z',
    forecast: [{ date: '2026-10-10', max_c: 35, min_c: 20 }],
  }, 'Otra', '2026-10-09T14:16:00.000Z');
  assert.ok(snapshot);
  assert.equal(snapshot?.place, 'Iguala');
  assert.equal(snapshot?.currentC, 32);
  assert.equal(snapshot?.maxC, 34);
  assert.equal(snapshot?.minC, 21);
  assert.equal(snapshot?.condition, 'Parcialmente nublado');
  assert.equal(snapshot?.source, 'odoo');
  assert.equal('demand' in (snapshot ?? {}), false);
});

test('a disabled branch weather payload falls through', () => {
  assert.equal(parseBranchWeather({ available: false, current_c: 30 }, 'Iguala', '2026-10-09T14:16:00.000Z'), null);
});

test('open-meteo fallback formats the Mexico clock and does not send an API key', () => {
  const snapshot = parseOpenMeteoForecast({
    current: { temperature_2m: 31.2, weather_code: 2 },
    daily: {
      time: ['2026-10-09'],
      temperature_2m_max: [34.4],
      temperature_2m_min: [20.2],
      weather_code: [2],
    },
  }, 'Guadalajara', '2026-10-09T14:16:00.000Z');
  assert.ok(snapshot);
  const card = formatPlazaWeatherCard(snapshot!);
  assert.equal(card.temperature, '31°');
  assert.equal(card.place, 'Guadalajara');
  assert.equal(card.detail, 'Parcialmente nublado · Máx 34° · Mín 20°');
  assert.equal(card.updated, 'Actualizado 08:16');
  const url = buildOpenMeteoForecastUrl(20.67, -103.34);
  assert.match(url, /api\.open-meteo\.com/);
  assert.doesNotMatch(url, /api_key|apikey|token/i);
});

test('plaza names resolve to Iguala and Guadalajara before the device', () => {
  const iguala = resolveKnownPlaza(['Plaza Iguala']);
  assert.equal(iguala?.label, 'Iguala');
  const guadalajara = resolveWeatherTarget(['CEDIS Guadalajara']);
  assert.equal(guadalajara.kind, 'coordinates');
  if (guadalajara.kind === 'coordinates') assert.equal(guadalajara.label, 'Guadalajara');
});

test('home no longer announces the weather placeholder', () => {
  const home = readFileSync(resolve('app/(tabs)/index.tsx'), 'utf8');
  const card = readFileSync(resolve('src/components/domain/PlazaWeatherCard.tsx'), 'utf8');
  assert.doesNotMatch(home, /Proximamente en KOLD/);
  assert.match(home, /PlazaWeatherCard/);
  assert.match(card, /Clima no disponible/);
  assert.match(card, /card\.updated/);
});
