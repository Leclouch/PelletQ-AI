# PelletQ-AI — ESP32 Hopper Gate Controller

Dokumentasi ini menjelaskan koneksi ESP32 ke broker MQTT produksi PelletQ-AI.
Source firmware yang sebelumnya digunakan tidak dipulihkan dalam perubahan deployment
ini; gunakan repository firmware yang dikelola untuk board yang akan dipasang.

## Kredensial produksi

Simpan kredensial WiFi dan MQTT di `secrets.h` yang tidak di-commit. Untuk broker
produksi, gunakan domain TLS dan kredensial yang sama dengan `.env` di server:

```cpp
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_BROKER    "mqtt.yourdomain.com"
#define MQTT_PORT      8883
#define MQTT_USERNAME  "GANTI_USERNAME"
#define MQTT_PASSWORD  "GANTI_PASSWORD"
```

Jangan gunakan IP publik untuk `MQTT_BROKER`: sertifikat TLS diterbitkan untuk
`MQTT_DOMAIN`, sehingga nilai ini harus tepat sama dengan domain tersebut. Listener
1883 dan WebSocket 9001 hanya tersedia pada localhost server; ESP32 harus terhubung
ke listener TLS pada port 8883.

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

4. Konfigurasikan ESP32 dengan domain, port, dan kredensial di atas. Uji koneksi
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
