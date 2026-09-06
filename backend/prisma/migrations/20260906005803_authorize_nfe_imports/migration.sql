-- AlterEnum
BEGIN;
CREATE TYPE "NfeImportStatus_new" AS ENUM ('PENDENTE', 'IMPORTADA', 'REJEITADA', 'ERRO');
ALTER TABLE "nfe_imports" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "nfe_imports" ALTER COLUMN "status" TYPE "NfeImportStatus_new" USING ("status"::text::"NfeImportStatus_new");
ALTER TYPE "NfeImportStatus" RENAME TO "NfeImportStatus_old";
ALTER TYPE "NfeImportStatus_new" RENAME TO "NfeImportStatus";
DROP TYPE "NfeImportStatus_old";
ALTER TABLE "nfe_imports" ALTER COLUMN "status" SET DEFAULT 'PENDENTE';
COMMIT;

-- AlterTable
ALTER TABLE "nfe_imports" ADD COLUMN     "rawData" JSONB,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDENTE';

-- AddForeignKey
ALTER TABLE "nfe_imports" ADD CONSTRAINT "nfe_imports_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

