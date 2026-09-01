/*
 * ============================================================================
 * PelletQ-AI — ESP32 Hopper Gate Controller
 * ============================================================================
 * Monitoring suhu (MAX6675) + gerbang hopper (1x servo) + relay pemanas
 * antara mixer dan extruder pada mesin pelet berpenggerak motor bensin.
 *
 * ESP32 TIDAK mengontrol motor apa pun, dan TIDAK punya state machine
 * bercabang lagi — perilakunya sepenuhnya otomatis mengikuti daya (hidup =
 * jalan, mati = berhenti), tidak dikonfinasi oleh perintah start/reset:
 *   - Membaca suhu (thermocouple type-K via MAX6675)
 *   - Begitu menyala (dan cfg.autoStart aktif — default true), gerbang LANGSUNG
 *     mulai siklus buka/tutup berulang (openSeconds/closeSeconds) SELAMANYA.
 *     Siklus ini TIDAK menunggu suhu apa pun dan tidak pernah dihentikan oleh
 *     suhu — pemanas jalan paralel dan sepenuhnya terpisah (updateHeaterControl).
 *   - Menggerakkan satu servo (gerbang hopper buka/tutup); command MQTT/serial
 *     "open"/"close" tetap tersedia sebagai override manual independen
 *   - Menyalakan/mematikan relay pemanas (bang-bang di sekitar thresholdTemp,
 *     lihat updateHeaterControl) — aktif selama cfg.autoStart true, mati
 *     otomatis kalau thermocouple lepas
 *   - Menampilkan status + daftar bahan (kg per ingridien, total formulasi —
 *     bukan per batch) di TFT, SELALU tampil apa pun fase pemanasan/siklusnya
 *   - Komunikasi MQTT (telemetry, command, config, event, LWT)
 *
 * ----------------------------------------------------------------------------
 * BUILD — PILIH SALAH SATU:
 *
 * (A) PlatformIO (DIREKOMENDASIKAN — tidak perlu edit library):
 *     Semua define TFT_eSPI ada di platformio.ini (build_flags). Cukup:
 *         pio run -t upload && pio device monitor
 *
 * (B) Arduino IDE:
 *     TFT_eSPI TIDAK bisa menerima build flag dari Arduino IDE, jadi kamu
 *     HARUS mengonfigurasi User_Setup TFT_eSPI dengan nilai PERSIS berikut.
 *     (JANGAN pakai konfigurasi ILI9341 bawaan yang MOSI/SCK-nya beda.)
 *
 *         #define ILI9341_DRIVER
 *         #define TFT_WIDTH  240
 *         #define TFT_HEIGHT 320
 *         #define TFT_MOSI 13
 *         #define TFT_SCLK 18
 *         #define TFT_CS   5
 *         #define TFT_DC   2
 *         #define TFT_RST  4
 *         #define TFT_MISO -1        // SDO TFT tidak dicolok
 *         #define SPI_FREQUENCY 27000000
 *         #define LOAD_GLCD
 *         #define LOAD_FONT2
 *         #define LOAD_FONT4
 *         #define LOAD_GFXFF
 *
 * ----------------------------------------------------------------------------
 * SPI BUS:
 *   TFT pakai VSPI (MOSI13/SCK18/CS5), MAX6675 pakai HSPI-nya sendiri
 *   (SCK25/SO34/CS26) — dua bus hardware SPI terpisah, tidak berbagi pin.
 *   MAX6675 dibaca MANUAL lewat hardware SPI (lihat readMax6675Raw).
 * ----------------------------------------------------------------------------
 * BENCH TEST (serial, tanpa WiFi/MQTT) — ketik di Serial Monitor @115200:
 *   open         - sama seperti command MQTT "open" (override manual)
 *   close        - sama seperti command MQTT "close" (override manual)
 *   temp <v>     - override tempC ke <v> (bench-only, TIDAK ada di MQTT),
 *                  contoh "temp 96" untuk menguji relay pemanas tanpa
 *                  memanaskan thermocouple sungguhan. TIDAK berpengaruh ke
 *                  siklus gerbang — siklus jalan sejak boot, lepas dari suhu.
 *   temp auto    - lepas override, lanjut baca MAX6675 asli
 *   formulation <json> - sama seperti pesan MQTT retained "pelletq/formulation"
 *                  (bench-only, TIDAK ada di MQTT command topic), contoh:
 *                  formulation {"ingredients":[{"name":"Tepung Ikan","kg":1.5}]}
 *                  (kg per ingridien = TOTAL formulasi, bukan per batch)
 * ============================================================================
 */

#include <WiFi.h>
#include <SPI.h>
#include <TFT_eSPI.h>
#include <ESP32Servo.h>
#include <ArduinoJson.h>
#include <esp_crt_bundle.h>
#include <esp_event.h>
#include <mqtt_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// ============================================================================
// KREDENSIAL — lihat secrets.h (di-gitignore). Copy dari secrets.h.example
// lalu isi WIFI_SSID/WIFI_PASSWORD/MQTT_URI sebelum upload.
// ============================================================================
#include "secrets.h"

// ============================================================================
// PIN MAP
// ============================================================================
#define PIN_TFT_CS   5
#define PIN_TFT_RST  4
#define PIN_TFT_DC   2
#define PIN_TFT_MOSI 13
#define PIN_TFT_SCK  18
#define PIN_MAX_SCK  25
#define PIN_MAX_SO   34    // MAX6675 SO (MISO) — GPIO34 (input-only, ADC1_CH6)
#define PIN_MAX_CS   26
#define PIN_SERVO    27
#define PIN_HEATER   14    // relay pemanas — GPIO14: bukan strapping pin, bukan
                           // UART, bukan input-only, tidak konflik dengan pin
                           // lain di atas. (Sebelumnya GPIO3/UART0 RX — bentrok
                           // dengan Serial Monitor USB, lihat riwayat commit.
                           // Lalu sempat di GPIO33 — dipindah ke sini setelah
                           // GPIO33 nggak bisa nge-drive relay module sama
                           // sekali di bench test firmware/relay_test, sedangkan
                           // GPIO14 langsung jalan di sketch yang sama.)

