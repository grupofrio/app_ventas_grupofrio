# Kold Field — Current State Audit

**Fecha:** 2026-08-15  
**Repos:** `grupofrio/gf` @ `b439e855` (main) / PR #73 `e782803b` · `grupofrio/app_ventas_grupofrio` @ `5065faf` (main) / PR #73 `47fc292`  
**Método:** git fetch, `gh pr`, comparación PR73 vs main vs commits de Carlos/Sebastián. Los documentos de referencia en `docs/koldfield/reference/` son históricos, no fuente única de verdad.

## Resumen ejecutivo

| Repo | main | PR #73 | Autor PR | Estado CI |
|---|---|---|---|---|
| gf | sin day-bundle R0/R1 | OPEN `codex/koldfield-r0-r1` | Sebastián | **CI_INFRASTRUCTURE_BLOCKED** (billing/spending limit — runners no arrancan) |
| app | F2 + F3.1/3.2/3.3/3.6 mergeados (Carlos) | OPEN `codex/koldfield-r0-r1` | Sebastián | MERGEABLE CLEAN (sin checks reportados) |

**Conflicto crítico pre-merge:** gf PR73 exige UUID v4 en mutaciones; app main/PR tip (antes de esta iteración) emitía `Date.now()`+random en venta/regalo/no-venta/preventa/liquidación. Corregido en esta rama app PR73.

**Conflicto store_response:** Carlos #57 (savepoint, no envenenar TX) vs Sebas PR73 (fail-loud durability). Clasificación: **MERGE** — conservar savepoint de Carlos + no tragar excepciones silenciosamente. Seguimiento en ADR.

## Matriz FEATURE

| FEATURE | BACKEND | FRONTEND | PR | SHA / evidencia | AUTOR | ESTADO | RIESGO | ACCIÓN |
|---|---|---|---|---|---|---|---|---|
| Login empleado Bearer | PR73 | PR73 | ambos#73 | login + api bearer | Sebas | DONE(PR) / MISSING(main) | Alto | Co-merge |
| Credenciales privilegiadas embebidas | n/a | removidas PR73; presentes main `_layout.tsx` | app#73 | `7971c06` | Sebas | DONE(PR) / BROKEN(main) | **Crítico** | Merge app#73 + ROTATION REQUIRED |
| odooRpc / JSON-RPC genérico | n/a | removido PR73 | app#73 | `47fc292` | Sebas | DONE(PR) / BROKEN(main) | **Crítico** | Co-merge |
| Day bundle | PR73 | PR73 consumer cifrado | ambos#73 | `koldfield_bundle.py` / `employeeDayBundle` | Sebas | DONE(PR) + fixes esta iteración | Alto | Co-deploy |
| Directory offroute | PR73: plaza expand | consume directory | gf#73 | `_directory` + `_plaza_partner_domain` | Sebas+esta | PARTIAL→FIXED(PR) | Alto | Tests plaza A≠B |
| Catálogo qty>0 only | FIXED: incluye 0 + load | — | gf#73 | `_catalog` | esta | FIXED(PR) | Med | — |
| gift_reasons / competitors | models + seeds | consume | gf#73 | `gf.gift.reason` / `gf.field.competitor` | esta | FIXED(PR) | Med | Admin puede ampliar |
| payment_policy | estructural (limit/días) | validator acepta | gf#73+app#73 | `_payment_policy` | esta | PARTIAL | Med | NEEDS_BUSINESS_DECISION mapeo credit_only |
| salePaymentMethod UI | policy en bundle | selector aún existe | ambos | `sale/[stopId].tsx` | — | OPEN | Med | NEXT: derivar de policy |
| Exchange sellable←merma | backend merma scrap | FIXED no +stock | app#73 | exchange stock | esta | FIXED(PR) | Alto | Ledger buckets NEXT |
| Consignación cash + online | Bearer PR | cash hardcode | app | consignment | — | OPEN | Med | Producto + offline |
| Gift accounting | picking→cliente | copy corregida | ambos | gift handler | Carlos/Sebas/esta | SUPERSEDED+copy FIXED | Med | ADR gift model |
| UUID v4 ops | required PR73 | FIXED sale/gift/nosale/presale/exchange/cashclose | app#73 | createUuidV4 | esta | FIXED(PR) | **Crítico** | — |
| Tabs Tareas/Alertas | n/a | siguen | app main | tabs/_layout | — | PARTIAL | Bajo | No borrar; integrar en Mi día |
| Ranking | n/a | disabled PR73 | app#73 | `d0ba570` | Sebas | DONE(PR) | Med | No reactivar legacy |
| Tema claro F2 | n/a | DONE main | main #68– | tokens | Carlos | DONE | Bajo | KEEP |
| F3.1 preload | — | DONE | main #70 | Carlos | DONE | Bajo | KEEP |
| F3.2 stock local | — | DONE | main #69 | Carlos | DONE | Bajo | KEEP |
| F3.3 op ids estables | — | DONE pero no-v4 → FIXED | main #71 + esta | Carlos+esta | DONE | Med | KEEP+UUID |
| F3.6 geocerca única | — | DONE | main #72 | Carlos | DONE | Bajo | KEEP |
| B1.3 idempotencia | main parcial + PR endurece | — | gf#46/#73 | Carlos/Sebas | PARTIAL | Alto | Reconciliar |
| Devoluciones acuse | MISSING | stub | — | — | MISSING | Alto | Workstream D |
| Rechazo traspaso | MISSING | — | — | — | MISSING | Alto | Workstream D |
| Checklist blocking | MISSING | soft | — | — | MISSING | Med | Workstream D |
| Inventario ledger | MISSING | updateLocalStock | — | — | MISSING | Alto | Workstream C |
| Convertir prospecto CTA | — | F1.8 existe | main | postvisit | Carlos | PARTIAL | Bajo | Endpoint explícito B2.9 |

