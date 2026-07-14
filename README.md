# PelletQ-AI

Sistem produksi pakan ikan lele otomatis berbasis AI untuk PKM-PI UGM.
Website + Backend AI + ESP32 (via MQTT) untuk mengendalikan mesin pelet.

Alur singkat: **input di website → LP Solver (formulasi optimal SNI 01-4087-2006) → Rule-Based AI (parameter mesin) → validasi SNI → kirim ke ESP32 via MQTT / tampil di dashboard.**

## Arsitektur

Aplikasi ini adalah **satu proyek Next.js (App Router)** — frontend dan backend berjalan dalam satu proses:

- **Frontend** — halaman & komponen React di `src/app` dan `src/components`.
- **Backend** — API routes di `src/app/api/*` (bukan server terpisah). Logika inti ada di `src/lib` (`lp-solver.ts`, `sni-validator.ts`, `rule-engine.ts`, `prisma.ts`).
- **Infrastruktur** — PostgreSQL, Mosquitto (MQTT), dan Adminer dijalankan lewat Docker Compose.

Jadi menjalankan `pnpm dev` sudah menjalankan frontend **dan** backend sekaligus. Yang perlu berjalan terpisah hanya database + MQTT (via Docker).

## Prasyarat

- **Node.js** ≥ 20 (dites di v24)
- **pnpm** (package manager proyek — ada `pnpm-lock.yaml`)
- **Docker** + **Docker Compose** (untuk PostgreSQL & Mosquitto)
- Semua development dilakukan di **WSL2 Ubuntu**, bukan Windows

> Belum punya pnpm? `npm install -g pnpm`

## Setup Awal (sekali saja)

### 1. Install dependencies

```bash
pnpm install
```

### 2. Buat file `.env`

File `.env` tidak ikut di-commit (masuk `.gitignore`). Buat di root proyek dengan isi berikut:

```env
# Database
DATABASE_URL="postgresql://pelletq:pelletq_dev_password@localhost:5432/pelletq?schema=public"

# MQTT
MQTT_BROKER_URL="mqtt://localhost:1883"

# Gemini API (opsional, diisi nanti)
GEMINI_API_KEY=""

# Auth.js — generate dengan: openssl rand -base64 32
AUTH_SECRET="isi-dengan-hasil-generate"
AUTH_TRUST_HOST="true"

# Kredensial admin awal (dipakai `pnpm prisma db seed`)
SEED_ADMIN_USERNAME="pelletq"
SEED_ADMIN_PASSWORD="admin321"
```

Referensi lengkap ada di `.env.example`. Kredensial database di atas cocok dengan `docker-compose.yml`, jadi tidak perlu diubah untuk development lokal. Login default dev: **`pelletq` / `admin321`**.

## Menjalankan

### 1. Nyalakan database & MQTT (Docker)

```bash
docker compose up -d
```

Ini menjalankan tiga service:

| Service    | Container            | Port(s)                     | Fungsi                          |
|------------|----------------------|-----------------------------|---------------------------------|
| PostgreSQL | `pelletq-postgres`   | `5432`                      | Database utama                  |
| Mosquitto  | `pelletq-mosquitto`  | `1883` (MQTT), `9001` (WS)  | Broker MQTT ke ESP32            |
| Adminer    | `pelletq-adminer`    | `8081`                      | GUI database di http://localhost:8081 |

Cek statusnya: `docker compose ps` (tunggu Postgres `healthy`).

### 2. Siapkan skema & seed database

Migrasi membuat semua tabel, seed mengisi data SNI, bahan baku, dan rule parameters.

```bash
pnpm prisma migrate dev     # jalankan/apply migrasi
pnpm prisma db seed         # isi data awal (SNI, ingredients, rule params)
```

> Kalau database sudah pernah dimigrasi & di-seed, langkah ini bisa dilewati.

### 3. Jalankan aplikasi (frontend + backend)

```bash
pnpm dev
```

Buka **http://localhost:3000**.

Karena backend berupa API routes di dalam proyek yang sama, endpoint langsung aktif di server yang sama, contohnya:

- `POST /api/formulation` — endpoint utama (formulasi + parameter mesin)
- `GET/POST /api/ingredients` & `/api/user-ingredients` — manajemen bahan
- `GET /api/options` — opsi form
- `GET /api/docs` + halaman **/docs** — dokumentasi API (OpenAPI)

## Deploy (Self-Host)

Untuk menjalankan di server sendiri (bukan `pnpm dev`). Aplikasi wajib diakses lewat **HTTPS** — Auth.js memakai cookie sesi `Secure`, jadi di atas `http://` polos login akan tampak berhasil tapi balik lagi ke `/login`.

### 1. Environment produksi

Set env berikut di server (jangan commit `.env`):

| Variabel | Wajib | Catatan |
|----------|:-----:|---------|
| `DATABASE_URL` | ✅ | Ganti `pelletq_dev_password` dengan password DB produksi. |
| `AUTH_SECRET` | ✅ | Secret baru & acak: `openssl rand -base64 32`. Jangan pakai punya dev. |
| `AUTH_TRUST_HOST` | ✅ | `"true"` — wajib saat di belakang reverse proxy (Nginx/Caddy). Tanpa ini login/redirect rusak. |
| `SEED_ADMIN_USERNAME` | ✅ | Username admin awal. |
| `SEED_ADMIN_PASSWORD` | ✅ | Password admin **kuat**. Kalau kosong, seed memakai `admin321` (hanya dev) dan menampilkan peringatan. |
| `MQTT_BROKER_URL` | – | Sesuaikan bila broker MQTT terpisah. |

### 2. Build & siapkan database

```bash
pnpm install --frozen-lockfile
pnpm prisma migrate deploy      # apply migrasi (BUKAN `migrate dev` di produksi)
pnpm prisma db seed             # buat user admin dari SEED_ADMIN_* di atas
pnpm build
```

### 3. Jalankan

```bash
pnpm start                      # Next.js production server (port 3000)
```

Taruh di belakang reverse proxy ber-TLS (Nginx/Caddy) yang meneruskan ke `localhost:3000`.

### Checklist keamanan

- [ ] `SEED_ADMIN_PASSWORD` diganti dari default `admin321`.
- [ ] `AUTH_SECRET` baru & rahasia (tidak sama dengan dev, tidak di-commit).
- [ ] `AUTH_TRUST_HOST="true"` + akses lewat HTTPS.
- [ ] Password `DATABASE_URL` bukan `pelletq_dev_password`.
- [ ] (Opsional) rate-limit endpoint login, hapus halaman `/test` bila tak dipakai.

## Perintah Berguna

| Perintah                     | Fungsi                                              |
|------------------------------|-----------------------------------------------------|
| `pnpm dev`                   | Jalankan frontend + backend (mode development)      |
| `pnpm build`                 | Build produksi                                      |
| `pnpm start`                 | Jalankan hasil build produksi                       |
| `pnpm lint`                  | ESLint                                              |
| `pnpm prisma studio`         | GUI Prisma untuk lihat/edit data                    |
| `pnpm prisma migrate dev`    | Buat/apply migrasi                                  |
| `pnpm prisma db seed`        | Seed data awal                                      |
| `docker compose up -d`       | Nyalakan Postgres + Mosquitto + Adminer             |
| `docker compose down`        | Matikan semua container (data tetap tersimpan)      |
| `docker compose down -v`     | Matikan + hapus volume (⚠️ menghapus data database) |

## Troubleshooting

- **`Can't reach database server at localhost:5432`** — Docker belum jalan. Jalankan `docker compose up -d` dan tunggu Postgres `healthy` (`docker compose ps`).
- **Error `DATABASE_URL` undefined** — file `.env` belum dibuat atau salah lokasi (harus di root proyek). Prisma memuatnya via `prisma.config.ts` + `dotenv`.
- **Port 5432/3000/8081 bentrok** — matikan service lain yang memakai port tersebut, atau ubah mapping port di `docker-compose.yml`.
- **Tabel kosong / data SNI tidak ada** — jalankan ulang `pnpm prisma db seed`.

## Tech Stack

Next.js 16 (App Router) + TypeScript · PostgreSQL + Prisma 7 (`@prisma/adapter-pg`) · Mosquitto MQTT · `javascript-lp-solver` · Google Gemini API (ditunda) · Docker Compose.
