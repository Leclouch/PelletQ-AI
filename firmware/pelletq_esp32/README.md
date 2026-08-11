# PelletQ-AI — ESP32 Hopper Gate Controller

Dokumentasi ini menjelaskan koneksi controller ESP32 PelletQ-AI ke broker MQTT.
Controller produksi yang dipulihkan berada di `firmware/pelletq_esp32`; ia
memakai `esp-mqtt` dari ESP-IDF, bukan `PubSubClient`, dan terhubung melalui
transport MQTT-over-WebSocket.

## Transport MQTT-over-WebSocket

`mosquitto/config/mosquitto.conf` mendeklarasikan `listener 9001` dengan
`protocol websockets`. Karena listener tersebut adalah MQTT-over-WebSocket
murni, bentuk URI lokal yang diharapkan adalah:

```text
ws://<host>:9001
```

Jangan tambahkan path aplikasi seperti `/mqtt`. Endpoint itu masih **belum
terverifikasi pada runtime** di workspace ini: Docker daemon tidak dapat diakses
dan tidak ada klien MQTT-over-WebSocket yang tersedia. Jalankan prosedur
validasi berikut setelah broker, password file, dan klien tersedia; baru gunakan
URI tersebut pada perangkat.

### Validasi lokal yang dapat diulang

Pastikan service Mosquitto sudah berjalan, lalu gunakan MQTTX CLI (atau klien
MQTT-over-WebSocket lain yang ekuivalen) dari dua terminal PowerShell. Ganti
nilai placeholder dengan kredensial dari password file Mosquitto.

Terminal 1 (subscriber):

```powershell
mqttx sub -h 127.0.0.1 -p 9001 -l ws --path / -t pelletq/test/transport -u <username> -P <password> -v
```

Terminal 2 (publisher):

```powershell
mqttx pub -h 127.0.0.1 -p 9001 -l ws --path / -t pelletq/test/transport -m websocket-ok -u <username> -P <password>
```

Validasi berhasil bila Terminal 1 menerima payload `websocket-ok` pada
`pelletq/test/transport`. Bila URI endpoint dapat dikonfigurasi sebagai satu
nilai oleh klien, gunakan `ws://127.0.0.1:9001` tanpa path.

## Target WebSocket TLS produksi (masih ditunda)

Simpan kredensial WiFi dan MQTT di `secrets.h` yang tidak di-commit. Untuk
target produksi, ESP32 akan menggunakan WebSocket aman pada domain TLS:

```cpp
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_URI       "wss://mqtt.<domain>"
#define MQTT_USERNAME  "GANTI_USERNAME"
#define MQTT_PASSWORD  "GANTI_PASSWORD"
```

Jangan gunakan IP publik untuk `MQTT_URI`: sertifikat TLS akan diterbitkan untuk
domain MQTT, sehingga host di URI harus tepat sama dengan domain tersebut.
Gunakan default ESP-IDF certificate bundle untuk memvalidasi sertifikat publik
(misalnya melalui `esp_crt_bundle_attach` pada konfigurasi transport TLS).
Jangan menyalin atau mem-pin sertifikat ke `ca_cert.h`.

Konfigurasi repository saat ini **belum** menyediakan endpoint tersebut:
Mosquitto mengekspos listener TLS MQTT mentah pada port 8883, sedangkan Caddy
hanya merespons HTTP pada `MQTT_DOMAIN`. Belum ada Cloudflare Tunnel atau proxy
WebSocket yang meneruskan `wss://mqtt.<domain>` ke listener 9001. Dengan
demikian, `wss://mqtt.<domain>` di atas adalah konfigurasi koneksi akhir yang
diinginkan, bukan endpoint yang sudah live. Setelah tunnel/proxy WebSocket
diaktifkan dan diverifikasi, ESP32 di jaringan lain harus memakai endpoint itu;
listener 1883 dan WebSocket 9001 tetap localhost-only.

## Menyiapkan broker

1. Buat password file Mosquitto di server sebelum menjalankan broker:

   ```bash
   docker run --rm -it -v "$PWD/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2 \
     mosquitto_passwd -c /mosquitto/config/passwd <username>
   ```

2. Pastikan file tersebut dapat dibaca pengguna Mosquitto dalam container. Bila perlu:

   ```bash
   chmod 644 mosquitto/config/passwd
   ```

3. Setelah Caddy mengeluarkan sertifikat untuk `MQTT_DOMAIN`, jalankan:

   ```bash
   MQTT_DOMAIN=<domain-broker> ./scripts/sync-mqtt-cert.sh
   ```

4. Setelah tunnel/proxy WebSocket produksi tersedia, konfigurasikan ESP32
   dengan domain, kredensial, dan transport `wss://` di atas. Uji koneksi
   broker dari jaringan luar sebelum menyalakan mesin pelet.

## Topik MQTT

| Topic | Arah | Keterangan |
|---|---|---|
| `pelletq/telemetry` | ESP → server | Telemetri mesin |
| `pelletq/command` | server → ESP | Perintah operasi |
| `pelletq/config` | server → ESP | Konfigurasi retained |
| `pelletq/config/ack` | ESP → server | Konfirmasi konfigurasi |
| `pelletq/event` | ESP → server | Event mesin |
| `pelletq/status` | ESP → server | Status LWT retained |

## Checklist validasi yang ditunda

- [ ] Jalankan pub/sub `ws://<host>:9001` di atas terhadap listener lokal dan
  catat bahwa payload diterima tanpa path aplikasi pada URI.
- [ ] Buat Cloudflare Tunnel atau proxy WebSocket yang meneruskan
  `wss://mqtt.<domain>` ke listener 9001, lalu verifikasi sertifikat publik
  dan autentikasi Mosquitto. Listener 8883 saat ini adalah MQTT TLS mentah,
  bukan target WebSocket TLS ini.
- [ ] Flash `firmware/pelletq_esp32` ke hardware ESP32 nyata, konfirmasi koneksi,
  LWT retained, heartbeat, subscription command, dan reconnect Wi-Fi/MQTT.