// Modul relay yang terpasang ternyata aktif-HIGH (HIGH = kontak nyala), bukan
// aktif-LOW seperti kebanyakan modul 1-channel murah. Sempat diset true dan
// membalik SEMUA logika pemanas: saat firmware mengira heater OFF (termasuk
// fail-safe di setup() dan saat thermocouple lepas) relay justru MENYALA, dan
// saat firmware mengira ON relay malah mati. Jangan ubah tanpa mengukur ulang
// modulnya — polaritas yang salah di sini berarti pemanas hidup tanpa kendali
// suhu. Harus sama dengan firmware/relay_test/relay_test.ino.
#define RELAY_ACTIVE_LOW false

// ============================================================================
// MQTT TOPICS
// ============================================================================
#define MQTT_CLIENT_ID     "pelletq-esp32"
#define TOPIC_TELEMETRY    "pelletq/telemetry"
#define TOPIC_COMMAND      "pelletq/command"
#define TOPIC_CONFIG       "pelletq/config"
#define TOPIC_CONFIG_ACK   "pelletq/config/ack"
#define TOPIC_FORMULATION  "pelletq/formulation"
#define TOPIC_EVENT        "pelletq/event"
#define TOPIC_STATUS       "pelletq/status"   // LWT retained

// ============================================================================
// KONFIGURASI (default hardcoded — dipakai hanya jika belum ada retained config)
// ============================================================================
struct Config {
  float thresholdTemp  = 60.0f;   // suhu ambang mulai siklus buka/tutup (C) — BENCH TEST, aslinya 95
  int   openSeconds    = 5;       // durasi servo buka tiap siklus (detik)
  int   closeSeconds   = 10;       // durasi servo tutup tiap siklus (detik)
  int   servoOpenAngle = 50;      // sudut servo saat buka
  int   servoCloseAngle= 180;       // sudut servo saat tutup
  bool  autoStart      = true;    // jalan otomatis begitu menyala? TIDAK bisa diubah lewat
                                   // MQTT config (lihat applyConfig) — hanya lewat firmware default.
  float heaterHysteresis = 5.0f;  // histeresis relay pemanas (C) di sekitar thresholdTemp — BENCH TEST, aslinya 2
                                   // (heater ON di bawah thresholdTemp-heaterHysteresis = 55, OFF di >= 60)
} cfg;

// ============================================================================
// FORMULASI (diterima via MQTT retained "pelletq/formulation" atau bench
// serial "formulation <json>") — kg per ingridien adalah TOTAL formulasi
// (bukan per batch — tidak ada lagi konsep batch di ESP32).
// ============================================================================
#define MAX_INGREDIENTS 12
struct Ingredient {
  char  name[20];
  float kg;
};
Ingredient formulationIngredients[MAX_INGREDIENTS];
int   ingredientCount   = 0;
bool  formulationDirty  = false;  // true = daftar bahan di layar perlu digambar ulang

// ============================================================================
// OTOMASI — tidak ada state machine lagi, cuma satu saklar: cfg.autoStart.
// Begitu true, gerbang LANGSUNG mulai siklus buka/tutup SELAMANYA (lihat
// updateAutomation), tanpa menunggu suhu. cfg.autoStart sengaja tidak bisa
// disentuh lewat MQTT config (lihat applyConfig).
// ============================================================================
bool cycleRunning = false;   // true = siklus buka/tutup sedang jalan

// Jeda sebelum gerakan gerbang PERTAMA sesudah boot. Bukan kosmetik: setup()
// sudah menggerakkan servo sekali (closeHopper), dan tanpa jeda ini
// updateAutomation langsung membukanya lagi di tick loop() pertama — dua
// gerakan travel penuh beruntun, tepat saat WiFi lagi asosiasi dan ikut narik
// arus. Di rail 5V yang pas-pasan (servo & ESP32 berbagi satu sumber lewat
// expansion board) itu cukup untuk memicu brownout, reset, lalu mengulang
// semuanya = boot loop yang tidak bisa keluar sendiri. Jeda ini memberi waktu
// rail pulih dan WiFi selesai sebelum gerbang mulai bekerja.
constexpr unsigned long SERVO_BOOT_DELAY_MS = 3000;

// Timing siklus buka/tutup (semua non-blocking, basis millis)
unsigned long dispensePhaseEndMs = 0;   // kapan siklus buka/tutup saat ini berakhir
bool          dispenseOpenPhase  = true; // true = servo sedang di fase buka

// Sensor
float tempC        = 0.0f;
bool  tcOpen       = false;          // thermocouple lepas
bool  tempOverrideActive = false;    // true = tempC dikunci manual via serial "temp <v>"
float tempSamples[5] = {0};
int   sampleIdx    = 0;
int   sampleCount  = 0;

// Servo sengaja TIDAK dibiarkan bertenaga terus: servo yang ditahan di satu
// sudut menarik arus terus-menerus (jauh lebih besar lagi kalau mentok/stall
// di ujung gerakan), padahal rail 5V-nya dipakai bareng coil relay dan
// lonjakan TX WiFi. Jadi pulsa PWM dimatikan SERVO_HOLD_MS setelah selesai
// bergerak — lihat updateServoIdle().
//
// Cara mematikannya: duty LEDC di-set 0 (pin LOW terus, tidak ada pulsa),
// BUKAN Servo::detach(). Servo sama-sama lemas & berhenti narik arus, tapi
// channel LEDC tidak pernah dibongkar-pasang.
//
// JANGAN diganti jadi detach()/attach() lagi. Sudah dicoba dan RUSAK di
// ESP32Servo 3.0.5 + arduino-esp32 3.2.0: attach pertama setelah boot jalan,
// tapi tiap RE-attach sesudah detach tidak menghasilkan pulsa lagi — gerbang
// bergerak sekali lalu diam selamanya. Penyebabnya esp32-hal-ledc.c:121:
// kalau channel-nya masih tercatat terpakai, ledcAttachChannel() cuma
// me-route ulang pin tanpa menjalankan ledc_timer_config/ledc_channel_config,
// dan ESP32Servo menumpuk masalah dengan memanggil ledcAttachChannel dua kali
// per attach (yang kedua selalu gagal "already attached to LEDC").
// Diverifikasi di bench lewat firmware/servo_relay_test (mode "duty0").
Servo hopperServo;
const char* servoStateStr = "CLOSED";
constexpr unsigned long SERVO_HOLD_MS = 600;   // waktu tahan sebelum pulsa dimatikan
bool          servoHolding   = false;
unsigned long servoIdleAtMs  = 0;


