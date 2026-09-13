-- AlterTable
ALTER TABLE "nfe_import_items" ADD COLUMN     "suggestedProductId" TEXT;

-- AlterTable
ALTER TABLE "nfe_imports" ADD COLUMN     "numero" TEXT;

-- CreateTable
CREATE TABLE "supplier_product_links" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierCnpj" TEXT NOT NULL,
    "codigoProduto" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_product_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_product_links_companyId_supplierCnpj_codigoProduto_key" ON "supplier_product_links"("companyId", "supplierCnpj", "codigoProduto");

-- AddForeignKey
ALTER TABLE "supplier_product_links" ADD CONSTRAINT "supplier_product_links_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_product_links" ADD CONSTRAINT "supplier_product_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nfe_import_items" ADD CONSTRAINT "nfe_import_items_suggestedProductId_fkey" FOREIGN KEY ("suggestedProductId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
