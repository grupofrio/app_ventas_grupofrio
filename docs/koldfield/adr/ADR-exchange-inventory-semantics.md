# ADR: Exchange inventory semantics

## Status
Accepted (2026-08-15)

## Context
Frontend previously credited damaged/merma quantities back into local sellable
stock (`updateLocalStock(+qty)`), inventing “net 0” that is false for sellable
availability.

## Decision
- Delivery (good): −sellable local stock
- Return damaged: **do not** credit sellable local stock
- Backend continues sending damaged to merma location
- Future ledger buckets: `sellable`, `damaged`, `return_good`, `consigned`

## Consequences
Local inventory tab reflects sellable units after exchange.
Damaged units appear only after CEDIS separation / returns flow.
