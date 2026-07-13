-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MITRA');

-- CreateEnum
CREATE TYPE "FishPhase" AS ENUM ('BENIH', 'GROWER', 'FINISHER', 'INDUK');

-- CreateEnum
CREATE TYPE "PelletType" AS ENUM ('TERAPUNG', 'TENGGELAM');

-- CreateEnum
CREATE TYPE "PelletLength" AS ENUM ('PENDEK', 'SEDANG', 'PANJANG');

-- CreateEnum
CREATE TYPE "IngredientCondition" AS ENUM ('KERING', 'AGAK_LEMBAP', 'BASAH');

-- CreateEnum
CREATE TYPE "IngredientForm" AS ENUM ('HALUS', 'SEDANG', 'KASAR');

-- CreateEnum
CREATE TYPE "IngredientCharacter" AS ENUM ('MUDAH_MENGIKAT', 'SULIT_MENGIKAT', 'BERMINYAK', 'NETRAL');

-- CreateEnum
CREATE TYPE "FormulationPriority" AS ENUM ('TERMURAH', 'SEIMBANG', 'NUTRISI_TINGGI');

-- CreateEnum
CREATE TYPE "OperationMode" AS ENUM ('OTOMATIS', 'MANUAL');

-- CreateEnum
CREATE TYPE "PowerSource" AS ENUM ('PLN', 'BATERAI', 'HYBRID');

-- CreateEnum
CREATE TYPE "SniStatus" AS ENUM ('SESUAI', 'BELUM_SESUAI');

-- CreateEnum
CREATE TYPE "WarningType" AS ENUM ('BAHAN_TERLALU_KERING', 'BAHAN_TERLALU_BASAH', 'PROTEIN_KURANG', 'SERAT_TERLALU_TINGGI', 'LEMAK_TERLALU_RENDAH', 'BINDER_RENDAH', 'PATI_RENDAH_PELET_TERAPUNG', 'DIAMETER_TIDAK_SESUAI_FASE', 'KADAR_AIR_AKHIR_TINGGI', 'LAINNYA');

-- CreateEnum
CREATE TYPE "WarningSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ONLINE', 'OFFLINE', 'ERROR');

