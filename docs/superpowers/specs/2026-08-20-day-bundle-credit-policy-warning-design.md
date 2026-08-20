# Day-bundle credit policy warning design

## Goal

Allow a Kold Field day bundle containing a finite negative
`payment_policy.credit_used` to load, while preserving a local diagnostic flag
for the affected customer or stop. The anomaly must not block route start,
sales, or collections.

## Scope

The exception is deliberately narrow:

- Only a finite numeric `credit_used < 0` becomes a warning.
- The original value remains unchanged in the stored bundle; the client does
  not clamp or otherwise reinterpret accounting data.
- All other validation remains strict, including missing values, non-numbers,
  `NaN`, infinity, unknown fields, and invalid policy modes.
- `credit_limit` and `credit_available` remain non-negative required numbers.
- No server request or mutation authority changes.

## Design

`employeeDayBundleLogic` will collect validation warnings while validating the
stops and directory. For each negative `credit_used`, it will create a typed
local warning containing only a safe bundle path and the customer or stop id.
The warning will be attached to the validated `StoredDayBundle` record outside
of the server-owned `bundle` payload. The shared schema will permit a signed
numeric `credit_used`; the local warning supplies the quality signal while the
original payload remains auditable.

The validator will continue to return a fully immutable clone. Cached records
will recompute the warning from the raw bundle during validation, preventing a
stale or forged local warning from changing policy. Initial UI scope is
diagnostic-only; it does not change payment-method policy, credit decisions,
or action gates.

## Error handling

- A negative finite `credit_used` is accepted with a warning.
- A malformed `credit_used` remains a hard invalid-bundle error.
- A malformed value in any unrelated field remains a hard invalid-bundle
  error.

## Tests

Add focused unit coverage showing that:

1. a negative directory and stop value both persist corresponding warnings;
2. the value is preserved without normalisation and the bundle remains fresh
   and action-capable;
3. string, absent, `NaN`, and infinite values still reject the bundle;
4. warnings are recomputed from the bundle rather than trusted from storage.
