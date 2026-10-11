-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PsychTestCatalog" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsychTestCatalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestAdministration" (
    "id" TEXT NOT NULL,
    "clinicalRecordId" TEXT NOT NULL,
    "testCatalogId" TEXT,
    "testName" TEXT NOT NULL,
    "administeredAt" TIMESTAMP(3) NOT NULL,
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestAdministration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_relationshipId_status_idx" ON "Task"("relationshipId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PsychTestCatalog_psychologistId_name_key" ON "PsychTestCatalog"("psychologistId", "name");

-- CreateIndex
CREATE INDEX "TestAdministration_clinicalRecordId_administeredAt_idx" ON "TestAdministration"("clinicalRecordId", "administeredAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "PatientPsychologistRelationship"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAdministration" ADD CONSTRAINT "TestAdministration_clinicalRecordId_fkey" FOREIGN KEY ("clinicalRecordId") REFERENCES "ClinicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestAdministration" ADD CONSTRAINT "TestAdministration_testCatalogId_fkey" FOREIGN KEY ("testCatalogId") REFERENCES "PsychTestCatalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
