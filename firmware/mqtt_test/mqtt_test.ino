/*
 * ============================================================================
 * PelletQ-AI — ESP32 MQTT-over-WebSocket Connection Test
 * ============================================================================
 * Sketch minimal untuk MEMASTIKAN WiFi + MQTT-over-WebSocket jalan, TANPA
 * hardware lain. Tidak butuh TFT, servo, atau thermocouple — cukup board
 * ESP32 + USB.
 *
 * Yang dilakukan:
 *   - Konek WiFi (retry non-blocking, log ke serial)
 *   - Konek MQTT melalui WebSocket dengan LWT retained (online/offline)
 *   - Publish heartbeat tiap 2 dtk ke pelletq/test/heartbeat
 *   - Subscribe pelletq/test/cmd — apa pun yang masuk di-echo ke serial
 *   - Blink LED onboard: cepat = nyari koneksi, nyala tetap = MQTT konek
 *
 * Build:
 *   cd firmware/mqtt_test && pio run -t upload && pio device monitor
 * Serial monitor @115200.
 * ============================================================================
 */

#include <Arduino.h>
#include <WiFi.h>
#include <esp_event.h>
#include <esp_mqtt_client.h>
#include <freertos/FreeRTOS.h>

// ---- GANTI SEBELUM UPLOAD -------------------------------------------------
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_URI       "ws://192.168.1.100:9001/mqtt"
// ---------------------------------------------------------------------------

#define MQTT_CLIENT_ID   "pelletq-esp32-test"
#define TOPIC_STATUS     "pelletq/test/status"      // LWT retained
#define TOPIC_HEARTBEAT  "pelletq/test/heartbeat"
#define TOPIC_CMD        "pelletq/test/cmd"

#ifndef LED_BUILTIN
#define LED_BUILTIN 2                                // GPIO2 di kebanyakan devkit
#endif

esp_mqtt_client_handle_t mqttClient = nullptr;

unsigned long lastRetry     = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastBlink     = 0;
unsigned long bootMs        = 0;
uint32_t      heartbeatSeq  = 0;
bool          mqttConnected = false;
bool          ledState      = false;
portMUX_TYPE  commandAckMux = portMUX_INITIALIZER_UNLOCKED;
unsigned long lastCommandAckToggle = 0;
uint8_t       commandAckTogglesRemaining = 0;

void setLed(bool on) {
  ledState = on;
  digitalWrite(LED_BUILTIN, on);
}

void mqttEventHandler(void* handlerArgs, esp_event_base_t base, int32_t eventId,
                      void* eventData) {
  (void)handlerArgs;
  (void)base;
  auto* event = static_cast<esp_mqtt_event_handle_t>(eventData);

  switch (static_cast<esp_mqtt_event_id_t>(eventId)) {
    case MQTT_EVENT_CONNECTED:
      mqttConnected = true;
      Serial.println(F("[mqtt] CONNECTED"));
      esp_mqtt_client_publish(mqttClient, TOPIC_STATUS, "online", 0, 0, true);
      esp_mqtt_client_subscribe(mqttClient, TOPIC_CMD, 0);
      Serial.printf("[mqtt] subscribed %s\n", TOPIC_CMD);
      break;

    case MQTT_EVENT_DISCONNECTED:
      mqttConnected = false;
      Serial.println(F("[mqtt] disconnected"));
      break;

    case MQTT_EVENT_DATA:
      Serial.printf("[rx] %.*s : %.*s\n", event->topic_len, event->topic,
                    event->data_len, event->data);
      // Six non-blocking toggles preserve the historical visual command ack.
      portENTER_CRITICAL(&commandAckMux);
      commandAckTogglesRemaining = 6;
      lastCommandAckToggle = millis() - 60;
      portEXIT_CRITICAL(&commandAckMux);
      break;

    case MQTT_EVENT_ERROR:
      Serial.println(F("[mqtt] event error"));
      break;

    default:
      break;
  }
}

