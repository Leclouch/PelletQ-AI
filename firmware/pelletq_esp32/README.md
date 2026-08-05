# PelletQ-AI — ESP32 Hopper Gate Controller

Controller monitoring suhu + gerbang hopper (1 servo) antara **mixer** dan **extruder**
pada mesin pelet berpenggerak **motor bensin**. ESP32 **tidak** mengontrol motor —
hanya membaca suhu, menjalankan state machine, menggerakkan servo, menampilkan status
di TFT, dan berkomunikasi via MQTT.

## Hardware & Pin

| Komponen | Pin ESP32 | Catatan |
|---|---|---|
| TFT ILI9488 CS | GPIO 5 | |
| TFT RST | GPIO 4 | |
| TFT DC | GPIO 2 | |
| TFT MOSI | GPIO 13 | |
| TFT SCK | GPIO 18 | **share bus** dengan MAX6675 |
| MAX6675 SCK | GPIO 18 | share bus |
| MAX6675 SO (MISO) | GPIO 19 | pin default MISO VSPI |
| MAX6675 CS | GPIO 15 | |
| Servo sinyal | GPIO 27 | |

> ⚠️ **Shared SPI bus.** TFT & MAX6675 berbagi SCK (GPIO 18). Sketch membaca MAX6675
> **manual** lewat hardware SPI (VSPI) yang sama — **bukan** library MAX6675 bit-bang.
> Library bit-bang memanggil `pinMode`/`digitalWrite` pada GPIO 18 dan itu akan
> melepas pin dari peripheral SPI sehingga TFT rusak. Kunci di sketch:
> `MAX_CS` di-`OUTPUT`/`HIGH` **sebelum** `tft.init()`, lalu `SPI.begin(18, 19, 13, -1)`
> dipanggil **setelah** `tft.init()` supaya MISO GPIO 19 terpasang untuk MAX6675
> (TFT tidak pernah membaca MISO, jadi ini aman).

## Library + Versi

| Library | Versi diuji |
|---|---|
| bodmer/TFT_eSPI | ^2.5.43 |
| madhephaestus/ESP32Servo | ^3.0.5 |
| knolleary/PubSubClient | ^2.8 |
| bblanchon/ArduinoJson | ^7.0.4 |
| WiFi.h / SPI.h | bawaan core ESP32 |

## Sebelum upload

Kredensial WiFi/MQTT ada di `secrets.h` (di-gitignore, tidak ikut commit). Copy dari
template lalu isi nilai asli:

```bash
cp secrets.h.example secrets.h
```

```cpp
// secrets.h
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_BROKER    "192.168.1.100"   // domain/IP publik broker (listener TLS, lihat Task 7)
#define MQTT_PORT      8883              // listener TLS (bukan 1883 plain)
#define MQTT_USERNAME  "GANTI_USERNAME"
#define MQTT_PASSWORD  "GANTI_PASSWORD"
```

> Arduino IDE juga membaca `secrets.h` selama filenya ada di folder sketch yang sama
> (satu folder dengan `pelletq_esp32.ino`) — tidak perlu langkah tambahan.

> Untuk deploy produksi (broker MQTT lewat internet, bukan LAN lokal), MQTT_BROKER
> harus domain publik dengan sertifikat TLS di port 8883, dan MQTT_USERNAME/
> MQTT_PASSWORD wajib diisi kredensial asli (bukan bench-test). Lihat checklist
> lengkap di `.env.example` bagian atas.

## Build — Opsi A: PlatformIO (direkomendasikan)

Tidak perlu mengedit library. Semua define TFT_eSPI ada di `platformio.ini`.

```bash
cd firmware/pelletq_esp32
pio run -t upload
pio device monitor
```

## Build — Opsi B: Arduino IDE

TFT_eSPI tidak bisa menerima build flag dari Arduino IDE, jadi kamu **harus**
mengonfigurasi `User_Setup.h` TFT_eSPI dengan nilai **persis** berikut
(atau buat setup terpisah lewat `User_Setup_Select.h`). Nilai ini juga ditulis
sebagai komentar di atas sketch:

```cpp
#define ILI9488_DRIVER
#define TFT_MOSI 13
#define TFT_SCLK 18
#define TFT_CS   5
#define TFT_DC   2
#define TFT_RST  4
#define TFT_MISO -1
#define SPI_FREQUENCY 27000000   // ILI9488 tidak stabil > 27 MHz
#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_FONT4
#define LOAD_GFXFF
```

