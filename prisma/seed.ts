import { PrismaClient, FishPhase, IngredientCharacter } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { config } from "dotenv";
import path from "node:path";
import bcrypt from "bcryptjs";

config({ path: path.join(__dirname, "..", ".env") });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  // ============================================================
  // 1. FISH SPECIES
  // ============================================================
  const leleDumbo = await prisma.fishSpecies.upsert({
    where: { name: "Lele Dumbo" },
    update: {},
    create: { name: "Lele Dumbo" },
  });

  console.log("✓ FishSpecies: Lele Dumbo");

  // ============================================================
  // 2. SNI STANDARDS (SNI 01-4087-2006, Tabel 1)
  // ============================================================
  const sniData = [
    {
      phase: FishPhase.BENIH,
      proteinMinPct: 30,
      lemakMinPct: 5,
      seratKasarMaksPct: 6,
      abuMaksPct: 13,
      kadarAirMaksPct: 12,
      diameterMinMm: 0,
      diameterMaksMm: 2,
    },
    {
      phase: FishPhase.GROWER,
      proteinMinPct: 28,
      lemakMinPct: 5,
      seratKasarMaksPct: 8,
      abuMaksPct: 13,
      kadarAirMaksPct: 12,
      diameterMinMm: 2,
      diameterMaksMm: 3,
    },
    {
      phase: FishPhase.FINISHER,
      proteinMinPct: 25,
      lemakMinPct: 5,
      seratKasarMaksPct: 8,
      abuMaksPct: 13,
      kadarAirMaksPct: 12,
      diameterMinMm: 3,
      diameterMaksMm: 4,
    },
    {
      phase: FishPhase.INDUK,
      proteinMinPct: 30,
      lemakMinPct: 5,
      seratKasarMaksPct: 8,
      abuMaksPct: 13,
      kadarAirMaksPct: 12,
      diameterMinMm: 4,
      diameterMaksMm: null,
    },
  ];

  const sniShared = {
    npnMaksPct: 0.2,
    floatingRateMinPct: 80,
    stabilitasAirApungMinMenit: 15,
    stabilitasAirTenggelamMinMenit: 5,
    aflatoksinMaksPpb: 50,
    salmonellaHarusNegatif: true,
    antibiotikMaksUgKg: 0,
  };

  for (const sni of sniData) {
    await prisma.sniStandard.upsert({
      where: {
        fishSpeciesId_phase: {
          fishSpeciesId: leleDumbo.id,
          phase: sni.phase,
        },
      },
      update: {},
      create: {
        fishSpeciesId: leleDumbo.id,
        ...sni,
        ...sniShared,
      },
    });
  }

  console.log("✓ SniStandard: 4 fase (benih, grower, finisher, induk)");

  // ============================================================
  // 3. INGREDIENTS (Bahan Baku Referensi)
  // ============================================================
  const ingredients = [
    {
      name: "Tepung Ikan",
      proteinPct: 55,
      lemakPct: 8,
      seratKasarPct: 1,
      abuPct: 20,
      kadarAirPct: 10,
      karakterBahan: IngredientCharacter.NETRAL,
      hargaStandarPerKg: 15000,
    },
    {
      name: "Bungkil Kedelai",
      proteinPct: 44,
      lemakPct: 2,
      seratKasarPct: 7,
      abuPct: 6,
      kadarAirPct: 12,
      karakterBahan: IngredientCharacter.NETRAL,
      hargaStandarPerKg: 8000,
    },
    {
      name: "Tepung Jagung",
      proteinPct: 9,
      lemakPct: 4,
      seratKasarPct: 3,
      abuPct: 2,
      kadarAirPct: 12,
      karakterBahan: IngredientCharacter.NETRAL,
      hargaStandarPerKg: 5000,
    },
    {
      name: "Dedak Padi",
      proteinPct: 12,
      lemakPct: 8,
      seratKasarPct: 12,
      abuPct: 10,
      kadarAirPct: 12,
      karakterBahan: IngredientCharacter.BERMINYAK,
      hargaStandarPerKg: 3000,
    },
    {
      name: "Tapioka",
      proteinPct: 1,
      lemakPct: 0.5,
      seratKasarPct: 0.5,
      abuPct: 0.5,
      kadarAirPct: 13,
      karakterBahan: IngredientCharacter.MUDAH_MENGIKAT,
      hargaStandarPerKg: 7000,
    },
    {
      name: "Tepung Tulang",
      proteinPct: 20,
      lemakPct: 5,
      seratKasarPct: 2,
      abuPct: 45,
      kadarAirPct: 8,
      karakterBahan: IngredientCharacter.SULIT_MENGIKAT,
      hargaStandarPerKg: 6000,
    },
    {
      name: "Minyak Ikan",
      proteinPct: 0,
      lemakPct: 99,
      seratKasarPct: 0,
      abuPct: 0,
      kadarAirPct: 0.5,
      karakterBahan: IngredientCharacter.BERMINYAK,
      hargaStandarPerKg: 25000,
    },
    {
      name: "Tepung Darah",
      proteinPct: 80,
      lemakPct: 1.5,
      seratKasarPct: 1,
      abuPct: 5,
      kadarAirPct: 10,
      karakterBahan: IngredientCharacter.SULIT_MENGIKAT,
      hargaStandarPerKg: 10000,
    },
  ];

  for (const ing of ingredients) {
    await prisma.ingredient.upsert({
      where: { name: ing.name },
      update: { ...ing, statusTersedia: true },
      create: { ...ing, statusTersedia: true },
    });
  }

  console.log(`✓ Ingredients: ${ingredients.length} bahan baku`);

  // ============================================================
  // 4. RULE PARAMETERS
  //    Nilai BELUM FINAL — akan dikalibrasi pasca uji alat.
  //    Disimpan di DB supaya bisa diupdate via admin tanpa redeploy.
  // ============================================================
  const ruleParams = [
    // --- SUHU HEATER ---
    { key: "suhu_heater_terapung_min_c", value: "80", unit: "°C", description: "Suhu heater minimum untuk pelet terapung", category: "SUHU" },
    { key: "suhu_heater_terapung_max_c", value: "100", unit: "°C", description: "Suhu heater maksimum untuk pelet terapung", category: "SUHU" },
    { key: "suhu_heater_tenggelam_min_c", value: "60", unit: "°C", description: "Suhu heater minimum untuk pelet tenggelam", category: "SUHU" },
    { key: "suhu_heater_tenggelam_max_c", value: "80", unit: "°C", description: "Suhu heater maksimum untuk pelet tenggelam", category: "SUHU" },
    { key: "suhu_tambahan_bahan_basah_c", value: "10", unit: "°C", description: "Tambahan suhu heater jika bahan terlalu basah", category: "SUHU" },

    // --- KECEPATAN EXTRUDER ---
    { key: "extruder_rpm_normal", value: "150", unit: "RPM", description: "Kecepatan extruder standar (bahan kering)", category: "EXTRUDER" },
    { key: "extruder_rpm_bahan_basah", value: "100", unit: "RPM", description: "Kecepatan extruder saat bahan basah (diperlambat)", category: "EXTRUDER" },
    { key: "extruder_rpm_bahan_lembap", value: "130", unit: "RPM", description: "Kecepatan extruder saat bahan agak lembap", category: "EXTRUDER" },

    // --- KECEPATAN PISAU ---
    { key: "pisau_rpm_diameter_kecil", value: "200", unit: "RPM", description: "Kecepatan pisau untuk diameter < 2mm (benih)", category: "PISAU" },
    { key: "pisau_rpm_diameter_sedang", value: "150", unit: "RPM", description: "Kecepatan pisau untuk diameter 2-3mm (grower)", category: "PISAU" },
    { key: "pisau_rpm_diameter_besar", value: "120", unit: "RPM", description: "Kecepatan pisau untuk diameter 3-4mm (finisher)", category: "PISAU" },
    { key: "pisau_rpm_diameter_xl", value: "80", unit: "RPM", description: "Kecepatan pisau untuk diameter > 4mm (induk)", category: "PISAU" },

    // --- WAKTU MIXING ---
    { key: "mixing_menit_bahan_halus", value: "10", unit: "menit", description: "Waktu mixing untuk bahan bentuk halus", category: "MIXING" },
    { key: "mixing_menit_bahan_sedang", value: "15", unit: "menit", description: "Waktu mixing untuk bahan bentuk sedang", category: "MIXING" },
    { key: "mixing_menit_bahan_kasar", value: "20", unit: "menit", description: "Waktu mixing untuk bahan bentuk kasar", category: "MIXING" },
    { key: "mixing_tambahan_kering_menit", value: "5", unit: "menit", description: "Tambahan waktu mixing jika bahan terlalu kering", category: "MIXING" },

    // --- TARGET KADAR AIR ADONAN ---
    { key: "kadar_air_adonan_target_pct", value: "25", unit: "%", description: "Target kadar air adonan sebelum ekstrusi", category: "KADAR_AIR" },
    { key: "kadar_air_adonan_min_pct", value: "20", unit: "%", description: "Kadar air adonan minimum agar bisa dicetak", category: "KADAR_AIR" },
    { key: "kadar_air_adonan_max_pct", value: "35", unit: "%", description: "Kadar air adonan maksimum (di atas ini pelet lembek)", category: "KADAR_AIR" },

    // --- BATAS BINDER / PATI ---
    { key: "binder_min_pct", value: "10", unit: "%", description: "Persentase minimum bahan pengikat dalam formulasi", category: "BINDER" },
    { key: "pati_min_terapung_pct", value: "15", unit: "%", description: "Persentase minimum bahan berpati untuk pelet terapung", category: "BINDER" },
  ];

  for (const param of ruleParams) {
    await prisma.ruleParameter.upsert({
      where: { key: param.key },
      update: {},
      create: param,
    });
  }

  console.log(`✓ RuleParameters: ${ruleParams.length} parameter`);

  // ============================================================
  // 5. ADMIN USER (kredensial login)
  // Username & password diambil dari env supaya produksi tak memakai
  // nilai hardcode. Fallback dev dipakai kalau env kosong (+ warning).
  // ============================================================
  const adminUsername = process.env.SEED_ADMIN_USERNAME || "pelletq";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin321";
  if (!process.env.SEED_ADMIN_PASSWORD) {
    console.warn(
      "⚠ SEED_ADMIN_PASSWORD belum diset — memakai password default 'admin321'. " +
        "JANGAN dipakai di produksi; set SEED_ADMIN_PASSWORD di .env."
    );
  }
  const adminPasswordHash = await bcrypt.hash(adminPassword, 10);
  await prisma.user.upsert({
    where: { email: "dev@pelletq.local" },
    update: { username: adminUsername, passwordHash: adminPasswordHash },
    create: {
      email: "dev@pelletq.local",
      username: adminUsername,
      passwordHash: adminPasswordHash,
      name: "Developer",
      role: "ADMIN",
    },
  });

  console.log(`✓ User: ${adminUsername} (login username)`);
}

main()
  .then(async () => {
    console.log("\n✅ Seed selesai.");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seed gagal:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