void startMqttClient() {
  if (mqttClient != nullptr) return;

  esp_mqtt_client_config_t config = {};
  config.broker.address.uri = MQTT_URI;
  config.credentials.client_id = MQTT_CLIENT_ID;
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

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n[mqtt-test] boot"));

  pinMode(LED_BUILTIN, OUTPUT);
  setLed(false);

  WiFi.mode(WIFI_STA);
  delay(100);

  // --- Diagnostic scan: is the target SSID even visible to the ESP32? ---
  Serial.println(F("[scan] scanning for networks..."));
  int n = WiFi.scanNetworks();
  Serial.printf("[scan] found %d networks:\n", n);
  bool targetSeen = false;
  for (int i = 0; i < n; i++) {
    bool match = (WiFi.SSID(i) == WIFI_SSID);
    if (match) targetSeen = true;
    Serial.printf("  %2d) %-24s ch=%2d rssi=%d enc=%d%s\n",
                  i, WiFi.SSID(i).c_str(), WiFi.channel(i),
                  WiFi.RSSI(i), static_cast<int>(WiFi.encryptionType(i)),
                  match ? "  <-- TARGET" : "");
  }
  if (targetSeen)
    Serial.printf("[scan] target \"%s\" IS visible -> if it still fails, PASSWORD is wrong\n", WIFI_SSID);
  else
    Serial.printf("[scan] target \"%s\" NOT visible -> wrong SSID name, 5GHz, or out of range\n", WIFI_SSID);
  WiFi.scanDelete();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  bootMs = millis();
}

void serviceConnection() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastRetry >= 5000) {
      lastRetry = now;
      // status: 1=NO_SSID_AVAIL(name/band/range) 4=CONNECT_FAILED(wrong pw)
      //         6=DISCONNECTED(still trying) 3=CONNECTED
      Serial.printf("[wifi] connecting to \"%s\" ... status=%d\n",
                    WIFI_SSID, WiFi.status());
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
    return;
  }

  static bool wifiLogged = false;
  if (!wifiLogged) {
    wifiLogged = true;
    Serial.print(F("[wifi] connected, IP="));
    Serial.println(WiFi.localIP());
  }

  startMqttClient();
}

void serviceLed() {
  unsigned long now = millis();
  bool toggleCommandAck = false;
  bool commandAckActive = false;

  portENTER_CRITICAL(&commandAckMux);
  if (commandAckTogglesRemaining > 0) {
    commandAckActive = true;
    if (now - lastCommandAckToggle >= 60) {
      lastCommandAckToggle = now;
      commandAckTogglesRemaining--;
      toggleCommandAck = true;
    }
  }
  portEXIT_CRITICAL(&commandAckMux);

  if (toggleCommandAck) {
    setLed(!ledState);
    return;
  }
  if (commandAckActive) return;

  if (WiFi.status() != WL_CONNECTED) {
    if (now - lastBlink >= 150) {
      lastBlink = now;
      setLed(!ledState);
    }
    return;
  }

  if (!mqttConnected && now - lastBlink >= 400) {
    lastBlink = now;
    setLed(!ledState);
  } else if (mqttConnected) {
    setLed(true);                                    // nyala tetap = sehat
  }
}

void serviceHeartbeat() {
  if (!mqttConnected) return;

  unsigned long now = millis();
  if (now - lastHeartbeat < 2000) return;

  lastHeartbeat = now;
  char buf[96];
  int n = snprintf(buf, sizeof(buf),
                   "{\"seq\":%u,\"uptimeSec\":%lu,\"rssi\":%d}",
                   heartbeatSeq++, (now - bootMs) / 1000, WiFi.RSSI());
  esp_mqtt_client_publish(mqttClient, TOPIC_HEARTBEAT, buf, n, 0, false);
  Serial.printf("[tx] %s %s\n", TOPIC_HEARTBEAT, buf);
}

extern "C" void app_main(void) {
  initArduino();
  setup();

  while (true) {
    serviceConnection();
    serviceLed();
    serviceHeartbeat();
    delay(1);
  }
}
