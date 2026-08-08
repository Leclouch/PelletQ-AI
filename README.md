# PelletQ-AI

Sistem produksi pakan ikan lele otomatis berbasis AI untuk PKM-PI UGM.
Website, backend AI, dan ESP32 via MQTT mengendalikan mesin pelet.

Alur: input website -> LP Solver -> Rule-Based AI -> validasi SNI -> kirim ke
ESP32 via MQTT atau tampilkan di dashboard.

## Arsitektur

PelletQ-AI adalah satu proyek Next.js (App Router):

- Frontend: halaman dan komponen React di src/app dan src/components.
- Backend: API routes di src/app/api/* dan logika inti di src/lib.
- Infrastruktur: PostgreSQL, Mosquitto, Adminer, aplikasi Next.js, dan Caddy
  dikelola dengan Docker Compose.

## Prasyarat

- Node.js >= 22.13 (dites di v24); versi pnpm proyek mensyaratkan ini.
- pnpm, Docker, dan Docker Compose.
- Development dilakukan di WSL2 Ubuntu.

## Setup lokal

1. Install dependency:

    pnpm install

2. Buat .env di root proyek. Lihat .env.example untuk semua variabel.

    POSTGRES_PASSWORD="pelletq_dev_password"
    DATABASE_URL="postgresql://pelletq:pelletq_dev_password@localhost:5432/pelletq?schema=public"
    MQTT_BROKER_URL="mqtt://localhost:1883"
    AUTH_SECRET="isi-dengan-hasil-openssl-rand-base64-32"
    AUTH_TRUST_HOST="true"
    SEED_ADMIN_USERNAME="pelletq"
    SEED_ADMIN_PASSWORD="admin321"

3. Nyalakan infrastruktur lokal:

    docker compose up -d postgres mosquitto adminer

4. Migrasikan dan seed database:

    pnpm prisma migrate dev
    pnpm prisma db seed

5. Jalankan aplikasi:

    pnpm dev

Buka http://localhost:3000. Login dev default adalah pelletq / admin321.

## Deploy ke Server Sendiri (VPS)

Aplikasi produksi berjalan melalui Docker Compose: Postgres, Mosquitto, Adminer,
Next.js, dan Caddy. Caddy menjadi reverse proxy serta TLS terminator. Caddy
menerbitkan sertifikat Let's Encrypt untuk APP_DOMAIN dan MQTT_DOMAIN; script
scripts/sync-mqtt-cert.sh menyalin sertifikat MQTT ke Mosquitto.

### 1. Setup server (sekali saja)

1. Clone repository ke server, misalnya /opt/pelletq.
2. Buat .env mengikuti checklist .env.example. Isi POSTGRES_PASSWORD,
   AUTH_SECRET, SEED_ADMIN_PASSWORD, MQTT_USERNAME, MQTT_PASSWORD, APP_DOMAIN,
   dan MQTT_DOMAIN dengan nilai produksi.
3. Arahkan DNS A record APP_DOMAIN dan MQTT_DOMAIN ke IP server.
4. Buka firewall:

    sudo ufw allow 80,443,8883/tcp

5. Buat password file Mosquitto:

    docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
      mosquitto_passwd -c /mosquitto/config/passwd <username>
    chmod 644 mosquitto/config/passwd

6. Nyalakan stack:

    docker compose up -d

7. Migrasikan dan seed database:

    docker compose run --rm migrate migrate deploy
    docker compose run --rm migrate db seed

8. Setelah Caddy memperoleh sertifikat, salin sertifikat broker ke Mosquitto:

    MQTT_DOMAIN=<nilai-MQTT_DOMAIN> ./scripts/sync-mqtt-cert.sh

9. Jadwalkan sinkronisasi sertifikat MQTT setiap hari (crontab -e):

    0 3 * * * cd /opt/pelletq && MQTT_DOMAIN=<nilai-MQTT_DOMAIN> ./scripts/sync-mqtt-cert.sh >> /var/log/pelletq-cert-sync.log 2>&1

### 2. Deploy perubahan berikutnya

    ./scripts/deploy.sh

Script menjalankan git pull, build ulang image aplikasi, memperbarui stack, dan
menerapkan migrasi Prisma.

### Checklist keamanan

- [ ] SEED_ADMIN_PASSWORD diganti dari admin321.
- [ ] AUTH_SECRET baru, rahasia, dan tidak di-commit.
- [ ] POSTGRES_PASSWORD diganti dari pelletq_dev_password.
- [ ] MQTT_USERNAME/MQTT_PASSWORD diganti dari kredensial dev.
- [ ] DNS APP_DOMAIN dan MQTT_DOMAIN menunjuk ke server sebelum docker compose up -d.
- [ ] Firewall hanya membuka 80, 443, dan 8883. Postgres, MQTT plain,
      WebSocket MQTT, dan Adminer tetap loopback-only.

### Verifikasi setelah deploy pertama

- [ ] https://<APP_DOMAIN>/login dapat diakses dari luar dengan sertifikat valid.
- [ ] openssl s_client -connect <MQTT_DOMAIN>:8883 dari mesin lain menunjukkan
      sertifikat valid untuk MQTT_DOMAIN.
- [ ] Dari luar server, port 5432, 1883, 9001, dan 8081 gagal diakses.
- [ ] Bench test ESP32 asli terhadap MQTT_DOMAIN:8883 selesai dilakukan.

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

## Tech Stack

Next.js 16, TypeScript, PostgreSQL, Prisma 7, Mosquitto MQTT,
javascript-lp-solver, Docker Compose, dan Caddy.
