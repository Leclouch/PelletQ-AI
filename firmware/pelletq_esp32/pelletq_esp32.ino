/*
 * ============================================================================
 * PelletQ-AI — ESP32 Hopper Gate Controller
 * ============================================================================
 * Monitoring suhu (MAX6675) + gerbang hopper (1x servo) antara mixer dan
 * extruder pada mesin pelet berpenggerak motor bensin.
 *
 * ESP32 TIDAK mengontrol motor apa pun. Tugasnya hanya:
 *   - Membaca suhu (thermocouple type-K via MAX6675)
 *   - Menjalankan state machine (IDLE/HEATING/MIXING/DISPENSING/ABORTED)
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
 *     (JANGAN pakai konfigurasi ILI9488 bawaan yang MOSI/SCK-nya beda.)
 *
 *         #define ILI9488_DRIVER
 *         #define TFT_MOSI 13
 *         #define TFT_SCLK 18
 *         #define TFT_CS   5
 *         #define TFT_DC   2
 *         #define TFT_RST  4
 *         #define TFT_MISO -1        // SDO TFT tidak dicolok
 *         #define SPI_FREQUENCY 27000000   // ILI9488 tidak stabil > 27 MHz
 *         #define LOAD_GLCD
 *         #define LOAD_FONT2
 *         #define LOAD_FONT4
 *         #define LOAD_GFXFF
 *
 * ----------------------------------------------------------------------------
 * SHARED SPI BUS — ATURAN KRITIS:
 *   TFT (MOSI13/SCK18) dan MAX6675 (SCK18/SO19) berbagi bus VSPI + SCK GPIO18.
 *   MAX6675 dibaca MANUAL lewat hardware SPI yang sama (lihat readMax6675Raw).
 *   JANGAN pakai library MAX6675 bit-bang (software SPI) — pinMode/digitalWrite
 *   pada GPIO18 akan melepas pin dari peripheral SPI dan merusak TFT.
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
#include <esp_mqtt_client.h>
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
#define PIN_MAX_SO   19    // MAX6675 SO (MISO) — pin default VSPI MISO
#define PIN_MAX_CS   15
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
  float thresholdTemp  = 95.0f;   // suhu ambang masuk MIXING (C)
  int   waitMinutes    = 7;       // durasi standby MIXING (menit)
  int   openSeconds    = 30;      // durasi servo buka saat DISPENSING (detik)
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
enum State { ST_IDLE, ST_HEATING, ST_MIXING, ST_DISPENSING, ST_ABORTED };
State state = ST_IDLE;

// Timing (semua non-blocking, basis millis)
unsigned long mixDeadlineMs   = 0;   // kapan countdown MIXING habis
unsigned long dispenseEndMs   = 0;   // kapan servo tutup lagi saat DISPENSING
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

  // MAX6675 CS harus siap SEBELUM tft.init() (aturan shared bus).
  pinMode(PIN_MAX_CS, OUTPUT);
  digitalWrite(PIN_MAX_CS, HIGH);

  // Inisialisasi TFT (TFT_eSPI meng-init VSPI dengan TFT_MISO = -1).
  tft.init();
  tft.setRotation(1);            // landscape 480x320
  tft.fillScreen(TFT_BLACK);

  // Setelah TFT init, pastikan MISO GPIO19 terpasang pada bus VSPI supaya
  // MAX6675 bisa dibaca. TFT menulis saja (tidak pernah membaca MISO), jadi
  // menambahkan MISO=19 aman untuk TFT.
  SPI.begin(PIN_TFT_SCK, PIN_MAX_SO, PIN_TFT_MOSI, -1);

  // Header statis (tidak pernah berubah)
  tft.setFreeFont(&FreeSansBold12pt7b);
  tft.setTextDatum(TL_DATUM);
  tft.setTextColor(TFT_CYAN, TFT_BLACK);
  tft.drawString("PelletQ-AI", 10, 10);

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
// SUHU — MAX6675 dibaca manual lewat hardware SPI yang di-share dengan TFT
// ============================================================================
uint16_t readMax6675Raw() {
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(PIN_MAX_CS, LOW);
  delayMicroseconds(1);
  uint16_t v = SPI.transfer16(0x0000);
  digitalWrite(PIN_MAX_CS, HIGH);
  SPI.endTransaction();
  return v;
}

void readTemperature() {
  if (tempOverrideActive) return;    // suhu dikunci manual, jangan baca sensor

  uint16_t raw = readMax6675Raw();

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
    case ST_MIXING:
      closeHopper();
      mixDeadlineMs = millis() + (unsigned long)cfg.waitMinutes * 60000UL;
      belowStartMs = 0;
      belowSec = 0;
      warnPublished = false;
      break;
    case ST_DISPENSING:
      openHopper();
      dispenseEndMs = millis() + (unsigned long)cfg.openSeconds * 1000UL;
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
        enterState(ST_MIXING);
      }
      break;

    case ST_MIXING: {
      // Hitung durasi kontinu di bawah threshold (abaikan saat TC lepas).
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

      // Countdown TETAP jalan apa pun kondisi suhu (kecuali sudah ABORT).
      if ((long)(mixDeadlineMs - now) <= 0) {
        enterState(ST_DISPENSING);
      }
      break;
    }

    case ST_DISPENSING:
      if ((long)(dispenseEndMs - now) <= 0) {
        closeHopper();
        publishEvent("CYCLE_COMPLETE");
        advanceBatch();
        enterState(ST_IDLE);
      }
      break;

    case ST_ABORTED:
      // Suhu kembali >= threshold -> MIXING dengan countdown DI-RESET dari awal.
      if (!tcOpen && tempC >= cfg.thresholdTemp) {
        enterState(ST_MIXING);
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
    if (state == ST_DISPENSING) {   // batalkan sisa timer buka
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
  if (doc["waitMinutes"].is<int>())
    cfg.waitMinutes = clampI(doc["waitMinutes"], 1, 60, cfg.waitMinutes);
  if (doc["openSeconds"].is<int>())
    cfg.openSeconds = clampI(doc["openSeconds"], 1, 300, cfg.openSeconds);
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
  ack["waitMinutes"]     = cfg.waitMinutes;
  ack["openSeconds"]     = cfg.openSeconds;
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

  esp_mqtt_client_register_event(mqttClient, ESP_EVENT_ANY_ID, mqttEventHandler,
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
  if (state == ST_MIXING) {
    long r = (long)(mixDeadlineMs - millis());
    remainingSec = (r > 0) ? (unsigned long)(r / 1000) : 0;
  } else if (state == ST_DISPENSING) {
    long r = (long)(dispenseEndMs - millis());
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
    case ST_MIXING:     return "MIXING";
    case ST_DISPENSING: return "DISPENSING";
    case ST_ABORTED:    return "ABORTED";
  }
  return "?";
}

// ============================================================================
// DISPLAY — refresh hanya bagian yang berubah (hindari full clear tiap frame)
// ============================================================================
// Region layout (rotation 1, 480x320):
//   Header    : y   0..40   (statis, digambar di setup + indikator dinamis)
//   Suhu      : y  50..130
//   State     : y 138..183
//   Countdown : y 188..268  (MM:SS + progress bar + sub-note)   [ST_MIXING]
//   Banner    : y 272..320                                     [ST_ABORTED / suhu-turun warning]
//   IDLE list : y 185..320  (batch info + hingga 4 baris ingridien +
//               "+N lainnya", termasuk seluruh area Countdown & Banner di
//               atas) — dipakai hanya saat ST_IDLE, lihat blok ST_IDLE di
//               updateDisplay(). Baris ke-4 & marker overflow HARUS berhenti
//               sebelum y301 (awal footer "Target: ..C") pada x0-105, karena
//               footer itu digambar ulang tiap ~250ms terlepas dari state.
//               Sebelum menambah drawString baru di region ini, cek dulu
//               tabrakan dengan footer target & fillRect(0,300,200,20).
// ----------------------------------------------------------------------------
static uint16_t stateColor(State s) {
  switch (s) {
    case ST_IDLE:       return TFT_DARKGREY;
    case ST_HEATING:    return TFT_ORANGE;
    case ST_MIXING:     return TFT_BLUE;
    case ST_DISPENSING: return TFT_GREEN;
    case ST_ABORTED:    return TFT_RED;
  }
  return TFT_WHITE;
}

void updateDisplay() {
  static State  prevState   = (State)255;
  static String prevTemp    = "";
  static String prevRemain  = "";
  static int    prevBanner  = -99;    // 0 none, 1 warn, 2 abort
  static int    prevWifi    = -1;
  static int    prevMqtt    = -1;
  static String prevTarget  = "";
  static String prevSubNote = "";
  static bool   prevOverride = false;  // untuk deteksi toggle tempOverrideActive

  bool full = false;
  if (state != prevState) {           // ganti state -> bersihkan body sekali
    tft.fillRect(0, 45, 480, 275, TFT_BLACK);
    prevState = state;
    prevTemp = ""; prevRemain = ""; prevBanner = -99; prevSubNote = "";
    full = true;
  }

  // --- Header: indikator WiFi & MQTT (dot kecil) ---
  if ((int)wifiOk != prevWifi) {
    prevWifi = wifiOk;
    tft.fillCircle(410, 22, 7, wifiOk ? TFT_GREEN : TFT_RED);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("W", 398, 22);
  }
  if ((int)mqttOk != prevMqtt) {
    prevMqtt = mqttOk;
    tft.fillCircle(460, 22, 7, mqttOk ? TFT_GREEN : TFT_RED);
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(MR_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("M", 448, 22);
  }

  // --- Suhu besar ---
  String tempStr = tcOpen ? "TC OPEN" : String(tempC, 1);
  if (tempStr != prevTemp || full || tempOverrideActive != prevOverride) {
    prevTemp = tempStr;
    prevOverride = tempOverrideActive;
    tft.fillRect(0, 50, 480, 80, TFT_BLACK);
    uint16_t col = TFT_WHITE;
    if (tcOpen)                                        col = TFT_RED;
    else if (state == ST_MIXING && tempC < cfg.thresholdTemp) col = TFT_ORANGE;

    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(col, TFT_BLACK);
    if (tcOpen) {
      tft.setFreeFont(&FreeSansBold18pt7b);
      tft.drawString("TC OPEN", 240, 90);
    } else {
      tft.setFreeFont(&FreeSansBold24pt7b);
      tft.drawString(tempStr, 210, 90);
      // unit "°C" — degree digambar manual (font GFX tidak punya glyph derajat)
      tft.drawCircle(322, 74, 5, col);
      tft.setFreeFont(&FreeSansBold18pt7b);
      tft.setTextDatum(ML_DATUM);
      tft.drawString("C", 332, 92);
    }

    // Indikator override manual (bench-test "temp <v>") — label terpisah di
    // pojok kanan area suhu, area ini kosong (angka+lingkaran+"C" hanya
    // menempati bagian tengah), jadi tidak ada risiko overflow/overlap.
    if (tempOverrideActive) {
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MR_DATUM);
      tft.setTextColor(TFT_YELLOW, TFT_BLACK);
      tft.drawString("OVERRIDE", 475, 60);
    }
  }

  // --- State ---
  if (full) {
    tft.fillRect(0, 138, 480, 45, TFT_BLACK);
    tft.setFreeFont(&FreeSansBold18pt7b);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(stateColor(state), TFT_BLACK);
    tft.drawString(stateName(state), 240, 160);
  }

  // --- Countdown / progress / sub-note ---
  if (state == ST_MIXING) {
    long r = (long)(mixDeadlineMs - millis());
    unsigned long rem = (r > 0) ? (unsigned long)(r / 1000) : 0;
    char mmss[8];
    snprintf(mmss, sizeof(mmss), "%02lu:%02lu", rem / 60, rem % 60);
    String remStr = mmss;
    if (remStr != prevRemain) {
      prevRemain = remStr;
      tft.fillRect(120, 188, 240, 40, TFT_BLACK);
      tft.setFreeFont(&FreeSansBold24pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      tft.drawString(remStr, 240, 208);

      // progress bar
      long total = (long)cfg.waitMinutes * 60;
      long elapsed = total - (long)rem;
      if (elapsed < 0) elapsed = 0;
      int w = (int)(360.0 * elapsed / total);
      tft.drawRect(60, 238, 360, 18, TFT_WHITE);
      tft.fillRect(61, 239, 358, 16, TFT_BLACK);
      tft.fillRect(61, 239, (w > 358 ? 358 : w), 16, TFT_BLUE);
    }
    // sub-note "suhu turun" (belowSec kecil, belum warn)
    String note = "";
    if (belowSec > 0 && belowSec < (unsigned long)cfg.warnBelowSec) note = "suhu turun";
    if (note != prevSubNote) {
      prevSubNote = note;
      tft.fillRect(0, 258, 480, 12, TFT_BLACK);
      if (note.length()) {
        tft.setFreeFont(&FreeSans9pt7b);
        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(TFT_ORANGE, TFT_BLACK);
        tft.drawString(note, 240, 264);
      }
    }
  } else if (state == ST_DISPENSING) {
    long r = (long)(dispenseEndMs - millis());
    unsigned long rem = (r > 0) ? (unsigned long)(r / 1000) : 0;
    String remStr = String(rem) + "s";
    if (remStr != prevRemain) {
      prevRemain = remStr;
      tft.fillRect(0, 188, 480, 70, TFT_BLACK);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_GREEN, TFT_BLACK);
      tft.drawString("HOPPER TERBUKA", 240, 202);
      tft.setFreeFont(&FreeSansBold24pt7b);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      tft.drawString(remStr, 240, 238);
    }
  } else if (state == ST_IDLE && (full || formulationDirty)) {
    formulationDirty = false;
    // Tinggi 135 (bukan 125) supaya y185-320 tercakup penuh, termasuk area
    // banner (y272-320) di bawahnya — lihat catatan di blok banner: ini
    // mencegah fillRect banner menimpa baris ingridien yang baru digambar.
    tft.fillRect(0, 185, 480, 135, TFT_BLACK);

    if (ingredientCount > 0) {
      char batchStr[24];
      snprintf(batchStr, sizeof(batchStr), "Batch %d/%d", currentBatch, totalBatches);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(TC_DATUM);
      tft.setTextColor(TFT_CYAN, TFT_BLACK);
      tft.drawString(batchStr, 240, 188);

      bool  isLastPartial = (currentBatch == totalBatches) && (lastBatchKg > 0) && (batchSizeKg > 0);
      float scale = isLastPartial ? (lastBatchKg / batchSizeKg) : 1.0f;

      tft.setFreeFont(&FreeSans9pt7b);
      tft.setTextDatum(TL_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_BLACK);
      int rowY = 220;
      // maxRows=4: baris terakhir jatuh di y274 (glyph ~y274-291), berhenti
      // sebelum footer target (y301+) di x0-105 — lihat catatan region layout
      // di atas. JANGAN naikkan lagi tanpa menghitung ulang batas footer.
      int maxRows = 4;
      int shown = (ingredientCount < maxRows) ? ingredientCount : maxRows;
      for (int i = 0; i < shown; i++) {
        char row[40];
        snprintf(row, sizeof(row), "%-18s %5.2f kg",
                 formulationIngredients[i].name, formulationIngredients[i].kg * scale);
        tft.drawString(row, 20, rowY);
        rowY += 18;
      }
      if (ingredientCount > shown) {
        char more[24];
        snprintf(more, sizeof(more), "+%d lainnya", ingredientCount - shown);
        tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
        // Digambar di x300 (bukan x20) supaya di luar jangkauan x footer
        // target (x0-105) / fillRect clear-nya (x0-200) meski y-nya (292)
        // sama dengan baris ke-5 yang lama.
        tft.drawString(more, 300, rowY);
      }
    }
  }

  // --- Target aktif (pojok kiri bawah, di atas banner) ---
  String targetStr = "Target: " + String(cfg.thresholdTemp, 0) + "C";
  if (targetStr != prevTarget) {
    prevTarget = targetStr;
    tft.fillRect(0, 300, 200, 20, TFT_BLACK);  // hanya sisi kiri, jangan tabrak banner tengah
  }

  // --- Banner peringatan (paling bawah) ---
  int banner = 0;
  if (state == ST_ABORTED) banner = 2;
  else if (state == ST_MIXING && belowSec >= (unsigned long)cfg.warnBelowSec) banner = 1;

  if (banner != prevBanner) {
    prevBanner = banner;
    if (banner == 2) {
      tft.fillRect(0, 272, 480, 48, TFT_RED);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_WHITE, TFT_RED);
      tft.drawString("DIHENTIKAN: SUHU TURUN > 7 MENIT", 240, 296);
    } else if (banner == 1) {
      tft.fillRect(0, 272, 480, 48, TFT_YELLOW);
      tft.setFreeFont(&FreeSansBold12pt7b);
      tft.setTextDatum(MC_DATUM);
      tft.setTextColor(TFT_BLACK, TFT_YELLOW);
      tft.drawString("SUHU TURUN > 1 MENIT - PERIKSA MESIN", 240, 296);
    } else if (state == ST_IDLE) {
      // Saat IDLE, blok ST_IDLE di atas (baris ~838) SUDAH membersihkan
      // y185-320 sekaligus (termasuk seluruh area banner y272-320) sebelum
      // menggambar batch info + baris ingridien di panggilan yang sama —
      // JANGAN fillRect lagi di sini, atau baris ke-4 (y274) dan marker
      // "+N lainnya" (y292, x300) akan tertimpa hitam persis setelah digambar.
      prevTarget = "";
    } else {
      tft.fillRect(0, 272, 480, 48, TFT_BLACK);
      // gambar ulang target kecil karena banner bersih menimpa area bawah
      prevTarget = "";
    }
  }

  // Target kecil digambar setelah banner supaya tidak tertimpa (hanya saat normal)
  if (banner == 0) {
    tft.setFreeFont(&FreeSans9pt7b);
    tft.setTextDatum(BL_DATUM);
    tft.setTextColor(TFT_DARKGREY, TFT_BLACK);
    tft.drawString(targetStr, 10, 318);
    prevTarget = targetStr;
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
