-- Sizes are part of the item (H5 Fix B, Nov 12). A brand-new item keeps its sizes while it waits
-- for approval. Additive and nullable: existing rows are untouched and no backfill is needed.
-- Deliberately separate from the 2e CHECK-constraint migration, which waits on a fresh production
-- price check (Step 0).

-- AlterTable
ALTER TABLE "MenuRequest" ADD COLUMN     "variantGroup" TEXT,
ADD COLUMN     "variantLabel" TEXT;