// Relay pemanas — kontrol bang-bang (histeresis) di sekitar cfg.thresholdTemp,
// aktif hanya selama cfg.autoStart true (lihat updateHeaterControl).
bool heaterOn = false;

// Konektivitas. esp-mqtt menjalankan koneksi/reconnect-nya pada task IDF;
// semua publish tetap hanya dilakukan setelah event CONNECTED.
esp_mqtt_client_handle_t mqttClient = nullptr;
bool wifiOk = false;
volatile bool mqttOk = false;

// ESP-MQTT boleh menyerahkan payload dalam beberapa event DATA. Simpan satu
// pesan MQTT yang sedang diterima, selalu tambahkan NUL sebelum JSON diparse.
constexpr size_t MQTT_RX_MAX = 1024;
constexpr size_t MQTT_TOPIC_MAX = 64;
char mqttRxPayload[MQTT_RX_MAX + 1];
char mqttRxTopic[MQTT_TOPIC_MAX];
size_t mqttRxExpected = 0;
size_t mqttRxReceived = 0;
bool mqttRxDiscarding = false;
struct MqttInboundMessage {
  char topic[MQTT_TOPIC_MAX];
  char payload[MQTT_RX_MAX + 1];
  size_t length;
};
QueueHandle_t mqttInboundQueue = nullptr;

// Display
TFT_eSPI tft = TFT_eSPI();

// MAX6675 — bus HSPI sendiri, terpisah dari VSPI milik TFT
SPIClass maxSpi(HSPI);

// Interval loop
unsigned long lastTempMs      = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastDisplayMs   = 0;

// ============================================================================
// PROTOTIPE
// ============================================================================
uint16_t readMax6675Raw();
void readTemperature();
void setTempOverride(float v);
void clearTempOverride();
void updateAutomation();
void updateDisplay();
void handleMqtt();
void applyWifiTxPower();
void startMqttClient();
void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId,
                      void* eventData);
void dispatchMqttPayload(const char* topic, const char* payload, size_t len);
void dispatchQueuedMqttMessages();
void publishTelemetry();
void publishEvent(const char* ev);
void applyConfig(JsonDocument& doc);
void applyFormulation(JsonDocument& doc);
void handleCommand(const char* action);
void handleSerialCommand();
void openHopper();
void closeHopper();
void updateServoIdle();
void setHeater(bool on);
void updateHeaterControl();
bool isMinyakIkan(const char* name);

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  // Default readStringUntil() menunggu 1 DETIK kalau ada byte masuk tanpa '\n'
  // (noise di jalur serial, monitor yang tidak mengirim newline) — selama itu
  // loop() berhenti total: heater, display, dan MQTT ikut tertahan. 20 ms
  // sudah lebih dari cukup untuk baris command yang diketik manusia.
  Serial.setTimeout(20);
  Serial.println(F("\n[PelletQ] boot"));

  mqttInboundQueue = xQueueCreate(2, sizeof(MqttInboundMessage));
  if (mqttInboundQueue == nullptr)
    Serial.println(F("[mqtt] inbound queue initialization failed"));

  // MAX6675 CS idle HIGH sebelum bus-nya diinisialisasi.
  pinMode(PIN_MAX_CS, OUTPUT);
  digitalWrite(PIN_MAX_CS, HIGH);

  // Relay pemanas mati dulu sebelum apa pun lain diinisialisasi (fail-safe).
  pinMode(PIN_HEATER, OUTPUT);
  setHeater(false);

  // Inisialisasi TFT (TFT_eSPI meng-init VSPI dengan TFT_MISO = -1).
  tft.init();
  tft.setRotation(3);            // landscape 320x240 — ganti ke 1 bila gambar terbalik/cermin
  tft.fillScreen(TFT_BLACK);

  // Bus HSPI khusus MAX6675 — read-only, jadi MOSI tidak dipakai (-1).
  maxSpi.begin(PIN_MAX_SCK, PIN_MAX_SO, -1, -1);

  // Header statis (tidak pernah berubah)
  tft.setFreeFont(&FreeSansBold9pt7b);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("PelletQ-AI", 4, 3);

  // Servo — closeHopper() di bawah yang melakukan attach (sekali seumur hidup
  // firmware). Sesudah itu servo dibuat "hemat" bukan dengan detach, tapi
  // dengan mematikan duty di updateServoIdle().
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  hopperServo.setPeriodHertz(50);
  closeHopper();

  // WiFi (non-blocking; loop yang menjaga reconnect)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  applyWifiTxPower();
}

// ============================================================================
// SERIAL COMMAND PARSER — bench-test interface
// ============================================================================
void handleSerialCommand() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  Serial.printf("[serial] cmd: %s\n", line.c_str());

  if (line == "temp auto") {
    clearTempOverride();
  } else if (line.startsWith("temp ")) {
    float v = line.substring(5).toFloat();
    setTempOverride(v);
  } else if (line.startsWith("formulation ")) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line.substring(12));
    if (err) {
      Serial.printf("[serial] formulation JSON tidak valid: %s\n", err.c_str());
    } else {
      applyFormulation(doc);
    }
  } else {
    handleCommand(line.c_str());   // open / close
  }
}

// ============================================================================
// LOOP — orkestrasi murni, semua bergated interval millis
// ============================================================================
void loop() {
  unsigned long now = millis();

  handleSerialCommand();   // bench-test: open/close/temp/formulation via Serial
  handleMqtt();   // jaga WiFi dan mulai esp-mqtt bila jaringan siap
  dispatchQueuedMqttMessages();

  if (now - lastTempMs >= 1000) {         // baca suhu tiap 1 dtk
    lastTempMs = now;
    readTemperature();
  }

  updateAutomation();                      // tiap loop (pakai millis internal)
  updateServoIdle();                       // matikan pulsa servo setelah selesai gerak
  updateHeaterControl();                   // bang-bang relay pemanas, tiap loop

  if (now - lastDisplayMs >= 250) {        // refresh TFT tiap 250 ms
    lastDisplayMs = now;
    updateDisplay();
  }

  if (now - lastTelemetryMs >= 2000) {     // telemetry tiap 2 dtk
    lastTelemetryMs = now;
    publishTelemetry();
  }
}