-- CreateEnum
CREATE TYPE "DeviceEventType" AS ENUM ('PARAMETER_SENT', 'STATUS_UPDATE', 'PROCESS_COMPLETED', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MITRA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fish_species" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "fish_species_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sni_standards" (
    "id" TEXT NOT NULL,
    "fishSpeciesId" TEXT NOT NULL,
    "phase" "FishPhase" NOT NULL,
    "proteinMinPct" DECIMAL(5,2) NOT NULL,
    "lemakMinPct" DECIMAL(5,2) NOT NULL,
    "seratKasarMaksPct" DECIMAL(5,2) NOT NULL,
    "abuMaksPct" DECIMAL(5,2) NOT NULL,
    "kadarAirMaksPct" DECIMAL(5,2) NOT NULL,
    "diameterMinMm" DECIMAL(5,2) NOT NULL,
    "diameterMaksMm" DECIMAL(5,2),
    "npnMaksPct" DECIMAL(5,2) NOT NULL,
    "floatingRateMinPct" DECIMAL(5,2) NOT NULL,
    "stabilitasAirApungMinMenit" INTEGER NOT NULL,
    "stabilitasAirTenggelamMinMenit" INTEGER NOT NULL,
    "aflatoksinMaksPpb" DECIMAL(6,2) NOT NULL,
    "salmonellaHarusNegatif" BOOLEAN NOT NULL DEFAULT true,
    "antibiotikMaksUgKg" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sni_standards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingredients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "proteinPct" DECIMAL(5,2) NOT NULL,
    "lemakPct" DECIMAL(5,2) NOT NULL,
    "seratKasarPct" DECIMAL(5,2) NOT NULL,
    "abuPct" DECIMAL(5,2) NOT NULL,
    "kadarAirPct" DECIMAL(5,2) NOT NULL,
    "kandunganPati" "IngredientCharacter",
    "karakterBahan" "IngredientCharacter" NOT NULL DEFAULT 'NETRAL',
    "hargaStandarPerKg" DECIMAL(12,2) NOT NULL,
    "statusTersedia" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_parameters" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "unit" TEXT,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "rule_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mqttTopic" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'OFFLINE',
    "firmwareVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_logs" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "formulationId" TEXT,
    "eventType" "DeviceEventType" NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fishSpeciesId" TEXT NOT NULL,
    "phase" "FishPhase" NOT NULL,
    "umurIkanHari" INTEGER NOT NULL,
    "jumlahIkanEkor" INTEGER NOT NULL,
    "bobotRataRataGram" DECIMAL(8,2),
    "jenisPellet" "PelletType" NOT NULL,
    "diameterPelletMm" DECIMAL(5,2) NOT NULL,
    "panjangPellet" "PelletLength",
    "teksturTarget" TEXT,
    "targetProduksiKgBatch" DECIMAL(8,2) NOT NULL,
    "prioritas" "FormulationPriority" NOT NULL,
    "modeOperasi" "OperationMode" NOT NULL,
    "sumberDaya" "PowerSource",
    "totalBiayaRp" DECIMAL(12,2) NOT NULL,
    "estimasiProteinPct" DECIMAL(5,2) NOT NULL,
    "estimasiLemakPct" DECIMAL(5,2) NOT NULL,
    "estimasiSeratPct" DECIMAL(5,2) NOT NULL,
    "estimasiAbuPct" DECIMAL(5,2) NOT NULL,
    "estimasiKadarAirPct" DECIMAL(5,2) NOT NULL,
    "statusSni" "SniStatus" NOT NULL,
    "saranKoreksi" TEXT,
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulation_ingredients" (
    "id" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "jumlahKg" DECIMAL(8,3) NOT NULL,
    "persentase" DECIMAL(5,2) NOT NULL,
    "hargaPerKgSaatItu" DECIMAL(12,2) NOT NULL,
    "kondisiBahan" "IngredientCondition" NOT NULL,
    "bentukBahan" "IngredientForm",
    "proteinPctSaatItu" DECIMAL(5,2) NOT NULL,
    "lemakPctSaatItu" DECIMAL(5,2) NOT NULL,
    "seratKasarPctSaatItu" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "formulation_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "machine_parameters" (
    "id" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "suhuHeaterCelcius" DECIMAL(5,2) NOT NULL,
    "kecepatanExtruderRpm" DECIMAL(6,2) NOT NULL,
    "kecepatanPisauRpm" DECIMAL(6,2) NOT NULL,
    "waktuMixingMenit" DECIMAL(5,2) NOT NULL,
    "targetKadarAirAdonanPct" DECIMAL(5,2) NOT NULL,
    "estimasiAirTambahanMl" DECIMAL(8,2) NOT NULL,
    "urutanProses" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "machine_parameters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warnings" (
    "id" TEXT NOT NULL,
    "formulationId" TEXT NOT NULL,
    "jenis" "WarningType" NOT NULL,
    "severity" "WarningSeverity" NOT NULL DEFAULT 'WARNING',
    "rekomendasi" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "fish_species_name_key" ON "fish_species"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sni_standards_fishSpeciesId_phase_key" ON "sni_standards"("fishSpeciesId", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "ingredients_name_key" ON "ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "rule_parameters_key_key" ON "rule_parameters"("key");

-- CreateIndex
CREATE UNIQUE INDEX "devices_deviceCode_key" ON "devices"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "devices_mqttTopic_key" ON "devices"("mqttTopic");

-- CreateIndex
CREATE INDEX "device_logs_deviceId_createdAt_idx" ON "device_logs"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "formulations_userId_createdAt_idx" ON "formulations"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "machine_parameters_formulationId_key" ON "machine_parameters"("formulationId");

-- AddForeignKey
ALTER TABLE "sni_standards" ADD CONSTRAINT "sni_standards_fishSpeciesId_fkey" FOREIGN KEY ("fishSpeciesId") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_parameters" ADD CONSTRAINT "rule_parameters_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_logs" ADD CONSTRAINT "device_logs_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_fishSpeciesId_fkey" FOREIGN KEY ("fishSpeciesId") REFERENCES "fish_species"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulations" ADD CONSTRAINT "formulations_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulation_ingredients" ADD CONSTRAINT "formulation_ingredients_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "machine_parameters" ADD CONSTRAINT "machine_parameters_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warnings" ADD CONSTRAINT "warnings_formulationId_fkey" FOREIGN KEY ("formulationId") REFERENCES "formulations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