Lalu: Board = **ESP32 Dev Module**, install 4 library di atas via Library Manager,
buka `pelletq_esp32.ino`, Upload.

## Topik MQTT

| Topic | Arah | Isi |
|---|---|---|
| `pelletq/telemetry` | ESP → server, tiap 2 dtk | `{"temp":96.2,"state":"MIXING","remainingSec":183,"belowSec":0,"servo":"CLOSED"}` |
| `pelletq/command` | server → ESP | `{"action":"start"}` \| `"open"` \| `"close"` \| `"reset"` |
| `pelletq/config` | server → ESP (**retained**) | lihat di bawah |
| `pelletq/config/ack` | ESP → server | echo config aktif setelah diterima |
| `pelletq/event` | ESP → server | `{"event":"THRESHOLD_REACHED","ts":123456}` dll |
| `pelletq/status` | LWT (**retained**) | `online` / `offline` |

Event: `THRESHOLD_REACHED`, `WARN_TEMP_DROP`, `ABORTED`, `DISPENSING_START`, `CYCLE_COMPLETE`.

## State machine (ringkas)

```
IDLE ──start──▶ HEATING ──(suhu≥threshold)──▶ MIXING ──(countdown habis)──▶ DISPENSING ──▶ IDLE
                                                 │
                                                 ├─ suhu<threshold ≥60 dtk  → banner kuning + event WARN
                                                 └─ suhu<threshold ≥420 dtk → ABORTED (servo tutup, banner merah)
ABORTED ──(suhu≥threshold lagi)──▶ MIXING (countdown RESET dari awal)
```

- Countdown MIXING **tetap jalan** walau suhu turun (hanya ABORT yang menghentikan).
- `open`/`close` manual dihormati di state mana pun; `close` saat DISPENSING
  membatalkan sisa timer buka.
- Offline (WiFi/MQTT putus): state machine **tetap berjalan** dengan config terakhir.

## Konfigurasi via MQTT (retained, tanpa upload ulang)

Semua field **opsional** (merge dengan yang berlaku). Nilai di luar rentang wajar
diabaikan. Kirim **retained** (`-r`) supaya ESP dapat config terakhir setiap boot:

```bash
mosquitto_pub -h 192.168.1.100 -t pelletq/config -r -m '{
  "thresholdTemp": 95.0,
  "waitMinutes": 7,
  "openSeconds": 30,
  "warnBelowSec": 60,
  "abortBelowSec": 420,
  "servoOpenAngle": 90,
  "servoCloseAngle": 0,
  "autoStart": false
}'
```

Ubah satu field saja (contoh naikkan ambang suhu):

```bash
mosquitto_pub -h 192.168.1.100 -t pelletq/config -r -m '{"thresholdTemp":100}'
```

Rentang valid: `thresholdTemp` 40–200, `waitMinutes` 1–60, `openSeconds` 1–300,
`warnBelowSec` 10–600, `abortBelowSec` 30–3600, sudut servo 0–180.

## Contoh perintah operasi

```bash
# mulai siklus
mosquitto_pub -h 192.168.1.100 -t pelletq/command -m '{"action":"start"}'
# buka / tutup hopper manual
mosquitto_pub -h 192.168.1.100 -t pelletq/command -m '{"action":"open"}'
mosquitto_pub -h 192.168.1.100 -t pelletq/command -m '{"action":"close"}'
# reset ke IDLE (mis. setelah ABORTED)
mosquitto_pub -h 192.168.1.100 -t pelletq/command -m '{"action":"reset"}'

# pantau semua topik
mosquitto_sub -h 192.168.1.100 -t 'pelletq/#' -v
```

## Tampilan TFT (480×320, landscape)

- **Header**: judul "PelletQ-AI" + indikator bulat WiFi (W) & MQTT (M) hijau/merah.
- **Suhu besar** di tengah: putih normal, oranye jika < threshold saat MIXING,
  merah "TC OPEN" jika thermocouple lepas.
- **State** berwarna: IDLE abu, HEATING oranye, MIXING biru, DISPENSING hijau, ABORTED merah.
- **Countdown** `MM:SS` + progress bar (MIXING); sisa detik + "HOPPER TERBUKA" (DISPENSING).
- **Banner bawah**: kuning "SUHU TURUN > 1 MENIT" (warn), merah "DIHENTIKAN…" (abort).
- **Target aktif** kecil di pojok kiri bawah (`Target: 95C`).