// ============================================================================
// SUHU — MAX6675 dibaca manual lewat bus HSPI dedicated (maxSpi)
// ============================================================================
// DEBUG SEMENTARA — cek GPIO14 (PIN_HEATER) tidak "dicuri" peripheral HSPI.
// GPIO14 kebetulan pin SCK default HSPI; kalau bus SPI sampai mengambil alih
// pin itu, levelnya bakal menyimpang dari yang di-drive setHeater() persis
// setelah transaksi SPI pertama (~1 dtk setelah boot) — dan relay drop out
// walau firmware masih mengira heater ON. Diam kalau semuanya normal; hanya
// mencetak saat level pin TIDAK cocok dengan heaterOn.
// (pinMode(OUTPUT) di ESP32 = INPUT|OUTPUT, jadi digitalRead pin output valid.)
// Hapus bareng print [max6675] raw setelah debug selesai.
static void checkHeaterPin(const char* when) {
  int expected = heaterOn ? (RELAY_ACTIVE_LOW ? LOW : HIGH)
                         : (RELAY_ACTIVE_LOW ? HIGH : LOW);
  int actual = digitalRead(PIN_HEATER);
  if (actual != expected)
    Serial.printf("[pin14] MISMATCH %s SPI: heaterOn=%d expected=%d actual=%d\n",
                  when, (int)heaterOn, expected, actual);
}

uint16_t readMax6675Raw() {
  checkHeaterPin("sebelum");
  maxSpi.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_MAX_CS, LOW);
  delayMicroseconds(1);
  uint16_t v = maxSpi.transfer16(0x0000);
  digitalWrite(PIN_MAX_CS, HIGH);
  maxSpi.endTransaction();
  checkHeaterPin("sesudah");
  return v;
}

void readTemperature() {
  if (tempOverrideActive) return;    // suhu dikunci manual, jangan baca sensor

  uint16_t raw = readMax6675Raw();
  Serial.printf("[max6675] raw=0x%04X\n", raw);   // TODO: hapus setelah debug selesai

  // Bit D2 = 1 -> thermocouple lepas
  if (raw & 0x0004) {
    tcOpen = true;
    return;                 // pertahankan tempC terakhir yang valid
  }
  tcOpen = false;

  float c = ((raw >> 3) & 0x0FFF) * 0.25f;

  // Moving average 5 sampel
  tempSamples[sampleIdx] = c;
  sampleIdx = (sampleIdx + 1) % 5;
  if (sampleCount < 5) sampleCount++;

  float sum = 0;
  for (int i = 0; i < sampleCount; i++) sum += tempSamples[i];
  tempC = sum / sampleCount;
}

void setTempOverride(float v) {
  tempOverrideActive = true;
  tcOpen = false;
  tempC = v;
  Serial.printf("[serial] temp override -> %.1f\n", v);
}

void clearTempOverride() {
  tempOverrideActive = false;
  Serial.println(F("[serial] temp override cleared, resuming MAX6675"));
}

// ============================================================================
// OTOMASI — tidak ada state machine; satu fungsi, satu saklar (cfg.autoStart).
// Siklus buka/tutup mulai SEJAK BOOT, tidak menunggu suhu sama sekali. Suhu
// hanya mengurus relay pemanas (updateHeaterControl), tidak pernah menahan,
// memulai, atau menghentikan gerbang.
// ============================================================================
void updateAutomation() {
  unsigned long now = millis();

  if (!cfg.autoStart) {
    // Dimatikan lewat config — gerbang tertutup, siklus berhenti.
    if (cycleRunning) {
      cycleRunning = false;
      closeHopper();
    }
    return;
  }

  if (!cycleRunning) {
    // Mulai siklus tanpa menunggu suhu apa pun — jalan di tick pertama setelah
    // boot (dan lagi kalau cfg.autoStart sempat dimatikan lalu dinyalakan).
    // Pemanas diurus terpisah oleh updateHeaterControl dan tidak menahan ini.
    //
    // Sengaja TIDAK memanggil openHopper() di sini. Gerbang sudah ditutup oleh
    // setup(), jadi siklus dimulai dari fase TUTUP dengan timer sepanjang
    // SERVO_BOOT_DELAY_MS. Gerakan berikutnya (buka) baru terjadi setelah jeda
    // itu — satu gerakan, bukan dua beruntun. Lihat catatan di deklarasi
    // SERVO_BOOT_DELAY_MS kenapa itu penting.
    cycleRunning       = true;
    dispenseOpenPhase  = false;
    dispensePhaseEndMs = now + SERVO_BOOT_DELAY_MS;
    publishEvent("DISPENSING_START");
    return;
  }

  // Siklus buka/tutup berulang SELAMANYA selama cfg.autoStart true. Suhu
  // tidak pernah menghentikannya.
  if ((long)(dispensePhaseEndMs - now) <= 0) {
    if (dispenseOpenPhase) {
      closeHopper();
      dispenseOpenPhase = false;
      dispensePhaseEndMs = now + (unsigned long)cfg.closeSeconds * 1000UL;
    } else {
      openHopper();
      dispenseOpenPhase = true;
      dispensePhaseEndMs = now + (unsigned long)cfg.openSeconds * 1000UL;
    }
  }
}

// ============================================================================
// SERVO
// ============================================================================
// Servo hanya bertenaga saat bergerak: attach sekali (di boot), lalu pulsanya
// dimatikan di updateServoIdle() setelah SERVO_HOLD_MS. Gerbang hopper ditahan
// mekanis, bukan oleh torsi servo, jadi mematikan pulsa saat diam tidak
// menggeser posisi.
static void holdServo(int angle) {
  // Praktis cuma jalan sekali, di closeHopper() dari setup(). Sesudah itu
  // servo tetap attached seumur hidup firmware — yang di-toggle cuma duty.
  if (!hopperServo.attached()) {
    hopperServo.setPeriodHertz(50);
    hopperServo.attach(PIN_SERVO, 500, 2400);
  }
  hopperServo.write(angle);       // menulis duty baru = pulsa hidup lagi
  servoHolding   = true;
  servoIdleAtMs  = millis() + SERVO_HOLD_MS;
}