## Clasificación PR73 vs trabajo posterior

| Bloque | KEEP | SUPERSEDED | MERGE | REIMPLEMENT | REMOVE | CONFLICT |
|---|---|---|---|---|---|---|
| Bearer auth + quitar RPC | ✓ | | | | privileged client main | |
| Day bundle v1 | ✓ + fixes directory/catalog/policy/catalogs | | | | | |
| Encrypted field storage | ✓ | | | | | |
| Ranking disable | ✓ | | | | | |
| Carlos F2/F3 en app main | ✓ (base de PR73 app) | | | | | |
| Carlos store_response savepoint | | | ✓ con fail-loud | | | vs PR73 |
| Carlos B1.3 optional op id | | soft-gate superseded by UUID require | | | | vs PR73 UUID |
| Auditoría “regalo=merma” | | SUPERSEDED por gift→cliente | | | copy UI | |

## CI

- **gf PR #73:** annotation oficial: *"The job was not started because recent account payments have failed or your spending limit needs to be increased."* → `CI_INFRASTRUCTURE_BLOCKED`, no `TEST_FAILURE`.
- Validación local obligatoria: `python3 -m pytest -q tests` (subset disponible sin Odoo runtime) + module contract scripts + `python3 -m compileall -q .` + `git diff --check`.

## P0 reales que siguen / seguían pendientes

1. Co-merge app+gf PR73 (seguridad).
2. Rotación de credencial histórica `direccion@` (ROTATION REQUIRED — no documentar secreto).
3. UUID v4 en todas las mutaciones de campo — **corregido en esta iteración**.
4. Directory offroute plaza-scoped — **corregido en esta iteración**.
5. Catálogo con stock 0 — **corregido**.
6. Catálogos gift/competitors vacíos — **corregidos con modelos+seeds**.
7. Exchange merma→sellable — **corregido**.
8. payment_policy contractual — **parcial** (estructural; credit_only/blocked hold pendientes de negocio).
9. salePaymentMethod UI — aún OPEN.
10. Consignación cash/online — OPEN.
11. Devoluciones / rechazo carga / ledger — MISSING (workstreams siguientes).

## Estrategia de ramas

- Correcciones R0/R1 → **mismas ramas** `codex/koldfield-r0-r1` / PRs #73.
- Workstreams C–F (ledger, returns, Mi día IA, QA campo) → ramas nuevas `cursor/<scope>-7494` solo cuando el alcance sea claramente separado.
