# PelletQ-AI

Sistem produksi pakan ikan lele otomatis berbasis AI untuk PKM-PI UGM.
Website, backend AI, dan ESP32 via MQTT mengendalikan mesin pelet.

Alur: input website -> LP Solver -> Rule-Based AI -> validasi SNI -> kirim ke
ESP32 via MQTT atau tampilkan di dashboard.

## Arsitektur

PelletQ-AI adalah satu proyek Next.js (App Router):

- Frontend: halaman dan komponen React di src/app dan src/components.
- Backend: API routes di src/app/api/* dan logika inti di src/lib.
- Infrastruktur: PostgreSQL, Mosquitto, Adminer, aplikasi Next.js, dan
  cloudflared dikelola dengan Docker Compose.

## Prasyarat

- Node.js >= 22.13 (dites di v24); versi pnpm proyek mensyaratkan ini.
- pnpm, Docker, dan Docker Compose.
- Development dilakukan di WSL2 Ubuntu.

## Setup lokal

1. Install dependency:

    ```bash
    pnpm install
    ```

2. Buat .env di root proyek. Lihat .env.example untuk semua variabel.

    ```bash
    POSTGRES_PASSWORD="pelletq_dev_password"
    DATABASE_URL="postgresql://pelletq:pelletq_dev_password@localhost:5432/pelletq?schema=public"
    MQTT_BROKER_URL="mqtt://localhost:1883"
    AUTH_SECRET="isi-dengan-hasil-openssl-rand-base64-32"
    AUTH_TRUST_HOST="true"
    SEED_ADMIN_USERNAME="pelletq"
    SEED_ADMIN_PASSWORD="admin321"
    ```

3. Nyalakan infrastruktur lokal:

    ```bash
    docker compose up -d postgres mosquitto adminer
    ```

4. Migrasikan dan seed database:

    ```bash
    pnpm prisma migrate dev
    pnpm prisma db seed
    ```

5. Jalankan aplikasi:

    ```bash
    pnpm dev
    ```

Buka http://localhost:3000. Login dev default adalah pelletq / admin321.

Karena backend berupa API routes di dalam proyek yang sama, endpoint langsung
aktif di server yang sama, contohnya:

- POST /api/formulation - endpoint utama (formulasi + parameter mesin)
- GET/POST /api/ingredients dan /api/user-ingredients - manajemen bahan
- GET /api/options - opsi form
- GET /api/docs dan halaman /docs - dokumentasi API (OpenAPI)

## Deploy ke Server Sendiri (VPS)

Aplikasi produksi berjalan melalui Docker Compose: Postgres, Mosquitto, Adminer,
Next.js, dan cloudflared. Server ini boleh berada di belakang CGNAT / tanpa IP
publik — tidak ada port yang perlu di-forward di router. cloudflared membuka
koneksi keluar ke Cloudflare Tunnel dan meneruskan trafik dari dua public
hostname (nilai APP_DOMAIN dan MQTT_DOMAIN, dikonfigurasi di dashboard
Cloudflare, bukan di .env) ke app:3000 dan mosquitto:9001 lewat jaringan Docker
internal. Cloudflare menangani TLS di edge (sertifikat publik dari CA yang
umum dipercaya) — tidak ada sertifikat yang perlu dikelola atau diperbarui di
server.

### 1. Setup server (sekali saja)

1. Clone repository ke server, misalnya /opt/pelletq.
2. Buat .env mengikuti checklist .env.example. Isi POSTGRES_PASSWORD,
   AUTH_SECRET, SEED_ADMIN_PASSWORD, MQTT_USERNAME, MQTT_PASSWORD, dan
   TUNNEL_TOKEN (didapat di langkah 4) dengan nilai produksi.
3. Buat password file Mosquitto:

    ```bash
    docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
      mosquitto_passwd -c /mosquitto/config/passwd <username>
    chmod 644 mosquitto/config/passwd
    ```

4. Buat tunnel di dashboard Cloudflare Zero Trust: Networks -> Tunnels ->
   Create a tunnel. Salin token yang diberikan ke TUNNEL_TOKEN di .env.
   Domain harus sudah dikelola nameserver Cloudflare — Cloudflare otomatis
   membuat DNS record yang dibutuhkan saat public hostname ditambahkan,
   tidak perlu bikin A record manual.
5. Tambahkan dua public hostname pada tunnel yang sama:

    | Public hostname | Service |
    |---|---|
    | domain app (nilai APP_DOMAIN, mis. app.pelletqai.com) | http://app:3000 |
    | domain MQTT (nilai MQTT_DOMAIN, mis. mqtt.pelletqai.com) | http://mosquitto:9001 |

6. Nyalakan stack:

    ```bash
    docker compose up -d
    ```

7. Migrasikan dan seed database:

    ```bash
    docker compose run --rm migrate migrate deploy
    docker compose run --rm migrate db seed
    ```

### 2. Deploy perubahan berikutnya

    ./scripts/deploy.sh

Script menjalankan git pull, build ulang image aplikasi, memperbarui stack, dan
menerapkan migrasi Prisma.

### Checklist keamanan

- [ ] SEED_ADMIN_PASSWORD diganti dari admin321.
- [ ] AUTH_SECRET baru, rahasia, dan tidak di-commit.
- [ ] POSTGRES_PASSWORD diganti dari pelletq_dev_password.
- [ ] MQTT_USERNAME/MQTT_PASSWORD diganti dari kredensial dev.
- [ ] TUNNEL_TOKEN rahasia dan tidak di-commit.
- [ ] Tidak ada port yang dibuka manual di firewall/router — cloudflared
      cuma membuat koneksi keluar ke Cloudflare. Postgres, MQTT plain,
      WebSocket MQTT, dan Adminer tetap loopback-only di docker-compose.yml.

### Verifikasi setelah deploy pertama

- [ ] https://<APP_DOMAIN>/login dapat diakses dari luar.
- [ ] docker compose logs cloudflared menunjukkan tunnel connected, tanpa
      error mengenai public hostname.
- [ ] ESP32 (atau client MQTT WebSocket lain) dapat connect ke
      wss://<MQTT_DOMAIN> dan publish/subscribe topik pelletq/*.
- [ ] Dari luar server, port 5432, 1883, 9001, dan 8081 gagal diakses
      langsung — hanya lewat tunnel yang bisa dijangkau.

## Perintah berguna

| Perintah | Fungsi |
|---|---|
| pnpm dev | Jalankan frontend dan backend mode development. |
| pnpm build | Build produksi. |
| pnpm lint | Jalankan ESLint. |
| pnpm prisma studio | GUI Prisma. |
| docker compose up -d | Nyalakan stack container. |
| docker compose down | Matikan stack (data tetap tersimpan). |
| docker compose down -v | Matikan stack dan hapus volume data. |

## Troubleshooting

- Tidak dapat mencapai Postgres: jalankan docker compose up -d postgres dan
  tunggu status healthy.
- DATABASE_URL undefined: buat .env di root proyek.
- Port bentrok: periksa service lokal yang memakai port tersebut.
- Tabel kosong: jalankan ulang migrasi dan seed.
- Public hostname tidak bisa diakses dari luar: cek
  docker compose logs cloudflared — pastikan TUNNEL_TOKEN benar dan kedua
  public hostname di dashboard Cloudflare mengarah ke service yang tepat
  (http://app:3000 dan http://mosquitto:9001).

## Tech Stack

Next.js 16, TypeScript, PostgreSQL, Prisma 7, Mosquitto MQTT,
javascript-lp-solver, Docker Compose, dan Cloudflare Tunnel.
