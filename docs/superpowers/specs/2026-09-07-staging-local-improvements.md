# Local improvements in staging

User approved staging integration after reviewing local differences. Preserve main production history and stock-reference behavior. Base the integration on the existing staging branch plus current origin/main.

## Selected scope
- Bring customer deactivation request into the modern employee API and durable queue; distinguish locally queued requests from confirmed review, refresh server state, permit a new request after rejection, and avoid duplicate submissions.
- Recover a last-known catalog within the same company/employee/warehouse/mobile-location context without its daily TTL deleting the last-known fallback; include bounded recently selected products. Preserve current price-confirmation semantics and referential stock behavior, including online. Never import the old offline branch wholesale.
- Protect insufficient-stock rejected sales and their dependencies from generic cleanup, retain an actionable retry using the same operation ID and preserve existing physical-review safeguards.
- Preserve staging identity, backend verification and production EAS ownership/version from main. Validate before pushing to the existing staging integration branch. Android staging APK is the initial distribution target; do not promote production or change main.

## Validation
Run regression tests for scope/context isolation, cleanup protection and review state; full npm test and typecheck; verify compiled staging config and attempt Android staging build using available credentials. Device/backend transaction QA must be reported separately from automated checks. No production writes.

## Deployment identity
Use the corporate EAS project 0a24997e-51fe-417a-a8d7-4bc83a1d7dff owned by grupofrio. Staging Android package is mx.grupofrio.koldfield.staging and needs its own credentials. Production APK verification does not apply to it; validate eventual APK package/version/certificate separately.