void openHopper() {
  holdServo(cfg.servoOpenAngle);
  servoStateStr = "OPEN";
  Serial.printf("[servo] open angle=%d\n", cfg.servoOpenAngle);
}

void closeHopper() {
  holdServo(cfg.servoCloseAngle);
  servoStateStr = "CLOSED";
  Serial.printf("[servo] close angle=%d\n", cfg.servoCloseAngle);
}

// Matikan pulsa begitu gerakannya selesai supaya servo tidak menarik arus
// terus. Duty 0 = pin LOW terus = servo lemas, tapi channel LEDC tetap utuh
// sehingga holdServo() berikutnya cukup menulis duty baru (lihat catatan
// panjang di deklarasi hopperServo — jangan diganti jadi detach()).
void updateServoIdle() {
  if (!servoHolding) return;
  if ((long)(millis() - servoIdleAtMs) < 0) return;   // aman terhadap wrap
  servoHolding = false;
  if (hopperServo.attached()) {
    ledcWrite(PIN_SERVO, 0);
    Serial.println(F("[servo] idle (pulsa dimatikan, duty 0)"));
  }
}

// ============================================================================
// RELAY PEMANAS — kontrol bang-bang (histeresis) di sekitar cfg.thresholdTemp
// ============================================================================
void setHeater(bool on) {
  heaterOn = on;
  digitalWrite(PIN_HEATER, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH)
                              : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  Serial.printf("[heater] %s\n", on ? "ON" : "OFF");
}

void updateHeaterControl() {
  // Fail-safe: TC lepas, atau otomasi dimatikan -> pemanas mati.
  if (tcOpen || !cfg.autoStart) {
    if (heaterOn) setHeater(false);
    return;
  }

  // Bang-bang: nyala di bawah (threshold - histeresis), mati di >= threshold.
  if (heaterOn && tempC >= cfg.thresholdTemp) {
    setHeater(false);
  } else if (!heaterOn && tempC < cfg.thresholdTemp - cfg.heaterHysteresis) {
    setHeater(true);
  }
}

// ============================================================================
// COMMAND — override manual gerbang, independen dari siklus otomatis
// (updateAutomation tetap menimpanya di tick berikutnya kalau sedang siklus)
// ============================================================================
void handleCommand(const char* action) {
  if (strcmp(action, "open") == 0) {
    openHopper();
  } else if (strcmp(action, "close") == 0) {
    closeHopper();
  }
}

// ============================================================================
// CONFIG — merge + validasi rentang, lalu ack
// ============================================================================
static float clampF(float v, float lo, float hi, float cur) {
  return (v < lo || v > hi) ? cur : v;
}
static int clampI(int v, int lo, int hi, int cur) {
  return (v < lo || v > hi) ? cur : v;
}

void applyConfig(JsonDocument& doc) {
  // Semua field opsional — hanya timpa yang ada & valid.
  if (doc["thresholdTemp"].is<float>())
    cfg.thresholdTemp = clampF(doc["thresholdTemp"], 40.0f, 200.0f, cfg.thresholdTemp);
  if (doc["openSeconds"].is<int>())
    cfg.openSeconds = clampI(doc["openSeconds"], 1, 300, cfg.openSeconds);
  if (doc["closeSeconds"].is<int>())
    cfg.closeSeconds = clampI(doc["closeSeconds"], 1, 300, cfg.closeSeconds);
  if (doc["servoOpenAngle"].is<int>())
    cfg.servoOpenAngle = clampI(doc["servoOpenAngle"], 0, 180, cfg.servoOpenAngle);
  if (doc["servoCloseAngle"].is<int>())
    cfg.servoCloseAngle = clampI(doc["servoCloseAngle"], 0, 180, cfg.servoCloseAngle);
  // autoStart SENGAJA tidak bisa di-set lewat sini — topic ini "retained" di
  // broker, jadi config lama (mis. autoStart:false dari sesi bench test)
  // akan otomatis terkirim ulang & diterapkan setiap kali ESP32 reboot,
  // bikin heater/dispensing kelihatan "nggak mau nyala sendiri" padahal
  // firmware-nya benar. Kalau butuh mati/nyalakan autoStart secara manual,
  // pakai command MQTT/serial "open"/"close" (override manual, tidak
  // menyentuh cfg.autoStart) atau override lewat kode.
  if (doc["heaterHysteresis"].is<float>())
    cfg.heaterHysteresis = clampF(doc["heaterHysteresis"], 0.5f, 20.0f, cfg.heaterHysteresis);

  // Ack config aktif (non-retained) untuk konfirmasi di web app.
  JsonDocument ack;
  ack["thresholdTemp"]     = cfg.thresholdTemp;
  ack["openSeconds"]       = cfg.openSeconds;
  ack["closeSeconds"]      = cfg.closeSeconds;
  ack["servoOpenAngle"]    = cfg.servoOpenAngle;
  ack["servoCloseAngle"]   = cfg.servoCloseAngle;
  ack["autoStart"]         = cfg.autoStart;
  ack["heaterHysteresis"]  = cfg.heaterHysteresis;
  char buf[256];
  size_t n = serializeJson(ack, buf, sizeof(buf));
  if (mqttOk && mqttClient != nullptr)
    esp_mqtt_client_publish(mqttClient, TOPIC_CONFIG_ACK, buf, n, 0, false);
}

void applyFormulation(JsonDocument& doc) {
  ingredientCount = 0;
  JsonArray arr = doc["ingredients"].as<JsonArray>();
  for (JsonObject item : arr) {
    if (ingredientCount >= MAX_INGREDIENTS) {
      Serial.println(F("[formulation] jumlah ingridien melebihi MAX_INGREDIENTS, sisanya dibuang"));
      break;
    }
    const char* name = item["name"] | "?";
    strncpy(formulationIngredients[ingredientCount].name, name,
            sizeof(formulationIngredients[ingredientCount].name) - 1);
    formulationIngredients[ingredientCount].name[sizeof(formulationIngredients[ingredientCount].name) - 1] = '\0';
    // kg = TOTAL formulasi untuk ingridien ini (bukan per batch).
    formulationIngredients[ingredientCount].kg = item["kg"] | 0.0f;
    ingredientCount++;
  }

  formulationDirty = true;
  Serial.printf("[formulation] %d ingridien diterima\n", ingredientCount);
}

