-- Delivery address: state + unit (2026-07-23) — the two fields a deliverable address needed
-- and the schema didn't have.
--
-- ALL ADDITIVE (ADD COLUMN nullable) — no RENAME, no DROP. STALE-CLIENT WINDOW IS ZERO: the
-- currently-deployed build never selects these columns, so applying against the shared prod DB
-- is invisible to it; the code that reads/writes them deploys after. Safe in either order.
--
-- Why:
--   deliveryState — a real US address has one. Places supplies it
--                   (administrative_area_level_1); the old form had nowhere to put it.
--   deliveryUnit  — apartment / suite / room. Places NEVER supplies this: address_components
--                   has no unit type, so a dorm or apartment delivery gave the runner a
--                   building and no door ("417 Cougar Village" with no "Room 214"). This is
--                   the field that makes campus delivery actually work.
--
-- Both NULLABLE: they are optional on the form (see lib/delivery-address.ts —
-- REQUIRED_DELIVERY_FIELDS is street/city/zip), and every existing row legitimately lacks them.
-- Nothing is backfilled: the 10 legacy rows carry a fabricated zip ('00000') and a city copied
-- from the street, and inventing a state or unit to sit beside them would repeat exactly the
-- mistake this migration exists to end (same precedent as the DELIVERED completedAt null).

ALTER TABLE "Order" ADD COLUMN "deliveryState" TEXT;
ALTER TABLE "Order" ADD COLUMN "deliveryUnit" TEXT;
