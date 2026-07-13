// ============================================================
// Spesifikasi OpenAPI 3.0 untuk PelletQ-AI
// Ditulis manual (bukan generated) agar akurat terhadap
// src/app/api/formulation/route.ts. Disajikan via GET /api/docs
// dan dirender oleh halaman /docs (Swagger UI).
// ============================================================

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "PelletQ-AI API",
    version: "1.0.0",
    description:
      "Backend formulasi pakan ikan lele otomatis (PKM-PI UGM). " +
      "Menggabungkan LP Solver (formulasi optimal sesuai SNI 01-4087-2006), " +
      "validasi SNI, dan rule-based AI untuk parameter mesin pelet.",
  },
  servers: [{ url: "http://localhost:3000", description: "Development" }],
  tags: [{ name: "Formulasi", description: "Perhitungan formulasi & parameter mesin" }],
  paths: {
    "/api/formulation": {
      post: {
        tags: ["Formulasi"],
        summary: "Hitung formulasi pakan + parameter mesin",
        description:
          "Menerima data ikan, pelet, dan bahan baku yang tersedia, lalu " +
          "menjalankan LP Solver → validasi SNI → rule engine. Hasil disimpan " +
          "ke database dan dikembalikan beserta peringatan.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FormulationRequest" },
              example: {
                fishSpeciesId: "cmqnpcf0w0000njkkxluc6eke",
                phase: "GROWER",
                umurIkanHari: 45,
                jumlahIkanEkor: 7000,
                bobotRataRataGram: 20,
                jenisPelet: "TERAPUNG",
                diameterPelletMm: 2.5,
                panjangPelet: "SEDANG",
                targetProduksiKgBatch: 5,
                prioritas: "TERMURAH",
                modeOperasi: "MANUAL",
                bahanBaku: [
                  { ingredientId: "cmqnpcf1x0005njkk3c4xyijr", stokKg: 3, hargaPerKg: 15000, kondisiBahan: "KERING", bentukBahan: "HALUS" },
                  { ingredientId: "cmqnpcf220006njkkc21spcjg", stokKg: 3, hargaPerKg: 8000, kondisiBahan: "KERING", bentukBahan: "HALUS" },
                  { ingredientId: "cmqnpcf270007njkkfaqyea2r", stokKg: 5, hargaPerKg: 5000, kondisiBahan: "KERING", bentukBahan: "SEDANG" },
                  { ingredientId: "cmqnpcf2c0008njkki3iz7ssf", stokKg: 5, hargaPerKg: 3000, kondisiBahan: "KERING", bentukBahan: "SEDANG" },
                  { ingredientId: "cmqnpcf2h0009njkkivewf88z", stokKg: 3, hargaPerKg: 7000, kondisiBahan: "KERING", bentukBahan: "HALUS" },
                ],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Formulasi berhasil dihitung & disimpan.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FormulationResponse" },
              },
            },
          },
          "404": {
            description: "Standar SNI tidak ditemukan untuk kombinasi spesies & fase.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
                example: { error: "Standar SNI tidak ditemukan untuk kombinasi spesies dan fase ini." },
              },
            },
          },
          "422": {
            description: "Formulasi tidak layak (infeasible) — bahan tak cukup memenuhi SNI.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    error: { type: "string" },
                    saran: { type: "string" },
                  },
                },
                example: {
                  error: "Formulasi tidak layak (infeasible).",
                  saran: "Bahan baku yang tersedia tidak cukup untuk memenuhi standar SNI. Coba tambahkan bahan berprotein tinggi atau perbesar stok.",
                },
              },
            },
          },
          "500": {
            description: "Kesalahan server (mis. user dev belum di-seed).",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      FishPhase: { type: "string", enum: ["BENIH", "GROWER", "FINISHER", "INDUK"] },
      PelletType: { type: "string", enum: ["TERAPUNG", "TENGGELAM"] },
      PelletLength: { type: "string", enum: ["PENDEK", "SEDANG", "PANJANG"] },
      IngredientCondition: { type: "string", enum: ["KERING", "AGAK_LEMBAP", "BASAH"] },
      IngredientForm: { type: "string", enum: ["HALUS", "SEDANG", "KASAR"] },
      FormulationPriority: { type: "string", enum: ["TERMURAH", "SEIMBANG", "NUTRISI_TINGGI"] },
      OperationMode: { type: "string", enum: ["OTOMATIS", "MANUAL"] },
      PowerSource: { type: "string", enum: ["PLN", "BATERAI", "HYBRID"] },
      SniStatus: { type: "string", enum: ["SESUAI", "BELUM_SESUAI"] },
      WarningSeverity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },

      BahanBakuInput: {
        type: "object",
        required: ["ingredientId", "stokKg", "hargaPerKg", "kondisiBahan"],
        properties: {
          ingredientId: { type: "string", description: "ID bahan baku dari tabel ingredients." },
          stokKg: { type: "number", description: "Stok tersedia (kg) — batas atas penggunaan.", example: 3 },
          hargaPerKg: { type: "number", description: "Harga aktual per kg (Rp).", example: 15000 },
          kondisiBahan: { $ref: "#/components/schemas/IngredientCondition" },
          bentukBahan: {
            allOf: [{ $ref: "#/components/schemas/IngredientForm" }],
            nullable: true,
          },
        },
      },

      FormulationRequest: {
        type: "object",
        required: [
          "fishSpeciesId",
          "phase",
          "umurIkanHari",
          "jumlahIkanEkor",
          "jenisPelet",
          "diameterPelletMm",
          "targetProduksiKgBatch",
          "bahanBaku",
          "prioritas",
          "modeOperasi",
        ],
        properties: {
          fishSpeciesId: { type: "string", description: "ID spesies ikan (tabel fish_species)." },
          phase: { $ref: "#/components/schemas/FishPhase" },
          umurIkanHari: { type: "integer", example: 45 },
          jumlahIkanEkor: { type: "integer", example: 7000 },
          bobotRataRataGram: { type: "number", nullable: true, example: 20 },
          jenisPelet: { $ref: "#/components/schemas/PelletType" },
          diameterPelletMm: { type: "number", example: 2.5 },
          panjangPelet: {
            allOf: [{ $ref: "#/components/schemas/PelletLength" }],
            nullable: true,
          },
          teksturTarget: { type: "string", nullable: true },
          targetProduksiKgBatch: { type: "number", example: 5 },
          prioritas: { $ref: "#/components/schemas/FormulationPriority" },
          modeOperasi: { $ref: "#/components/schemas/OperationMode" },
          sumberDaya: {
            allOf: [{ $ref: "#/components/schemas/PowerSource" }],
            nullable: true,
          },
          bahanBaku: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/BahanBakuInput" },
          },
        },
      },

      EstimasiNutrisi: {
        type: "object",
        properties: {
          proteinPct: { type: "number" },
          lemakPct: { type: "number" },
          seratKasarPct: { type: "number" },
          abuPct: { type: "number" },
          kadarAirPct: { type: "number" },
        },
      },

      FormulasiIngredient: {
        type: "object",
        properties: {
          ingredientId: { type: "string" },
          name: { type: "string" },
          jumlahKg: { type: "number" },
          persentase: { type: "number" },
          hargaPerKg: { type: "number" },
          kondisiBahan: { $ref: "#/components/schemas/IngredientCondition" },
          bentukBahan: {
            allOf: [{ $ref: "#/components/schemas/IngredientForm" }],
            nullable: true,
          },
        },
      },

      ValidationItem: {
        type: "object",
        properties: {
          parameter: { type: "string", example: "Protein" },
          nilai: { type: "number", example: 28.01 },
          batasSni: { type: "string", example: "min 28%" },
          status: { $ref: "#/components/schemas/SniStatus" },
        },
      },

      ParameterMesin: {
        type: "object",
        properties: {
          suhuHeaterCelcius: { type: "number" },
          kecepatanExtruderRpm: { type: "number" },
          kecepatanPisauRpm: { type: "number" },
          waktuMixingMenit: { type: "number" },
          targetKadarAirAdonanPct: { type: "number" },
          estimasiAirTambahanMl: { type: "number" },
          urutanProses: { type: "array", items: { type: "string" } },
        },
      },

      Peringatan: {
        type: "object",
        properties: {
          jenis: { type: "string", example: "BINDER_RENDAH" },
          severity: { $ref: "#/components/schemas/WarningSeverity" },
          rekomendasi: { type: "string" },
        },
      },

      FormulationResponse: {
        type: "object",
        properties: {
          formulationId: { type: "string" },
          formulasi: {
            type: "object",
            properties: {
              ingredients: {
                type: "array",
                items: { $ref: "#/components/schemas/FormulasiIngredient" },
              },
              totalBiayaRp: { type: "number" },
              estimasiNutrisi: { $ref: "#/components/schemas/EstimasiNutrisi" },
            },
          },
          validasiSni: {
            type: "object",
            properties: {
              statusKeseluruhan: { $ref: "#/components/schemas/SniStatus" },
              items: {
                type: "array",
                items: { $ref: "#/components/schemas/ValidationItem" },
              },
            },
          },
          parameterMesin: { $ref: "#/components/schemas/ParameterMesin" },
          peringatan: {
            type: "array",
            items: { $ref: "#/components/schemas/Peringatan" },
          },
        },
      },

      ErrorResponse: {
        type: "object",
        properties: { error: { type: "string" } },
      },
    },
  },
} as const;
