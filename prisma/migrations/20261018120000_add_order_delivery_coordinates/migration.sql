-- DELIVERY COORDINATES — the destination of a home-delivery order, geocoded on the SERVER from
-- the stored address (lib/delivery-radius.ts) and checked against the fair's delivery radius
-- before any PaymentIntent exists.
--
-- Additive and nullable (expand only): orders placed before radius enforcement keep NULL, which
-- is the honest value — they were never geocoded, and inventing a point for them would be a
-- fabricated default. Readers treat NULL as "no destination pin".
ALTER TABLE "Order" ADD COLUMN "deliveryLat" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "deliveryLng" DOUBLE PRECISION;
ALTER TABLE "Order" ADD COLUMN "deliveryGeoPrecision" TEXT;