// ============================================================================
// MQTT
// ============================================================================
// Daya pancar WiFi dibatasi: default 19.5 dBm bikin lonjakan arus ratusan mA
// tiap TX — cukup untuk menjatuhkan rail 5V yang juga menyuplai coil relay dan
// servo, sampai relay drop out padahal firmware masih menahannya ON. 11 dBm
// masih jauh lebih dari cukup untuk AP di ruangan yang sama. Dipanggil ulang
// setiap habis WiFi.begin() karena setelan ini tidak dijamin bertahan melewati
// disconnect/reconnect.
void applyWifiTxPower() {
  WiFi.setTxPower(WIFI_POWER_11dBm);
}

void handleMqtt() {
  static unsigned long lastWifiRetry = 0;
  static unsigned long lastMqttStart = 0;
  static bool wasWifi = false;
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (wasWifi) { Serial.println(F("[wifi] disconnected")); wasWifi = false; }
    wifiOk = false;
    mqttOk = false;
    if (now - lastWifiRetry >= 5000) {       // retry non-blocking
      lastWifiRetry = now;
      Serial.printf("[wifi] connecting to \"%s\" ...\n", WIFI_SSID);
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      applyWifiTxPower();
    }
    return;                                  // offline: heater/gerbang tetap jalan otomatis
  }
  if (!wasWifi) {
    wasWifi = true;
    Serial.print(F("[wifi] connected, IP="));
    Serial.println(WiFi.localIP());
  }
  wifiOk = true;

  if (mqttClient == nullptr && now - lastMqttStart >= 5000) {
    lastMqttStart = now;
    startMqttClient();
  }
}

void startMqttClient() {
  if (mqttClient != nullptr) return;

  esp_mqtt_client_config_t config = {};
  config.broker.address.uri = MQTT_URI;
  // The IDF certificate bundle validates public CAs for the deferred wss://
  // endpoint. No certificate is pinned in this firmware.
  config.broker.verification.crt_bundle_attach = esp_crt_bundle_attach;
  config.credentials.client_id = MQTT_CLIENT_ID;
  config.credentials.username = MQTT_USERNAME;
  config.credentials.authentication.password = MQTT_PASSWORD;
  config.session.last_will.topic = TOPIC_STATUS;
  config.session.last_will.msg = "offline";
  config.session.last_will.msg_len = 0;
  config.session.last_will.qos = 0;
  config.session.last_will.retain = true;

  mqttClient = esp_mqtt_client_init(&config);
  if (mqttClient == nullptr) {
    Serial.println(F("[mqtt] client initialization failed"));
    return;
  }

  esp_mqtt_client_register_event(mqttClient, static_cast<esp_mqtt_event_id_t>(ESP_EVENT_ANY_ID), mqttEventHandler,
                                 nullptr);
  esp_err_t result = esp_mqtt_client_start(mqttClient);
  if (result != ESP_OK) {
    Serial.printf("[mqtt] start failed: %s\n", esp_err_to_name(result));
    esp_mqtt_client_destroy(mqttClient);
    mqttClient = nullptr;
  } else {
    Serial.printf("[mqtt] connecting to %s ...\n", MQTT_URI);
  }
}

void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId,
                      void* eventData) {
  (void)handlerArgs;
  (void)base;
  auto* event = static_cast<esp_mqtt_event_handle_t>(eventData);
  if (event == nullptr) return;

  switch (static_cast<esp_mqtt_event_id_t>(eventId)) {
    case MQTT_EVENT_CONNECTED:
      mqttOk = true;
      Serial.println(F("[mqtt] connected"));
      // mqttOk reflects the connection event, so all outgoing messages use the
      // same gate as telemetry, config acknowledgements, and state events.
      esp_mqtt_client_publish(mqttClient, TOPIC_STATUS, "online", 0, 0, true);
      esp_mqtt_client_subscribe(mqttClient, TOPIC_CONFIG, 0);
      esp_mqtt_client_subscribe(mqttClient, TOPIC_COMMAND, 0);
      esp_mqtt_client_subscribe(mqttClient, TOPIC_FORMULATION, 0);
      break;

    case MQTT_EVENT_DISCONNECTED:
      mqttOk = false;
      Serial.println(F("[mqtt] disconnected"));
      break;

    case MQTT_EVENT_DATA: {
      // A zero offset begins a new message. Reject this message as a whole if
      // its topic or full payload cannot fit in the bounded receive buffers.
      if (event->current_data_offset == 0) {
        mqttRxDiscarding = false;
        mqttRxExpected = 0;
        mqttRxReceived = 0;
        if (event->topic_len <= 0 || event->topic_len >= (int)sizeof(mqttRxTopic) ||
            event->total_data_len < 0 || event->total_data_len > (int)MQTT_RX_MAX) {
          mqttRxDiscarding = true;
          Serial.printf("[mqtt] rejected message topic=%d payload=%d bytes\n",
                        event->topic_len, event->total_data_len);
          break;
        }
        memcpy(mqttRxTopic, event->topic, event->topic_len);
        mqttRxTopic[event->topic_len] = '\0';
        mqttRxExpected = static_cast<size_t>(event->total_data_len);
      }

      if (mqttRxDiscarding) break;
      if (event->current_data_offset < 0 ||
          static_cast<size_t>(event->current_data_offset) != mqttRxReceived ||
          event->data_len < 0 ||
          static_cast<size_t>(event->data_len) > mqttRxExpected - mqttRxReceived) {
        mqttRxDiscarding = true;
        Serial.println(F("[mqtt] rejected malformed message fragment"));
        break;
      }

      if (event->data_len > 0)
        memcpy(mqttRxPayload + mqttRxReceived, event->data, event->data_len);
      mqttRxReceived += static_cast<size_t>(event->data_len);
      if (mqttRxReceived == mqttRxExpected) {
        mqttRxPayload[mqttRxReceived] = '\0';
        if (mqttInboundQueue == nullptr) {
          Serial.println(F("[mqtt] dropped message: inbound queue unavailable"));
          break;
        }
        MqttInboundMessage message = {};
        memcpy(message.topic, mqttRxTopic, sizeof(message.topic));
        memcpy(message.payload, mqttRxPayload, mqttRxReceived + 1);
        message.length = mqttRxReceived;
        if (xQueueSend(mqttInboundQueue, &message, 0) != pdPASS)
          Serial.println(F("[mqtt] dropped message: inbound queue full"));
      }
      break;
    }

    case MQTT_EVENT_ERROR:
      Serial.println(F("[mqtt] event error"));
      break;

    default:
      break;
  }
}

