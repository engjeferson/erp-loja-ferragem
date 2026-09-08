-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('VALOR', 'PERCENTUAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDENTE', 'ENTREGUE');

-- AlterEnum
ALTER TYPE "FinancialStatus" ADD VALUE 'PARCIALMENTE_PAGO';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CADERNO';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "logoData" BYTEA,
ADD COLUMN     "logoMimeType" TEXT,
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "telefone" TEXT;

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "nomeFantasia" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "uf" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN     "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "conversionFactor" DECIMAL(12,4) NOT NULL DEFAULT 1,
ADD COLUMN     "purchaseUnitId" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "additionalDiscountType" "DiscountType" NOT NULL DEFAULT 'VALOR',
ADD COLUMN     "additionalDiscountValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "freight" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "customerId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "cep" TEXT,
    "endereco" TEXT,
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "uf" TEXT,
    "notes" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDENTE',
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethod",
    "userId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nfe_import_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "nfeImportId" TEXT NOT NULL,
    "codigoProduto" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "unidadeComercial" TEXT NOT NULL,
    "quantidadeComercial" DECIMAL(12,3) NOT NULL,
    "valorUnitarioComercial" DECIMAL(12,4) NOT NULL,
    "valorTotal" DECIMAL(12,2) NOT NULL,
    "productId" TEXT,
    "createNewProduct" BOOLEAN NOT NULL DEFAULT false,
    "unitId" TEXT,
    "conversionFactor" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "salePrice" DECIMAL(12,2),
    "reviewed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "nfe_import_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_saleId_key" ON "deliveries"("saleId");

-- CreateIndex
CREATE INDEX "deliveries_companyId_status_idx" ON "deliveries"("companyId", "status");

-- CreateIndex
CREATE INDEX "financial_payments_companyId_transactionId_idx" ON "financial_payments"("companyId", "transactionId");

-- CreateIndex
CREATE INDEX "nfe_import_items_nfeImportId_idx" ON "nfe_import_items"("nfeImportId");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_purchaseUnitId_fkey" FOREIGN KEY ("purchaseUnitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "financial_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_payments" ADD CONSTRAINT "financial_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_nfeImportId_fkey" FOREIGN KEY ("nfeImportId") REFERENCES "nfe_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
