# PelletQ-AI

## Tentang Project
Sistem produksi pakan ikan lele otomatis berbasis AI untuk PKM-PI UGM.
Website + Backend AI + ESP32 (via MQTT) untuk mengendalikan mesin pelet.

## Tech Stack
- Next.js (App Router) + TypeScript
- PostgreSQL + Prisma 7 (dengan @prisma/adapter-pg)
- Mosquitto MQTT broker
- javascript-lp-solver untuk optimasi formulasi
- Google Gemini API (free tier) untuk saran bahasa manusiawi
- Docker Compose untuk infrastructure

## Arsitektur
1. User input via website → 
2. LP Solver (formulasi bahan optimal sesuai SNI 01-4087-2006) → 
3. Rule-Based AI (parameter mesin: suhu, extruder, pisau, mixing) → 
4. Validasi SNI → 
5. Kirim ke ESP32 via MQTT (mode otomatis) atau tampilkan di dashboard (mode manual)

## File Penting
- prisma/schema.prisma — skema database (sudah dimigrasi)
- prisma/seed.ts — seed data (SNI, bahan baku, rule parameters — sudah dijalankan)
- prisma.config.ts — konfigurasi Prisma 7 (pakai adapter-pg + dotenv)
- docker-compose.yml — PostgreSQL, Mosquitto, Adminer
- src/lib/prisma.ts — Prisma client singleton (BELUM DIBUAT)
- src/lib/lp-solver.ts — LP solver module (BELUM DIBUAT)
- src/lib/sni-validator.ts — validasi SNI (BELUM DIBUAT)
- src/lib/rule-engine.ts — rule-based parameter mesin (BELUM DIBUAT)
- src/app/api/formulation/route.ts — API endpoint utama (BELUM DIBUAT)

## Status
- [x] Docker (Postgres + Mosquitto + Adminer)
- [x] Next.js project init
- [x] Prisma schema + migrasi
- [x] Seed data (SNI, ingredients, rule parameters)
- [ ] Backend: prisma.ts, lp-solver.ts, sni-validator.ts, rule-engine.ts
- [ ] Backend: API route /api/formulation
- [ ] Backend: API MQTT kirim ke ESP32
- [ ] Frontend: form input + dashboard hasil
- [ ] Auth (ditunda)
- [ ] LLM integration Gemini (ditunda)

## Konvensi
- Semua development di WSL2 Ubuntu, bukan Windows
- Auth di-skip dulu, pakai dummy user dev@pelletq.local
- Rule parameters disimpan di DB (tabel rule_parameters), bukan hardcode
- Nutrisi & harga di-snapshot di FormulationIngredient, bukan join langsung