void dispatchQueuedMqttMessages() {
  if (mqttInboundQueue == nullptr) return;

  MqttInboundMessage message;
  while (xQueueReceive(mqttInboundQueue, &message, 0) == pdPASS)
    dispatchMqttPayload(message.topic, message.payload, message.length);
}

void dispatchMqttPayload(const char* topic, const char* payload, size_t len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) {
    Serial.printf("[mqtt] invalid JSON on %s\n", topic);
    return;
  }
  if (strcmp(topic, TOPIC_CONFIG) == 0) {
    applyConfig(doc);
  } else if (strcmp(topic, TOPIC_COMMAND) == 0) {
    const char* action = doc["action"];
    if (action) handleCommand(action);
  } else if (strcmp(topic, TOPIC_FORMULATION) == 0) {
    applyFormulation(doc);
  }
}

void publishTelemetry() {
  if (!mqttOk || mqttClient == nullptr) return;

  unsigned long remainingSec = 0;
  if (cycleRunning) {
    long r = (long)(dispensePhaseEndMs - millis());
    remainingSec = (r > 0) ? (unsigned long)(r / 1000) : 0;
  }

  JsonDocument doc;
  if (tcOpen) doc["temp"] = nullptr;                 // null saat thermocouple lepas
  else        doc["temp"] = round(tempC * 10) / 10.0;
  doc["autoStart"]    = cfg.autoStart;
  doc["ready"]        = cycleRunning;   // true = siklus buka/tutup sedang jalan
  doc["remainingSec"] = remainingSec;
  doc["servo"]        = servoStateStr;
  doc["heater"]       = heaterOn;

  char buf[192];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  esp_mqtt_client_publish(mqttClient, TOPIC_TELEMETRY, buf, n, 0, false);
}

void publishEvent(const char* ev) {
  Serial.printf("[event] %s\n", ev);
  if (!mqttOk || mqttClient == nullptr) return;
  JsonDocument doc;
  doc["event"] = ev;
  doc["ts"]    = millis();
  char buf[128];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  esp_mqtt_client_publish(mqttClient, TOPIC_EVENT, buf, n, 0, false);
}

// ============================================================================
// DISPLAY — refresh hanya bagian yang berubah (hindari full clear tiap frame)
// ============================================================================
// Layout 320x240 (rotation 3, panel ILI9341 3.2" — versi lama didesain untuk
// ILI9488 480x320; layar fisik yang terpasang jauh lebih kecil jadi seluruh
// layout ditulis ulang, bukan sekadar diskalakan):
//   Header       : y  0..22   (statis: judul + dot WiFi/MQTT/heater, digambar
//                  sekali di setup(), dot-nya sendiri dinamis)
//   Suhu + Fase  : y 24..66   (suhu kiri, label fase kanan — satu baris.
//                  Label fase: "OFF" kalau cfg.autoStart mati, "PANAS"
//                  sebelum threshold, "CETAK" sesudahnya — sengaja singkat,
//                  bukan nama state, cuma turunan langsung dari cfg.autoStart
//                  + heaterOn — lihat catatan lebar font di updateDisplay)
//   Info bar     : y 66..84   (kiri: status siklus — "Otomasi nonaktif", atau
//                  "Buka Ns"/"Tutup Ns" saat siklus jalan; kanan: Target
//                  NNC — SELALU tampil apa pun fasenya)
//   Body         : y 88..240  (152px) — SELALU daftar bahan (nama + kg TOTAL
//                  formulasi, bukan per batch — tidak ada lagi konsep batch),
//                  autoscroll (geser 1 baris tiap SCROLL_INTERVAL_MS) kalau
//                  jumlah bahan > SCROLL_VISIBLE_ROWS, plus titik indikator
//                  posisi di baris paling bawah. Tidak lagi berubah bentuk
//                  tergantung fase — itu sekarang cuma di info bar.
// ----------------------------------------------------------------------------

// Autoscroll daftar bahan — hanya aktif kalau ingredientCount melebihi
// jumlah baris yang muat sekaligus.
constexpr int SCROLL_VISIBLE_ROWS   = 5;
constexpr unsigned long SCROLL_INTERVAL_MS = 1800;
int           scrollOffset  = 0;
unsigned long lastScrollMs  = 0;

// Minyak Ikan ditampilkan dalam ml, bukan kg — murni tampilan (sama seperti
// di layar hasil web, lihat MINYAK_IKAN_DENSITY_KG_PER_L di lib/constants.ts
// sisi web). Formulasi yang diterima lewat MQTT tetap kg apa adanya di
// formulationIngredients[].kg; konversi cuma terjadi di baris TFT ini.
constexpr float MINYAK_IKAN_DENSITY_KG_PER_L = 0.92f;
bool isMinyakIkan(const char* name) {
  return strcmp(name, "Minyak Ikan") == 0;
}

