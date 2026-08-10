# PelletQ-AI — ESP32 Hopper Gate Controller

Dokumentasi ini menjelaskan koneksi ESP32 ke broker MQTT produksi PelletQ-AI.
Source firmware yang sebelumnya digunakan tidak dipulihkan dalam perubahan deployment
ini; gunakan repository firmware yang dikelola untuk board yang akan dipasang.

## Kredensial produksi

> **Transport berubah, firmware belum diimplementasikan ulang.** Server ada di
> belakang CGNAT, jadi tidak ada IP publik untuk port-forward. Broker sekarang
> dijangkau lewat Cloudflare Tunnel sebagai WebSocket (`wss://`), bukan TLS
> mentah di port 8883 seperti sebelumnya — listener 8883 sudah dihapus dari
> `mosquitto.conf`. Detail library MQTT (ESP-IDF `esp-mqtt` vs Arduino) masih
> dalam keputusan karena mempengaruhi bagaimana koneksi WebSocket ini ditulis;
> nilai koneksi di bawah adalah target akhir, bukan kode yang sudah diuji.

Simpan kredensial WiFi dan MQTT di `secrets.h` yang tidak di-commit. Untuk broker
produksi, gunakan domain dan kredensial yang sama dengan `.env` di server:

```cpp
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_BROKER    "wss://mqtt.yourdomain.com"  // WebSocket lewat Cloudflare Tunnel, port 443
#define MQTT_USERNAME  "GANTI_USERNAME"
#define MQTT_PASSWORD  "GANTI_PASSWORD"
```

TLS pada `wss://` ditangani oleh edge Cloudflare (sertifikat publik dari CA yang
umum dipercaya) — bukan lagi Let's Encrypt yang diterbitkan Caddy. Hop internal
dari cloudflared ke Mosquitto (listener 9001) memang plain WebSocket tanpa TLS,
tapi itu terjadi di jaringan Docker internal server, bukan di jalur ESP32.

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

3. Buat tunnel di dashboard Cloudflare Zero Trust (Networks -> Tunnels) dan
   tambahkan public hostname untuk domain MQTT yang mengarah ke
   `http://mosquitto:9001`. Lihat README bagian "Deploy ke Server Sendiri".

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
