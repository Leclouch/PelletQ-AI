/*
 * ============================================================================
 * PelletQ-AI — ESP32 Hopper Gate Controller
 * ============================================================================
 * Monitoring suhu (MAX6675) + gerbang hopper (1x servo) antara mixer dan
 * extruder pada mesin pelet berpenggerak motor bensin.
 *
 * ESP32 TIDAK mengontrol motor apa pun. Tugasnya hanya:
 *   - Membaca suhu (thermocouple type-K via MAX6675)
 *   - Menjalankan state machine (IDLE/HEATING/DISPENSING/ABORTED); saat
 *     DISPENSING, gerbang buka/tutup berulang (openSeconds/closeSeconds)
 *     tanpa batas waktu sampai dihentikan manual
 *   - Menggerakkan satu servo (gerbang hopper buka/tutup)
 *   - Menampilkan status di TFT ILI9488 480x320
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
 *   start        - sama seperti command MQTT "start" (IDLE -> HEATING)
 *   open         - sama seperti command MQTT "open"
 *   close        - sama seperti command MQTT "close"
 *   reset        - sama seperti command MQTT "reset" (paksa balik ke IDLE)
 *   temp <v>     - override tempC ke <v> (bench-only, TIDAK ada di MQTT),
 *                  contoh "temp 96" untuk memicu THRESHOLD_REACHED tanpa
 *                  memanaskan thermocouple sungguhan
 *   temp auto    - lepas override, lanjut baca MAX6675 asli
 *   formulation <json> - sama seperti pesan MQTT retained "pelletq/formulation"
 *                  (bench-only, TIDAK ada di MQTT command topic), contoh:
 *                  formulation {"batchSizeKg":5,"totalBatches":2,"lastBatchKg":2,
 *                  "ingredients":[{"name":"Tepung Ikan","kg":1.5}]}
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
  float thresholdTemp  = 95.0f;   // suhu ambang masuk DISPENSING (C)
  int   openSeconds    = 10;      // durasi servo buka tiap siklus DISPENSING (detik)
  int   closeSeconds   = 10;      // durasi servo tutup tiap siklus DISPENSING (detik)
  int   warnBelowSec   = 60;      // suhu turun >= ini -> banner peringatan
  int   abortBelowSec  = 420;     // suhu turun >= ini -> ABORTED (7 menit)
  int   servoOpenAngle = 90;      // sudut servo saat buka
  int   servoCloseAngle= 0;       // sudut servo saat tutup
  bool  autoStart      = false;   // otomatis HEATING saat boot?
} cfg;

// ============================================================================
// FORMULASI (diterima via MQTT retained "pelletq/formulation" atau bench
// serial "formulation <json>") — kg per ingridien untuk SATU batch penuh;
// batch terakhir (jika lastBatchKg > 0) di-skalakan di sisi ESP32.
// ============================================================================
#define MAX_INGREDIENTS 12
struct Ingredient {
  char  name[20];
  float kg;
};
Ingredient formulationIngredients[MAX_INGREDIENTS];
int   ingredientCount   = 0;
float batchSizeKg       = 0;
int   totalBatches      = 0;
float lastBatchKg       = 0;      // 0 = semua batch ukuran penuh
int   currentBatch      = 1;      // 1-indexed, direset saat formulasi baru masuk
bool  formulationDirty  = false;  // true = layar IDLE perlu digambar ulang

// ============================================================================
// STATE MACHINE
// ============================================================================
enum State { ST_IDLE, ST_HEATING, ST_DISPENSING, ST_ABORTED };
State state = ST_IDLE;

// Timing (semua non-blocking, basis millis)
unsigned long dispensePhaseEndMs = 0;   // kapan siklus buka/tutup saat ini berakhir
bool          dispenseOpenPhase  = true; // true = servo sedang di fase buka
unsigned long belowStartMs    = 0;   // awal periode kontinu suhu < threshold (0 = tidak)
unsigned long belowSec        = 0;   // durasi kontinu di bawah threshold (detik)
bool warnPublished            = false;
bool autoStartDone            = false;

// Sensor
float tempC        = 0.0f;
bool  tcOpen       = false;          // thermocouple lepas
bool  tempOverrideActive = false;    // true = tempC dikunci manual via serial "temp <v>"
float tempSamples[5] = {0};
int   sampleIdx    = 0;
int   sampleCount  = 0;

// Servo
Servo hopperServo;
const char* servoStateStr = "CLOSED";

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
void updateStateMachine();
void updateDisplay();
void handleMqtt();
void startMqttClient();
void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId,
                      void* eventData);
void dispatchMqttPayload(const char* topic, const char* payload, size_t len);
void dispatchQueuedMqttMessages();
void publishTelemetry();
void publishEvent(const char* ev);
void applyConfig(JsonDocument& doc);
void applyFormulation(JsonDocument& doc);
void advanceBatch();
void handleCommand(const char* action);
void handleSerialCommand();
void openHopper();
void closeHopper();
void enterState(State s);
const char* stateName(State s);

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n[PelletQ] boot"));

  mqttInboundQueue = xQueueCreate(2, sizeof(MqttInboundMessage));
  if (mqttInboundQueue == nullptr)
    Serial.println(F("[mqtt] inbound queue initialization failed"));

  // MAX6675 CS idle HIGH sebelum bus-nya diinisialisasi.
  pinMode(PIN_MAX_CS, OUTPUT);
  digitalWrite(PIN_MAX_CS, HIGH);

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

  // Servo
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  hopperServo.setPeriodHertz(50);
  hopperServo.attach(PIN_SERVO, 500, 2400);
  closeHopper();

  // WiFi (non-blocking; loop yang menjaga reconnect)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  enterState(ST_IDLE);
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
    handleCommand(line.c_str());   // start / open / close / reset
  }
}

// ============================================================================
// LOOP — orkestrasi murni, semua bergated interval millis
// ============================================================================
void loop() {
  unsigned long now = millis();

  handleSerialCommand();   // bench-test: start/open/close/reset/temp via Serial
  handleMqtt();   // jaga WiFi dan mulai esp-mqtt bila jaringan siap
  dispatchQueuedMqttMessages();

  if (now - lastTempMs >= 1000) {         // baca suhu tiap 1 dtk
    lastTempMs = now;
    readTemperature();
  }

  updateStateMachine();                    // tiap loop (pakai millis internal)

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
uint16_t readMax6675Raw() {
  maxSpi.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_MAX_CS, LOW);
  delayMicroseconds(1);
  uint16_t v = maxSpi.transfer16(0x0000);
  digitalWrite(PIN_MAX_CS, HIGH);
  maxSpi.endTransaction();
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
// STATE MACHINE
// ============================================================================
void enterState(State s) {
  Serial.printf("[state] %s -> %s\n", stateName(state), stateName(s));
  state = s;
  switch (s) {
    case ST_IDLE:
      closeHopper();
      break;
    case ST_HEATING:
      // menunggu suhu naik; servo tetap tutup
      closeHopper();
      break;
    case ST_DISPENSING:
      // siklus buka/tutup berulang dimulai dari fase buka; suhu terus
      // dipantau selama siklus (lihat updateStateMachine) sampai dihentikan
      // manual via command "close"/"reset".
      openHopper();
      dispenseOpenPhase = true;
      dispensePhaseEndMs = millis() + (unsigned long)cfg.openSeconds * 1000UL;
      belowStartMs = 0;
      belowSec = 0;
      warnPublished = false;
      publishEvent("DISPENSING_START");
      break;
    case ST_ABORTED:
      closeHopper();               // pastikan gerbang tertutup
      publishEvent("ABORTED");
      break;
  }
}

void updateStateMachine() {
  unsigned long now = millis();

  switch (state) {
    case ST_IDLE:
      // autoStart hanya sekali, saat masih IDLE awal
      if (cfg.autoStart && !autoStartDone) {
        autoStartDone = true;
        enterState(ST_HEATING);
      }
      break;

    case ST_HEATING:
      if (!tcOpen && tempC >= cfg.thresholdTemp) {
        publishEvent("THRESHOLD_REACHED");
        enterState(ST_DISPENSING);
      }
      break;

    case ST_DISPENSING: {
      // Hitung durasi kontinu di bawah threshold (abaikan saat TC lepas) —
      // siklus buka/tutup tetap jalan terus selama suhu belum ABORT.
      if (!tcOpen && tempC < cfg.thresholdTemp) {
        if (belowStartMs == 0) belowStartMs = now;
        belowSec = (now - belowStartMs) / 1000UL;
      } else {
        belowStartMs = 0;
        belowSec = 0;
        warnPublished = false;   // suhu pulih -> hapus status peringatan
      }

      if (belowSec >= (unsigned long)cfg.abortBelowSec) {
        enterState(ST_ABORTED);
        break;
      }
      if (belowSec >= (unsigned long)cfg.warnBelowSec && !warnPublished) {
        publishEvent("WARN_TEMP_DROP");
        warnPublished = true;
      }

      // Toggle buka/tutup tiap fase habis — berulang tanpa batas sampai
      // dihentikan manual (command "close"/"reset").
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
      break;
    }

    case ST_ABORTED:
      // Suhu kembali >= threshold -> lanjutkan siklus DISPENSING dari awal.
      if (!tcOpen && tempC >= cfg.thresholdTemp) {
        enterState(ST_DISPENSING);
      }
      break;
  }
}

// ============================================================================
// SERVO
// ============================================================================
void openHopper() {
  hopperServo.write(cfg.servoOpenAngle);
  servoStateStr = "OPEN";
  Serial.printf("[servo] open angle=%d\n", cfg.servoOpenAngle);
}

void closeHopper() {
  hopperServo.write(cfg.servoCloseAngle);
  servoStateStr = "CLOSED";
  Serial.printf("[servo] close angle=%d\n", cfg.servoCloseAngle);
}

// ============================================================================
// COMMAND — dihormati di state mana pun (override manual)
// ============================================================================
void handleCommand(const char* action) {
  if (strcmp(action, "start") == 0) {
    if (state == ST_IDLE) enterState(ST_HEATING);

  } else if (strcmp(action, "open") == 0) {
    openHopper();               // override manual, tidak mengubah state

  } else if (strcmp(action, "close") == 0) {
    closeHopper();
    if (state == ST_DISPENSING) {   // hentikan siklus buka/tutup manual
      publishEvent("CYCLE_COMPLETE");
      advanceBatch();
      enterState(ST_IDLE);
    }

  } else if (strcmp(action, "reset") == 0) {
    autoStartDone = true;       // jangan auto-start lagi setelah reset manual
    enterState(ST_IDLE);
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
  if (doc["warnBelowSec"].is<int>())
    cfg.warnBelowSec = clampI(doc["warnBelowSec"], 10, 600, cfg.warnBelowSec);
  if (doc["abortBelowSec"].is<int>())
    cfg.abortBelowSec = clampI(doc["abortBelowSec"], 30, 3600, cfg.abortBelowSec);
  if (doc["servoOpenAngle"].is<int>())
    cfg.servoOpenAngle = clampI(doc["servoOpenAngle"], 0, 180, cfg.servoOpenAngle);
  if (doc["servoCloseAngle"].is<int>())
    cfg.servoCloseAngle = clampI(doc["servoCloseAngle"], 0, 180, cfg.servoCloseAngle);
  if (doc["autoStart"].is<bool>())
    cfg.autoStart = doc["autoStart"];

  // Ack config aktif (non-retained) untuk konfirmasi di web app.
  JsonDocument ack;
  ack["thresholdTemp"]   = cfg.thresholdTemp;
  ack["openSeconds"]     = cfg.openSeconds;
  ack["closeSeconds"]    = cfg.closeSeconds;
  ack["warnBelowSec"]    = cfg.warnBelowSec;
  ack["abortBelowSec"]   = cfg.abortBelowSec;
  ack["servoOpenAngle"]  = cfg.servoOpenAngle;
  ack["servoCloseAngle"] = cfg.servoCloseAngle;
  ack["autoStart"]       = cfg.autoStart;
  char buf[256];
  size_t n = serializeJson(ack, buf, sizeof(buf));
  if (mqttOk && mqttClient != nullptr)
    esp_mqtt_client_publish(mqttClient, TOPIC_CONFIG_ACK, buf, n, 0, false);
}

void applyFormulation(JsonDocument& doc) {
  batchSizeKg  = doc["batchSizeKg"]  | 0.0f;
  totalBatches = doc["totalBatches"] | 0;
  lastBatchKg  = doc["lastBatchKg"]  | 0.0f;
  currentBatch = 1;

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
    formulationIngredients[ingredientCount].kg = item["kg"] | 0.0f;
    ingredientCount++;
  }

  formulationDirty = true;
  Serial.printf("[formulation] %d ingridien, batchSizeKg=%.2f totalBatches=%d lastBatchKg=%.2f\n",
                ingredientCount, batchSizeKg, totalBatches, lastBatchKg);
}

void advanceBatch() {
  if (currentBatch < totalBatches) currentBatch++;
  formulationDirty = true;
  Serial.printf("[formulation] batch -> %d/%d\n", currentBatch, totalBatches);
}

// ============================================================================
// MQTT
// ============================================================================
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
    }
    return;                                  // offline: state machine tetap jalan
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
  if (state == ST_DISPENSING) {
    long r = (long)(dispensePhaseEndMs - millis());
    remainingSec = (r > 0) ? (unsigned long)(r / 1000) : 0;
  }

  JsonDocument doc;
  if (tcOpen) doc["temp"] = nullptr;                 // null saat thermocouple lepas
  else        doc["temp"] = round(tempC * 10) / 10.0;
  doc["state"]        = stateName(state);
  doc["remainingSec"] = remainingSec;
  doc["belowSec"]     = belowSec;
  doc["servo"]        = servoStateStr;

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

const char* stateName(State s) {
  switch (s) {
    case ST_IDLE:       return "IDLE";
    case ST_HEATING:    return "HEATING";
    case ST_DISPENSING: return "DISPENSING";
    case ST_ABORTED:    return "ABORTED";
  }
  return "?";
}

// ============================================================================
// DISPLAY — refresh hanya bagian yang berubah (hindari full clear tiap frame)
// ============================================================================
// Layout 320x240 (rotation 3, panel ILI9341 3.2" — versi lama didesain untuk
// ILI9488 480x320; layar fisik yang terpasang jauh lebih kecil jadi seluruh
// layout ditulis ulang, bukan sekadar diskalakan):
//   Header       : y  0..22   (statis: judul + dot WiFi/MQTT, digambar sekali
//                  di setup(), dot-nya sendiri dinamis)
//   Suhu + State : y 24..66   (suhu kiri, nama state kanan — satu baris biar
//                  hemat tinggi, karena layar ini cuma 240px vs 320px lama)
//   Info bar     : y 66..84   (Batch X/Y kiri, Target NNC kanan — SELALU
//                  tampil apa pun state-nya)
//   Body         : y 88..240  (152px, isi beda-beda per state — lihat blok
//                  masing-masing di bawah):
//                    IDLE        -> daftar bahan, autoscroll (geser 1 baris
//                                   tiap SCROLL_INTERVAL_MS) kalau jumlah
//                                   bahan > SCROLL_VISIBLE_ROWS, plus titik
//                                   indikator posisi di baris paling bawah
//                    HEATING     -> pesan tunggu suhu naik
//                    DISPENSING  -> siklus buka/tutup berulang tanpa batas
//                                   (openSeconds/closeSeconds), label fase +
//                                   countdown ke toggle berikutnya + sub-note
//                                   peringatan suhu turun (dipantau selama
//                                   siklus, sama seperti dulu di ST_MIXING)
//                    ABORTED     -> body dipenuhi merah, pesan 2 baris
// ----------------------------------------------------------------------------
static uint16_t stateColor(State s) {
  switch (s) {
    case ST_IDLE:       return TFT_DARKGREY;
    case ST_HEATING:    return TFT_ORANGE;
    case ST_DISPENSING: return TFT_GREEN;
    case ST_ABORTED:    return TFT_RED;
  }
  return TFT_WHITE;
}

// Autoscroll daftar bahan IDLE — hanya aktif kalau ingredientCount melebihi
// jumlah baris yang muat sekaligus.
constexpr int SCROLL_VISIBLE_ROWS   = 5;
constexpr unsigned long SCROLL_INTERVAL_MS = 1800;
int           scrollOffset  = 0;
unsigned long lastScrollMs  = 0;

void updateDisplay() {
  static State  prevState           = (State)255;
  static String prevTemp            = "";
  static String prevStateStr        = "";
  static String prevInfoBar         = "";
  static int    prevWifi            = -1;
  static int    prevMqtt            = -1;
  static bool   prevOverride        = false;  // deteksi toggle tempOverrideActive
  static int    prevScrollOffset    = -1;
  static int    prevIngredientCount = -1;

  bool full = false;
  if (state != prevState) {           // ganti state -> bersihkan body sekali
    tft.fillRect(0, 88, 320, 152, TFT_BLACK);
    prevState = state;
    scrollOffset = 0;
    lastScrollMs = millis();
    full = true;
  }

  // --- Header: indikator WiFi & MQTT (dot kecil) ---
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

  // --- Suhu (kiri) ---
  String tempStr = tcOpen ? "TC OPEN" : (String(tempC, 1) + "C");
  if (tempStr != prevTemp || full || tempOverrideActive != prevOverride) {
    prevTemp = tempStr;
    prevOverride = tempOverrideActive;
    tft.fillRect(0, 24, 200, 42, TFT_BLACK);
    uint16_t col = TFT_WHITE;
    if (tcOpen)                                                 col = TFT_RED;
    else if (tempOverrideActive)                                col = TFT_YELLOW;
    else if (state == ST_DISPENSING && tempC < cfg.thresholdTemp) col = TFT_ORANGE;
    tft.setFreeFont(&FreeSansBold18pt7b);
    tft.setTextDatum(ML_DATUM);
    tft.setTextColor(col, TFT_BLACK);
    tft.drawString(tempStr, 4, 44);
  }

  // --- State (kanan, satu baris dengan suhu) ---
  String stateStr = stateName(state);
  if (stateStr != prevStateStr || full) {
    prevStateStr = stateStr;
    tft.fillRect(200, 24, 120, 42, TFT_BLACK);
    tft.setFreeFont(&FreeSansBold12pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(stateColor(state), TFT_BLACK);
    tft.drawString(stateStr, 314, 44);
  }

  // --- Info bar: Batch X/Y (kiri) + Target NNC (kanan), selalu tampil ---
  String infoBar = "";
  if (ingredientCount > 0) {
    char b[16];
    snprintf(b, sizeof(b), "Batch %d/%d", currentBatch, totalBatches);
    infoBar = String(b);
  }
  char t[20];
  snprintf(t, sizeof(t), "Target: %.0fC", cfg.thresholdTemp);
  String infoBarKey = infoBar + "|" + t;
  if (infoBarKey != prevInfoBar || full) {
    prevInfoBar = infoBarKey;
    tft.fillRect(0, 66, 320, 18, TFT_BLACK);
    tft.setFreeFont(&FreeSans9pt7b);
    if (infoBar.length()) {
      tft.setTextDatum(TL_DATUM);
      tft.setTextColor(TFT_CYAN, TFT_BLACK);
      tft.drawString(infoBar, 4, 66);
    }
    tft.setTextDatum(TR_DATUM);
    tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    tft.drawString(t, 316, 66);
  }

  // --- Body: konten spesifik per state ---
  if (state == ST_DISPENSING) {
    static String prevRemain  = "";
    static String prevPhase   = "";
    static String prevSubNote = "";
    long r = (long)(dispensePhaseEndMs - millis());
    unsigned long rem = (r > 0) ? (unsigned long)(r / 1000) : 0;
    String remStr = String(rem) + "s";
    String phaseStr = dispenseOpenPhase ? "HOPPER TERBUKA" : "HOPPER TERTUTUP";
    if (remStr != prevRemain || phaseStr != prevPhase || full) {
      prevRemain = remStr;
      prevPhase = phaseStr;
      tft.fillRect(0, 88, 320, 60, TFT_BLACK);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(dispenseOpenPhase ? TFT_GREEN : TFT_BLUE, TFT_BLACK);
      tft.drawString(phaseStr, 160, 100);
      tft.setFreeFont(&FreeSansBold24pt7b);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      tft.drawString(remStr, 160, 134);
    }
    // sub-note: peringatan suhu turun — siklus buka/tutup tetap jalan terus
    // selama ST_DISPENSING, jadi pemantauan ini menggantikan yang dulu ada
    // di ST_MIXING.
    String note = "";
    uint16_t noteCol = TFT_ORANGE;
    if (belowSec >= (unsigned long)cfg.warnBelowSec) {
      note = "SUHU TURUN - PERIKSA MESIN";
      noteCol = TFT_YELLOW;
    } else if (belowSec > 0) {
      note = "suhu turun";
    }
    if (note != prevSubNote || full) {
      prevSubNote = note;
      tft.fillRect(0, 172, 320, 16, TFT_BLACK);
      if (note.length()) {
        tft.setFreeFont(&FreeSans9pt7b);
        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(noteCol, TFT_BLACK);
        tft.drawString(note, 160, 180);
      }
    }
  } else if (state == ST_HEATING) {
    if (full) {
      tft.fillRect(0, 88, 320, 90, TFT_BLACK);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_ORANGE, TFT_BLACK);
      tft.drawString("MENUNGGU SUHU NAIK...", 160, 130);
    }
  } else if (state == ST_ABORTED) {
    if (full) {
      tft.fillRect(0, 88, 320, 152, TFT_RED);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_RED);
      tft.drawString("DIHENTIKAN:", 160, 150);
      tft.drawString("SUHU TURUN > 7 MENIT", 160, 174);
    }
  } else if (state == ST_IDLE) {
    unsigned long now = millis();
    bool needsScroll = ingredientCount > SCROLL_VISIBLE_ROWS;

    if (needsScroll && (now - lastScrollMs >= SCROLL_INTERVAL_MS)) {
      lastScrollMs = now;
      scrollOffset = (scrollOffset + 1) % ingredientCount;
    }
    if (!needsScroll) scrollOffset = 0;

    bool ingredientsChanged = formulationDirty || ingredientCount != prevIngredientCount;
    if (full || ingredientsChanged || scrollOffset != prevScrollOffset) {
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
        bool  isLastPartial = (currentBatch == totalBatches) && (lastBatchKg > 0) && (batchSizeKg > 0);
        float scale = isLastPartial ? (lastBatchKg / batchSizeKg) : 1.0f;

        tft.setFreeFont(&FreeSans9pt7b);
        tft.setTextDatum(TL_DATUM);
        tft.setTextColor(TFT_WHITE, TFT_BLACK);
        int rowY = 92;
        int shown = (ingredientCount < SCROLL_VISIBLE_ROWS) ? ingredientCount : SCROLL_VISIBLE_ROWS;
        for (int i = 0; i < shown; i++) {
          int idx = (scrollOffset + i) % ingredientCount;   // jendela geser
          char row[40];
          snprintf(row, sizeof(row), "%-16s %5.2f kg",
                   formulationIngredients[idx].name, formulationIngredients[idx].kg * scale);
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
}

extern "C" void app_main(void) {
  initArduino();
  setup();

  while (true) {
    loop();
    delay(1);
  }
}
