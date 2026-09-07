-- Multi-tenant: introduces "companies" as the tenant table and scopes every
-- domain table to a companyId. Existing data is preserved by migrating the
-- single company_settings row (if any) into the first Company, and backfilling
-- companyId on every other table to point at it, before locking the column
-- down to NOT NULL. Safe to run on a fresh empty database too.

-- 1. Tenant table.
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "cnpj" TEXT,
    "razaoSocial" TEXT,
    "uf" TEXT,
    "ambiente" "NfeAmbiente" NOT NULL DEFAULT 'PRODUCAO',
    "certificateFileName" TEXT,
    "certificateUploadedAt" TIMESTAMP(3),
    "certificateSubjectCn" TEXT,
    "certificateValidTo" TIMESTAMP(3),
    "certificateData" BYTEA,
    "certificateIv" BYTEA,
    "certificateAuthTag" BYTEA,
    "certificatePassword" BYTEA,
    "certificatePasswordIv" BYTEA,
    "certificatePasswordTag" BYTEA,
    "nfeUltNsu" TEXT NOT NULL DEFAULT '000000000000000',
    "nfeMaxNsu" TEXT NOT NULL DEFAULT '000000000000000',
    "lastRadarCheckAt" TIMESTAMP(3),
    "lastRadarStatus" TEXT,
    "lastRadarError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_cnpj_key" ON "companies"("cnpj");

-- 2. Carry the existing (singleton) company_settings row over as the first
--    company, reusing its id so downstream backfills don't need a lookup.
INSERT INTO "companies" (
  "id", "name", "cnpj", "razaoSocial", "uf", "ambiente",
  "certificateFileName", "certificateUploadedAt", "certificateSubjectCn", "certificateValidTo",
  "certificateData", "certificateIv", "certificateAuthTag",
  "certificatePassword", "certificatePasswordIv", "certificatePasswordTag",
  "nfeUltNsu", "nfeMaxNsu", "lastRadarCheckAt", "lastRadarStatus", "lastRadarError",
  "createdAt", "updatedAt"
)
SELECT
  cs."id",
  COALESCE(NULLIF(cs."razaoSocial", ''), 'Minha Loja'),
  cs."cnpj", cs."razaoSocial", cs."uf", cs."ambiente",
  cs."certificateFileName", cs."certificateUploadedAt", cs."certificateSubjectCn", cs."certificateValidTo",
  cs."certificateData", cs."certificateIv", cs."certificateAuthTag",
  cs."certificatePassword", cs."certificatePasswordIv", cs."certificatePasswordTag",
  cs."nfeUltNsu", cs."nfeMaxNsu", cs."lastRadarCheckAt", cs."lastRadarStatus", cs."lastRadarError",
  cs."createdAt", cs."updatedAt"
FROM "company_settings" cs;

-- Fallback for a database where company_settings was never touched (fresh
-- install) - make sure at least one company exists to backfill onto below.
INSERT INTO "companies" ("id", "name", "createdAt", "updatedAt")
SELECT 'default', 'Minha Loja', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "companies");

-- 3. Add companyId nullable first (existing rows can't satisfy NOT NULL
--    yet), backfill everything onto the single company created above (there
--    is only ever one at this point in time), then lock it down.
ALTER TABLE "users" ADD COLUMN "companyId" TEXT;
ALTER TABLE "categories" ADD COLUMN "companyId" TEXT;
ALTER TABLE "units" ADD COLUMN "companyId" TEXT;
ALTER TABLE "products" ADD COLUMN "companyId" TEXT;
ALTER TABLE "customers" ADD COLUMN "companyId" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "companyId" TEXT;
ALTER TABLE "sales" ADD COLUMN "companyId" TEXT;
ALTER TABLE "purchase_orders" ADD COLUMN "companyId" TEXT;
ALTER TABLE "financial_categories" ADD COLUMN "companyId" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN "companyId" TEXT;
ALTER TABLE "nfe_imports" ADD COLUMN "companyId" TEXT;

UPDATE "users" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "categories" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "units" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "products" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "customers" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "suppliers" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "sales" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "purchase_orders" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "financial_categories" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "financial_transactions" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;
UPDATE "nfe_imports" SET "companyId" = (SELECT "id" FROM "companies" LIMIT 1) WHERE "companyId" IS NULL;

ALTER TABLE "users" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "categories" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "units" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "products" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "customers" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "suppliers" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "sales" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "purchase_orders" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "financial_categories" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "financial_transactions" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "nfe_imports" ALTER COLUMN "companyId" SET NOT NULL;

-- 4. Drop old single-column unique constraints now superseded by
--    (companyId, x) composites.
DROP INDEX IF EXISTS "categories_name_key";
DROP INDEX IF EXISTS "customers_document_key";
DROP INDEX IF EXISTS "financial_categories_name_key";
DROP INDEX IF EXISTS "financial_transactions_type_status_idx";
DROP INDEX IF EXISTS "nfe_imports_status_idx";
DROP INDEX IF EXISTS "products_barcode_key";
DROP INDEX IF EXISTS "products_categoryId_idx";
DROP INDEX IF EXISTS "products_sku_key";
DROP INDEX IF EXISTS "suppliers_document_key";
DROP INDEX IF EXISTS "units_abbreviation_key";
DROP INDEX IF EXISTS "units_name_key";

-- 5. Sale/PurchaseOrder.number stop being a global-sequence autoincrement -
--    the application now computes the next number per company on creation.
--    Existing values are kept as-is (still valid/unique - only one company
--    exists at this point).
ALTER TABLE "purchase_orders" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "purchase_orders_number_seq";
ALTER TABLE "sales" ALTER COLUMN "number" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "sales_number_seq";

-- 6. New composite indexes/constraints.
CREATE UNIQUE INDEX "categories_companyId_name_key" ON "categories"("companyId", "name");
CREATE UNIQUE INDEX "customers_companyId_document_key" ON "customers"("companyId", "document");
CREATE UNIQUE INDEX "financial_categories_companyId_name_key" ON "financial_categories"("companyId", "name");
CREATE INDEX "financial_transactions_companyId_type_status_idx" ON "financial_transactions"("companyId", "type", "status");
CREATE INDEX "nfe_imports_companyId_status_idx" ON "nfe_imports"("companyId", "status");
CREATE INDEX "products_companyId_categoryId_idx" ON "products"("companyId", "categoryId");
CREATE UNIQUE INDEX "products_companyId_sku_key" ON "products"("companyId", "sku");
CREATE UNIQUE INDEX "products_companyId_barcode_key" ON "products"("companyId", "barcode");
CREATE UNIQUE INDEX "purchase_orders_companyId_number_key" ON "purchase_orders"("companyId", "number");
CREATE UNIQUE INDEX "sales_companyId_number_key" ON "sales"("companyId", "number");
CREATE UNIQUE INDEX "suppliers_companyId_document_key" ON "suppliers"("companyId", "document");
CREATE UNIQUE INDEX "units_companyId_name_key" ON "units"("companyId", "name");
CREATE UNIQUE INDEX "units_companyId_abbreviation_key" ON "units"("companyId", "abbreviation");
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- 7. Foreign keys.
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "categories" ADD CONSTRAINT "categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "units" ADD CONSTRAINT "units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "products" ADD CONSTRAINT "products_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_categories" ADD CONSTRAINT "financial_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "nfe_imports" ADD CONSTRAINT "nfe_imports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. company_settings is now fully superseded by companies.
DROP TABLE "company_settings";
