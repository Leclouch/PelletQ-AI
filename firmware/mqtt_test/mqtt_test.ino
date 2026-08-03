/*
 * ============================================================================
 * PelletQ-AI — ESP32 MQTT Connection Test
 * ============================================================================
 * Sketch minimal untuk MEMASTIKAN WiFi + MQTT jalan, TANPA hardware lain.
 * Tidak butuh TFT, servo, atau thermocouple — cukup board ESP32 + USB.
 *
 * Yang dilakukan:
 *   - Konek WiFi (retry non-blocking, log ke serial)
 *   - Konek MQTT dengan LWT retained (online/offline)
 *   - Publish heartbeat tiap 2 dtk ke pelletq/test/heartbeat
 *   - Subscribe pelletq/test/cmd — apa pun yang masuk di-echo ke serial + LED
 *   - Blink LED onboard: cepat = nyari koneksi, nyala tetap = MQTT konek
 *
 * Build: sama seperti sketch utama (PlatformIO direkomendasikan).
 *   cd firmware/mqtt_test && pio run -t upload && pio device monitor
 * Serial monitor @115200.
 * ============================================================================
 */

#include <WiFi.h>
#include <PubSubClient.h>

// ---- GANTI SEBELUM UPLOAD -------------------------------------------------
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
#define MQTT_BROKER    "192.168.1.100"   // IP LAN Windows/host broker (bukan localhost)
#define MQTT_PORT      1883
// ---------------------------------------------------------------------------

#define MQTT_CLIENT_ID   "pelletq-esp32-test"
#define TOPIC_STATUS     "pelletq/test/status"      // LWT retained
#define TOPIC_HEARTBEAT  "pelletq/test/heartbeat"
#define TOPIC_CMD        "pelletq/test/cmd"

#ifndef LED_BUILTIN
#define LED_BUILTIN 2                                // GPIO2 di kebanyakan devkit
#endif

WiFiClient   wifiClient;
PubSubClient mqtt(wifiClient);

unsigned long lastRetry     = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastBlink     = 0;
unsigned long bootMs        = 0;
uint32_t      heartbeatSeq  = 0;
bool          ledState      = false;

void onMessage(char* topic, byte* payload, unsigned int len) {
  Serial.printf("[rx] %s : ", topic);
  for (unsigned int i = 0; i < len; i++) Serial.print((char)payload[i]);
  Serial.println();
  // Kedip cepat sebagai bukti visual pesan diterima.
  for (int i = 0; i < 6; i++) {
    digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
    delay(60);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n[mqtt-test] boot"));

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

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
                  WiFi.RSSI(i), (int)WiFi.encryptionType(i),
                  match ? "  <-- TARGET" : "");
  }
  if (targetSeen)
    Serial.printf("[scan] target \"%s\" IS visible -> if it still fails, PASSWORD is wrong\n", WIFI_SSID);
  else
    Serial.printf("[scan] target \"%s\" NOT visible -> wrong SSID name, 5GHz, or out of range\n", WIFI_SSID);
  WiFi.scanDelete();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setCallback(onMessage);

  bootMs = millis();
}

void ensureConnected() {
  unsigned long now = millis();

  // --- WiFi ---
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
    // blink cepat = belum konek
    if (now - lastBlink >= 150) {
      lastBlink = now;
      ledState = !ledState;
      digitalWrite(LED_BUILTIN, ledState);
    }
    return;
  }
  static bool wifiLogged = false;
  if (!wifiLogged) {
    wifiLogged = true;
    Serial.print(F("[wifi] connected, IP="));
    Serial.println(WiFi.localIP());
  }

  // --- MQTT ---
  if (!mqtt.connected()) {
    if (now - lastRetry >= 5000) {
      lastRetry = now;
      Serial.printf("[mqtt] connecting to %s:%d ...\n", MQTT_BROKER, MQTT_PORT);
      if (mqtt.connect(MQTT_CLIENT_ID, nullptr, nullptr,
                       TOPIC_STATUS, 0, true, "offline")) {
        Serial.println(F("[mqtt] CONNECTED"));
        mqtt.publish(TOPIC_STATUS, "online", true);
        mqtt.subscribe(TOPIC_CMD);
        Serial.printf("[mqtt] subscribed %s\n", TOPIC_CMD);
        digitalWrite(LED_BUILTIN, HIGH);           // nyala tetap = sehat
      } else {
        Serial.printf("[mqtt] FAILED rc=%d (retry 5s)\n", mqtt.state());
      }
    }
    // blink sedang = wifi ok, mqtt belum
    if (now - lastBlink >= 400) {
      lastBlink = now;
      ledState = !ledState;
      digitalWrite(LED_BUILTIN, ledState);
    }
    return;
  }
}

void loop() {
  ensureConnected();

  if (mqtt.connected()) {
    mqtt.loop();

    unsigned long now = millis();
    if (now - lastHeartbeat >= 2000) {
      lastHeartbeat = now;
      char buf[96];
      int n = snprintf(buf, sizeof(buf),
                       "{\"seq\":%u,\"uptimeSec\":%lu,\"rssi\":%d}",
                       heartbeatSeq++, (now - bootMs) / 1000, WiFi.RSSI());
      mqtt.publish(TOPIC_HEARTBEAT, (const uint8_t*)buf, n, false);
      Serial.printf("[tx] %s %s\n", TOPIC_HEARTBEAT, buf);
    }
  }
}
