# INV-1 — Ambiguous acknowledgement window

**Superseded by INV-1B:** see `docs/koldfield/INV1B_AMBIGUOUS_ACK.md`.

Historical note from stabilization (#77): keep-set used `queue ≠ done/dead`,
which allowed double-apply when the server had committed but the mobile ack
was lost. INV-1B closes that with operation-identity reconcile + post-ack
snapshot sequencing.
