/*
 * ============================================================================
 * PelletQ-AI — ESP32 Formulation-Receive Bench Test
 * ============================================================================
 * Sketch KHUSUS UJI: apakah ESP32 bisa menerima formulasi dari web lewat
 * MQTT retained topic "pelletq/formulation"? Tidak ada TFT, servo, ataupun
 * MAX6675 di sini — hanya WiFi + esp-mqtt + parsing JSON, disalin dari
 * firmware/pelletq_esp32/pelletq_esp32.ino (lihat applyFormulation,
 * startMqttClient, mqttEventHandler, dispatchQueuedMqttMessages di sana).
 * Yang "seharusnya tampil di TFT" (batch info + daftar bahan) dicetak ke
 * Serial Monitor sebagai gantinya lewat printFormulationSnapshot().
 *
 * BUILD (PlatformIO):
 *     pio run -t upload && pio device monitor
 *
 * BENCH TEST (serial, tanpa MQTT) — ketik di Serial Monitor @115200:
 *   formulation <json>  - simulasikan pesan retained "pelletq/formulation",
 *                  contoh:
 *                  formulation {"batchSizeKg":5,"totalBatches":2,"lastBatchKg":2,
 *                  "ingredients":[{"name":"Tepung Ikan","kg":1.5}]}
 * ============================================================================
 */

#include <WiFi.h>
#include <ArduinoJson.h>
#include <esp_crt_bundle.h>
#include <esp_event.h>
#include <mqtt_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

// KREDENSIAL — lihat secrets.h (di-gitignore, sudah disalin dari
// firmware/pelletq_esp32/secrets.h supaya konek ke broker yang sama).
#include "secrets.h"

// ============================================================================
// MQTT
// ============================================================================
#define MQTT_CLIENT_ID     "pelletq-esp32-formulation-test"
#define TOPIC_FORMULATION  "pelletq/formulation"
#define TOPIC_STATUS       "pelletq/status"   // LWT retained

// ============================================================================
// FORMULASI (diterima via MQTT retained "pelletq/formulation" atau bench
// serial "formulation <json>") — sama persis dengan pelletq_esp32.ino.
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
int   currentBatch      = 1;      // 1-indexed
bool  formulationDirty  = false;  // true = snapshot serial perlu dicetak ulang

// Konektivitas
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

unsigned long lastSnapshotMs = 0;

// ============================================================================
// PROTOTIPE
// ============================================================================
void handleMqtt();
void startMqttClient();
void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId,
                      void* eventData);
void dispatchMqttPayload(const char* topic, const char* payload, size_t len);
void dispatchQueuedMqttMessages();
void applyFormulation(JsonDocument& doc);
void handleSerialCommand();
void printFormulationSnapshot();

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  Serial.println(F("\n[PelletQ] formulation-receive bench test boot"));

  mqttInboundQueue = xQueueCreate(2, sizeof(MqttInboundMessage));
  if (mqttInboundQueue == nullptr)
    Serial.println(F("[mqtt] inbound queue initialization failed"));

  // WiFi (non-blocking; loop yang menjaga reconnect)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  printFormulationSnapshot();
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

  if (line.startsWith("formulation ")) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, line.substring(12));
    if (err) {
      Serial.printf("[serial] formulation JSON tidak valid: %s\n", err.c_str());
    } else {
      applyFormulation(doc);
    }
  } else {
    Serial.println(F("[serial] perintah tidak dikenal (hanya \"formulation <json>\")"));
  }
}

// ============================================================================
// LOOP
// ============================================================================
void loop() {
  unsigned long now = millis();

  handleSerialCommand();
  handleMqtt();
  dispatchQueuedMqttMessages();

  if (now - lastSnapshotMs >= 3000) {   // "refresh layar" tiap 3 dtk
    lastSnapshotMs = now;
    printFormulationSnapshot();
  }
}

// ============================================================================
// FORMULASI
// ============================================================================
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
  printFormulationSnapshot();
}

// ============================================================================
// "DISPLAY" — apa yang seharusnya tampil di TFT IDLE screen, dicetak ke
// Serial Monitor sebagai gantinya.
// ============================================================================
void printFormulationSnapshot() {
  Serial.println(F("========================================"));
  Serial.printf("[tft] WiFi:%s  MQTT:%s\n", wifiOk ? "OK" : "--", mqttOk ? "OK" : "--");
  if (ingredientCount == 0) {
    Serial.println(F("[tft] (belum ada formulasi diterima)"));
  } else {
    Serial.printf("[tft] Batch %d/%d\n", currentBatch, totalBatches);
    bool  isLastPartial = (currentBatch == totalBatches) && (lastBatchKg > 0) && (batchSizeKg > 0);
    float scale = isLastPartial ? (lastBatchKg / batchSizeKg) : 1.0f;
    for (int i = 0; i < ingredientCount; i++) {
      Serial.printf("[tft]   %-18s %5.2f kg\n",
                    formulationIngredients[i].name, formulationIngredients[i].kg * scale);
    }
  }
  Serial.println(F("========================================"));
  formulationDirty = false;
}

// ============================================================================
// MQTT — sama persis dengan pelletq_esp32.ino, hanya subscribe formulation.
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
    return;
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
      esp_mqtt_client_publish(mqttClient, TOPIC_STATUS, "online", 0, 0, true);
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
  if (strcmp(topic, TOPIC_FORMULATION) == 0) {
    Serial.println(F("[mqtt] pesan formulasi diterima dari web"));
    applyFormulation(doc);
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
