# PelletQ-AI — Firmware (ESP32)

Firmware ESP32 untuk mesin pelet PelletQ-AI. ESP32 = controller monitoring suhu +
gerbang hopper (1 servo), berkomunikasi dengan backend lewat **MQTT (Mosquitto)**.
ESP32 **tidak** mengontrol motor apa pun (motor pakai penggerak bensin).

## Isi folder

| Folder | Isi |
|---|---|
| `pelletq_esp32/` | **Firmware utama** — state machine, TFT ILI9488, servo, MAX6675, MQTT penuh. Lihat `pelletq_esp32/README.md`. |
| `mqtt_test/` | **Sketch uji koneksi** — hanya WiFi + MQTT, tanpa hardware lain. Untuk memastikan jalur jaringan sehat sebelum menjalankan firmware utama. |

Tiap folder adalah sketch PlatformIO/Arduino tersendiri (nama folder == nama `.ino`).

---

## Topologi jaringan: DEV vs PRODUKSI

Ini bagian terpenting — nilai `MQTT_BROKER` di sketch berbeda tergantung di mana
broker berjalan.

### Produksi (target sebenarnya) — Ubuntu Linux server

Deploy final berjalan di **server Ubuntu Linux**, bukan WSL. Di sini TIDAK ADA
kerumitan jaringan:

- Mosquitto jalan di server Ubuntu (via `docker compose up -d mosquitto`), listener
  `1883`, `allow_anonymous true` (lihat `../mosquitto/config/mosquitto.conf`).
- ESP32 diberi `MQTT_BROKER` = **IP LAN server Ubuntu** (mis. `192.168.1.50`).
- ESP32 dan server berada di jaringan yang sama → konek langsung. Tanpa portproxy,
  tanpa NAT, tanpa firewall khusus (selama port 1883 terbuka di server).
- Pastikan container mem-bind ke semua interface (`0.0.0.0:1883`, sudah default di
  `docker-compose.yml`) sehingga bisa diakses dari LAN.

**Untuk produksi, developing dan testing di WSL sudah paritas dengan server** karena
sama-sama Linux + Docker + Mosquitto. Tidak perlu memindahkan stack ke Windows.

### Dev lokal — broker di WSL2

Saat mengembangkan di laptop, broker jalan di Docker **di dalam WSL2**. WSL2 di-NAT
di belakang Windows, jadi perangkat LAN (ESP32) tidak otomatis bisa menembus ke WSL2.
Ini artefak dev lokal saja — **tidak ada di produksi**.

Butuh port-proxy satu kali di **Admin PowerShell (Windows)**:

```powershell
# forward Windows :1883  ->  Mosquitto di WSL2
# ganti <IP_WSL> dengan hasil `hostname -I` di WSL (BERUBAH tiap WSL restart!)
netsh interface portproxy add v4tov4 listenport=1883 listenaddress=0.0.0.0 connectport=1883 connectaddress=<IP_WSL>
netsh advfirewall firewall add rule name="MQTT 1883" dir=in action=allow protocol=TCP localport=1883
```

Lalu `MQTT_BROKER` di sketch = **IP LAN Wi-Fi Windows** (bukan IP WSL, bukan
`localhost`). Cek dengan `ipconfig` di Windows → adapter Wi-Fi.

Cek/hapus proxy: `netsh interface portproxy show all`.

> ⚠️ IP WSL2 berubah tiap restart WSL. Jika ESP32 tiba-tiba gagal konek setelah
> reboot, jalankan ulang baris `portproxy` dengan IP WSL yang baru.

---

## Alur pengembangan yang disarankan

Stack web/backend (Next.js, Prisma, Postgres, Mosquitto) tetap di **WSL/Linux** —
paritas dengan server produksi. Untuk firmware:

- **Flash board dari Windows VS Code + PlatformIO IDE.** WSL tidak melihat port USB
  ESP32 tanpa `usbipd-win`; native Windows melihat COM port otomatis (`→ Upload`
  langsung jalan).
- Sketch kecil (`mqtt_test/`) bisa dibuka langsung dari `\\wsl$\...`. Firmware besar
  (`pelletq_esp32/`) sebaiknya di-copy ke path native Windows (`C:\dev\...`) karena
  PlatformIO lambat di path `\\wsl$`.
- Broker + `mosquitto_sub`/`mosquitto_pub` tetap dijalankan di WSL/server Linux.

Ringkas:

| Bagian | Lokasi | Alasan |
|---|---|---|
| Web / DB / broker | WSL (dev), Ubuntu server (prod) | Paritas Linux, konvensi proyek |
| Flash firmware | Windows VS Code + PlatformIO | Port USB/COM langsung terlihat |

---

## Uji koneksi cepat (sebelum firmware utama)

1. Nyalakan broker: `docker compose up -d mosquitto` (di WSL/server).
2. Isi kredensial di `mqtt_test/mqtt_test.ino` (`WIFI_SSID`, `MQTT_BROKER`, dst).
   - Prod: IP LAN server Ubuntu. Dev: IP Wi-Fi Windows (+ portproxy di atas).
3. Flash `mqtt_test/` dari Windows VS Code (PlatformIO → Upload), buka Serial Monitor.
   Sehat = `[mqtt] CONNECTED` + LED onboard nyala tetap.
4. Pantau dari sisi broker:

```bash
mosquitto_sub -h localhost -t 'pelletq/test/#' -v          # lihat status + heartbeat
mosquitto_pub  -h localhost -t pelletq/test/cmd -m 'hello'  # ESP echo ke serial + LED
```

Jika serial menunjukkan `rc=-2` → ESP tidak bisa mencapai broker (IP salah, atau
portproxy/firewall belum diset, atau Wi-Fi mengisolasi antar-perangkat). `rc=5` =
ditolak auth (tidak terjadi di sini karena `allow_anonymous true`).

Setelah `mqtt_test` sukses, lanjut ke firmware utama di `pelletq_esp32/`.

---

## Library (kedua sketch)

Dikelola otomatis oleh `platformio.ini` di tiap folder:

- `knolleary/PubSubClient` (MQTT) — dipakai keduanya
- `bodmer/TFT_eSPI`, `madhephaestus/ESP32Servo`, `bblanchon/ArduinoJson` — hanya
  firmware utama

Board: `esp32dev` (ESP32 DevKit). Serial monitor `115200`.
