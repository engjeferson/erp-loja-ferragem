-- CreateEnum
CREATE TYPE "NfeAmbiente" AS ENUM ('PRODUCAO', 'HOMOLOGACAO');

-- CreateEnum
CREATE TYPE "NfeImportStatus" AS ENUM ('IMPORTADA', 'ERRO', 'IGNORADA');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "company_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
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

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfe_imports" (
    "id" TEXT NOT NULL,
    "chaveAcesso" TEXT NOT NULL,
    "nsu" TEXT NOT NULL,
    "supplierId" TEXT,
    "purchaseOrderId" TEXT,
    "emitenteCnpj" TEXT NOT NULL,
    "emitenteNome" TEXT NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "dataEmissao" TIMESTAMP(3) NOT NULL,
    "status" "NfeImportStatus" NOT NULL DEFAULT 'IMPORTADA',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nfe_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nfe_imports_chaveAcesso_key" ON "nfe_imports"("chaveAcesso");

-- CreateIndex
CREATE UNIQUE INDEX "nfe_imports_purchaseOrderId_key" ON "nfe_imports"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "nfe_imports_status_idx" ON "nfe_imports"("status");

-- AddForeignKey
ALTER TABLE "nfe_imports" ADD CONSTRAINT "nfe_imports_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_imports" ADD CONSTRAINT "nfe_imports_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