void updateDisplay() {
  static String prevTemp            = "";
  static String prevPhaseLabel      = "";
  static String prevInfoBar         = "";
  static int    prevWifi            = -1;
  static int    prevMqtt            = -1;
  static bool   prevOverride        = false;  // deteksi toggle tempOverrideActive
  static int    prevScrollOffset    = -1;
  static int    prevIngredientCount = -1;
  static int    prevHeater          = -1;

  // --- Header: indikator WiFi & MQTT & heater (dot kecil) ---
  if ((int)wifiOk != prevWifi) {
    prevWifi = wifiOk;
    tft.fillCircle(240, 11, 5, wifiOk ? TFT_GREEN : TFT_RED);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("W", 232, 11);
  }
  if ((int)mqttOk != prevMqtt) {
    prevMqtt = mqttOk;
    tft.fillCircle(300, 11, 5, mqttOk ? TFT_GREEN : TFT_RED);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("M", 292, 11);
  }
  if ((int)heaterOn != prevHeater) {
    prevHeater = heaterOn;
    tft.fillCircle(168, 11, 5, heaterOn ? TFT_ORANGE : TFT_DARKGREY);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("H", 160, 11);
  }

  // --- Suhu (kiri) ---
  String tempStr = tcOpen ? "TC OPEN" : (String(tempC, 1) + "C");
  if (tempStr != prevTemp || tempOverrideActive != prevOverride) {
    prevTemp = tempStr;
    prevOverride = tempOverrideActive;
    tft.fillRect(0, 24, 200, 42, TFT_BLACK);
    uint16_t col = TFT_WHITE;
    if (tcOpen)                    col = TFT_RED;
    else if (tempOverrideActive)   col = TFT_YELLOW;
    tft.setFreeFont(&FreeSansBold18pt7b);
    tft.setTextDatum(ML_DATUM);
    tft.setTextColor(col, TFT_BLACK);
    tft.drawString(tempStr, 4, 44);
  }

  // --- Fase (kanan, satu baris dengan suhu): OFF / PANAS / CETAK ---
  // Sengaja singkat (bukan "MEMANASKAN"/"MENCETAK") — slot ini cuma 120px
  // (x200..320) di font FreeSansBold12pt7b; kata yang lebih panjang meluber
  // ke kiri ke area suhu dan bagian yang meluber itu kepotong tiap kali suhu
  // redraw (hampir tiap frame). Detail fase lengkap sudah ada di info bar.
  // Siklus tidak lagi menunggu suhu, jadi fase "PANAS" sudah tidak ada.
  // Label kanan-atas sekarang: OFF (otomasi mati) / PANAS (relay pemanas
  // sedang nyala) / CETAK (siklus jalan, pemanas sedang off).
  String phaseLabel = !cfg.autoStart ? "OFF" : (heaterOn ? "PANAS" : "CETAK");
  if (phaseLabel != prevPhaseLabel) {
    prevPhaseLabel = phaseLabel;
    tft.fillRect(200, 24, 120, 42, TFT_BLACK);
    tft.setFreeFont(&FreeSansBold12pt7b);
    tft.setTextDatum(MR_DATUM);
    uint16_t col = !cfg.autoStart ? TFT_DARKGREY : (heaterOn ? TFT_ORANGE : TFT_GREEN);
    tft.setTextColor(col, TFT_BLACK);
    tft.drawString(phaseLabel, 314, 44);
  }

  // --- Info bar: status siklus (kiri) + Target NNC (kanan), selalu tampil ---
  String infoBar;
  if (!cfg.autoStart) {
    infoBar = "Otomasi nonaktif";
  } else {
    long r = (long)(dispensePhaseEndMs - millis());
    unsigned long rem = (r > 0) ? (unsigned long)(r / 1000) : 0;
    char b[24];
    snprintf(b, sizeof(b), "%s %lus", dispenseOpenPhase ? "Buka" : "Tutup", rem);
    infoBar = String(b);
  }
  char t[20];
  snprintf(t, sizeof(t), "Target: %.0fC", cfg.thresholdTemp);
  String infoBarKey = infoBar + "|" + t;
  if (infoBarKey != prevInfoBar) {
    prevInfoBar = infoBarKey;
    tft.fillRect(0, 66, 320, 18, TFT_BLACK);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(TL_DATUM);
    tft.setTextColor(TFT_CYAN, TFT_BLACK);
    tft.drawString(infoBar, 4, 66);
    tft.setTextDatum(TR_DATUM);
    tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    tft.drawString(t, 316, 66);
  }

  // --- Body: daftar bahan (kg TOTAL formulasi, bukan per batch) — SELALU
  // tampil, apa pun fase pemanasan/siklusnya (lihat komentar layout di atas).
  unsigned long now = millis();
  bool needsScroll = ingredientCount > SCROLL_VISIBLE_ROWS;

  if (needsScroll && (now - lastScrollMs >= SCROLL_INTERVAL_MS)) {
    lastScrollMs = now;
    scrollOffset = (scrollOffset + 1) % ingredientCount;
  }
  if (!needsScroll) scrollOffset = 0;

  bool ingredientsChanged = formulationDirty || ingredientCount != prevIngredientCount;
  if (ingredientsChanged || scrollOffset != prevScrollOffset) {
    prevIngredientCount = ingredientCount;
    prevScrollOffset = scrollOffset;
    formulationDirty = false;
    tft.fillRect(0, 88, 320, 152, TFT_BLACK);

    if (ingredientCount == 0) {
      tft.setFreeFont(&FreeSans9pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
      tft.drawString("(belum ada formulasi)", 160, 160);
    } else {
      tft.setFreeFont(&FreeSans9pt7b);
      tft.setTextDatum(TL_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      int rowY = 92;
      int shown = (ingredientCount < SCROLL_VISIBLE_ROWS) ? ingredientCount : SCROLL_VISIBLE_ROWS;
      for (int i = 0; i < shown; i++) {
        int idx = (scrollOffset + i) % ingredientCount;   // jendela geser
        const char* nm = formulationIngredients[idx].name;
        float kg = formulationIngredients[idx].kg;
        char row[40];
        if (isMinyakIkan(nm)) {
          float ml = (kg * 1000.0f) / MINYAK_IKAN_DENSITY_KG_PER_L;
          snprintf(row, sizeof(row), "%-16s %5.0f ml", nm, ml);
        } else {
          snprintf(row, sizeof(row), "%-16s %5.2f kg", nm, kg);
        }
        tft.drawString(row, 6, rowY);
        rowY += 24;
      }

      // Titik indikator posisi scroll — cuma digambar kalau memang scrolling.
      if (needsScroll) {
        int dotsY = 226;
        int spacing = (ingredientCount > 1) ? (280 / (ingredientCount - 1)) : 0;
        for (int i = 0; i < ingredientCount; i++) {
          int dx = 20 + i * spacing;
          bool active = (i == scrollOffset);
          tft.fillCircle(dx, dotsY, active ? 3 : 2, active ? TFT_CYAN : TFT_DARKGREY);
        }
      }
    }
  }
}

extern "C" void app_main(void) {
  initArduino();
  setup();

  while (true) {
    loop();
    delay(1);
  }
}
