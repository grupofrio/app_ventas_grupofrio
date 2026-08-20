# Route preparation pending customers design

## Goal

Make every customer whose price preload failed visible in the route preparation
card, without making a new network request or changing the retry policy.

## Design

The existing preparation state already holds `partnerId`, an optional
`customerName`, and a failure reason. The card will render a bounded list of
those failures before the retry action. After a restart, the durable receipt
only contains partner IDs, so the card will reconstruct names from the local
route stops. If no local name is available, it will use `Cliente #<id>`.

No price, route, bundle, or authorization behavior changes. The feature is
read-only presentation of the existing pending set.
