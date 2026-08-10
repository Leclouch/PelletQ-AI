# ESP32 MQTT WebSocket Transport Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover the ESP32 firmware deleted in commit `860a270`, and migrate its MQTT client from `PubSubClient`/raw-TCP-TLS to ESP-IDF's `esp_mqtt_client` over WebSocket transport, so it can reach the broker through the new Cloudflare Tunnel (which only proxies HTTP/WebSocket, not raw TCP). Everything except the MQTT connection layer — TFT display, servo, thermocouple, state machine, topics, config, bench-test commands — is restored unchanged.

**Architecture:** ESP-IDF is the primary framework (PlatformIO `framework = espidf`), with `arduino-esp32` pulled in as a managed ESP-IDF component (via `idf_component.yml`, not PlatformIO's `framework = arduino, espidf` shorthand — that combination is confirmed broken, see Global Constraints). Entry point is a native `app_main()` that calls `initArduino()` once, then runs the existing Arduino-style `setup()`/loop logic. MQTT moves from a polled `PubSubClient` state machine to `esp_mqtt_client`'s event-driven model (`MQTT_EVENT_CONNECTED`/`DATA`/`DISCONNECTED` callbacks), which also handles reconnection internally.

**Tech Stack:** PlatformIO 6.1.19, `pioarduino/platform-espressif32` (ESP-IDF 5.4.1), `espressif/arduino-esp32@3.2.0` as an IDF component, ESP-IDF's `esp_mqtt_client` (`mqtt` component), existing Arduino libraries (`TFT_eSPI`, `ESP32Servo`, `ArduinoJson`) via PlatformIO `lib_deps`.

## Global Constraints

- **No ESP32 hardware is available.** Every task's verification is `pio run` (compile + link) succeeding, or a real WebSocket connection test from a dev machine against local Mosquitto — never a claim of on-device behavior.
- **The Cloudflare Tunnel is not live yet** (`TUNNEL_TOKEN` in `.env.example` is a placeholder). Task 2's connectivity test targets the project's local Mosquitto container, not the public `wss://` endpoint.
- **`platform = https://github.com/pioarduino/platform-espressif32/releases/download/54.03.20/platform-espressif32.zip`** is the confirmed-working platform. The official `platformio/espressif32` platform is NOT used — do not substitute it.
- **`framework = arduino, espidf` (PlatformIO's combined-framework shorthand) is confirmed broken** — reproduces an identical `CMake Error ... define_property command is not scriptable` failure on two ESP-IDF versions (4.4.7 and 5.4.1) and two CMake versions (3.16.4, 3.30.2). Do not use it, and do not spend implementer time re-diagnosing it — the working alternative (`framework = espidf` + `arduino-esp32` as an `idf_component.yml` dependency) is what every task in this plan uses.
- **`espressif/arduino-esp32` must be pinned to exactly `3.2.0`** in `idf_component.yml` (not `^3.0.0` or any range) — a newer resolved version (3.3.11) hit a real IDF-5.4.1 HAL incompatibility (`i2c_ll_slave_set_fifo_mode` undeclared) in a file unrelated to this firmware's I2C usage.
- **`sdkconfig.defaults` must set `CONFIG_FREERTOS_HZ=1000`** — `arduino-esp32`'s own `CMakeLists.txt` hard-asserts this and fails the configure step otherwise.
- **This sandbox is missing the `python3.12-venv` system package** (no sudo available to install it), which breaks PlatformIO's ESP-IDF Python virtualenv bootstrap with `ModuleNotFoundError: No module named 'ensurepip'`. If a task's `pio run` fails with that exact error, apply this workaround before doing anything else (this is almost certainly sandbox-specific and won't be needed on a normal dev machine, but the recipe is proven so use it rather than re-deriving it):
  ```bash
  VENV_DIR="/home/wafdan/.platformio/penv/.espidf-5.4.1"   # match the exact IDF version string PlatformIO reports as missing
  rm -rf "$VENV_DIR"
  python3 -m venv --without-pip --clear "$VENV_DIR"
  python3 -m pip --python "$VENV_DIR/bin/python3" install pip
  IDF_PATH=/home/wafdan/.platformio/packages/framework-espidf
  "$VENV_DIR/bin/python3" -m pip install -r "$IDF_PATH/tools/requirements/requirements.core.txt"
  "$VENV_DIR/bin/python3" -m pip install "idf-component-manager<2"   # newer major version breaks --interface_version compat
  PYVER=$(python3 -c "import sys;print('{0}.{1}.{2}-{3}.{4}'.format(*list(sys.version_info)))")
  cat > "$VENV_DIR/pio-idf-venv.json" <<EOF
  {"version": "1.0.0", "python_version": "$PYVER"}
  EOF
  ```
- **PlatformIO projects using `framework = espidf` must have a real git repository with at least one commit** at the project root (or an ancestor) — ESP-IDF's CMake build calls `git describe`/`git rev-parse` and hard-fails without it. `firmware/` living inside the main PelletQ-AI repo already satisfies this; do not `git init` inside `firmware/`.
- Topics (`pelletq/telemetry`, `pelletq/command`, `pelletq/config`, `pelletq/config/ack`, `pelletq/formulation`, `pelletq/status`), the state machine (`IDLE → HEATING → MIXING → DISPENSING → ABORTED`), the `Config` struct, hardware pin map, and the serial bench-command interface must NOT change in this plan. Only the MQTT connection layer (setup, connect/reconnect, subscribe, publish call sites) changes.

---

### Task 1: Recover mqtt_test and validate the ESP-IDF + arduino-esp32-component build recipe

**Files:**
- Create: `firmware/mqtt_test/platformio.ini`
- Create: `firmware/mqtt_test/sdkconfig.defaults`
- Create: `firmware/mqtt_test/src/idf_component.yml`
- Create: `firmware/mqtt_test/src/main.cpp`
- Delete (recovered file no longer needed as-is): none — `mqtt_test.ino` from `e799f00` is superseded by `src/main.cpp` below, ported in place; do not restore the `.ino` file separately.

**Interfaces:**
- Produces: the validated `platformio.ini` + `sdkconfig.defaults` + `idf_component.yml` pattern that Task 3 reuses verbatim (same platform pin, same `arduino-esp32` version pin, same `CONFIG_FREERTOS_HZ` default). Task 3's implementer should diff its own files against this task's for consistency rather than re-deriving the recipe.

- [ ] **Step 1: Write `firmware/mqtt_test/platformio.ini`**

```ini
; ============================================================================
; PelletQ-AI ESP32 MQTT Connection Test — PlatformIO build config
; ============================================================================
;   cd firmware/mqtt_test
;   pio run -t upload && pio device monitor
; ESP-IDF primary framework; arduino-esp32 pulled in as an IDF component
; (see src/idf_component.yml) so Arduino APIs (WiFi, Serial, GPIO) are still
; available, while MQTT uses ESP-IDF's esp_mqtt_client for native WebSocket
; transport support (needed for the Cloudflare Tunnel — see firmware README).
; ============================================================================

[env:esp32dev]
platform      = https://github.com/pioarduino/platform-espressif32/releases/download/54.03.20/platform-espressif32.zip
board         = esp32dev
framework     = espidf
monitor_speed = 115200
```

- [ ] **Step 2: Write `firmware/mqtt_test/sdkconfig.defaults`**

```
CONFIG_FREERTOS_HZ=1000
```

- [ ] **Step 3: Write `firmware/mqtt_test/src/idf_component.yml`**

```yaml
dependencies:
  espressif/arduino-esp32:
    version: "3.2.0"
  mqtt:
    version: "*"
```

- [ ] **Step 4: Write `firmware/mqtt_test/src/main.cpp`**

Ported from the original `mqtt_test.ino` (git history: `e799f00:firmware/mqtt_test/mqtt_test.ino`) — same WiFi scan diagnostic, LED blink states (fast = no WiFi, medium = WiFi but no MQTT, solid = connected), and 2s heartbeat publish, with `PubSubClient` replaced by `esp_mqtt_client` over WebSocket:

```cpp
#include "Arduino.h"
#include "WiFi.h"
#include "mqtt_client.h"

// ---- GANTI SEBELUM UPLOAD -------------------------------------------------
#define WIFI_SSID      "GANTI_SSID"
#define WIFI_PASSWORD  "GANTI_PASSWORD"
// Lokal (dev): ws://<ip-lan-mosquitto>:9001 — lihat Task 2 untuk cara
// memverifikasi path/URI yang benar. Produksi (lewat tunnel): wss://<MQTT_DOMAIN>.
#define MQTT_URI       "ws://GANTI_HOST:9001"
// ---------------------------------------------------------------------------

#define MQTT_CLIENT_ID   "pelletq-esp32-test"
#define TOPIC_STATUS     "pelletq/test/status"      // LWT retained
#define TOPIC_HEARTBEAT  "pelletq/test/heartbeat"
#define TOPIC_CMD        "pelletq/test/cmd"

#ifndef LED_BUILTIN
#define LED_BUILTIN 2
#endif

static esp_mqtt_client_handle_t mqttClient = nullptr;
static bool     mqttOk        = false;
static unsigned long lastWifiRetry = 0;
static unsigned long lastBlink     = 0;
static unsigned long lastHeartbeat = 0;
static unsigned long bootMs        = 0;
static uint32_t heartbeatSeq  = 0;
static bool     ledState      = false;

static void mqttEventHandler(void* handler_args, esp_event_base_t base,
                              int32_t event_id, void* event_data) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;
  switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
      mqttOk = true;
      Serial.println(F("[mqtt] CONNECTED"));
      esp_mqtt_client_publish(mqttClient, TOPIC_STATUS, "online", 0, 0, true);
      esp_mqtt_client_subscribe(mqttClient, TOPIC_CMD, 0);
      Serial.printf("[mqtt] subscribed %s\n", TOPIC_CMD);
      digitalWrite(LED_BUILTIN, HIGH);   // nyala tetap = sehat
      break;
    case MQTT_EVENT_DISCONNECTED:
      mqttOk = false;
      Serial.println(F("[mqtt] disconnected"));
      break;
    case MQTT_EVENT_DATA: {
      Serial.printf("[rx] %.*s : %.*s\n",
                    event->topic_len, event->topic,
                    event->data_len, event->data);
      for (int i = 0; i < 6; i++) {
        digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));
        delay(60);
      }
      break;
    }
    default:
      break;
  }
}

static void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println(F("\n[mqtt-test] boot"));

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  WiFi.mode(WIFI_STA);
  delay(100);

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

  esp_mqtt_client_config_t mqtt_cfg = {};
  mqtt_cfg.broker.address.uri = MQTT_URI;
  mqtt_cfg.credentials.client_id = MQTT_CLIENT_ID;
  mqtt_cfg.session.last_will.topic = TOPIC_STATUS;
  mqtt_cfg.session.last_will.msg = "offline";
  mqtt_cfg.session.last_will.qos = 0;
  mqtt_cfg.session.last_will.retain = true;

  mqttClient = esp_mqtt_client_init(&mqtt_cfg);
  esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventHandler, NULL);
  esp_mqtt_client_start(mqttClient);

  bootMs = millis();
}

extern "C" void app_main(void) {
  initArduino();
  setup();

  while (true) {
    unsigned long now = millis();

    if (WiFi.status() != WL_CONNECTED) {
      if (now - lastWifiRetry >= 5000) {
        lastWifiRetry = now;
        Serial.printf("[wifi] connecting to \"%s\" ... status=%d\n", WIFI_SSID, WiFi.status());
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
      if (now - lastBlink >= 150) {          // blink cepat = belum konek wifi
        lastBlink = now;
        ledState = !ledState;
        digitalWrite(LED_BUILTIN, ledState);
      }
    } else if (!mqttOk) {
      if (now - lastBlink >= 400) {          // blink sedang = wifi ok, mqtt belum
        lastBlink = now;
        ledState = !ledState;
        digitalWrite(LED_BUILTIN, ledState);
      }
    } else if (now - lastHeartbeat >= 2000) {
      lastHeartbeat = now;
      char buf[96];
      int n = snprintf(buf, sizeof(buf),
                       "{\"seq\":%u,\"uptimeSec\":%lu,\"rssi\":%d}",
                       heartbeatSeq++, (now - bootMs) / 1000, WiFi.RSSI());
      esp_mqtt_client_publish(mqttClient, TOPIC_HEARTBEAT, buf, n, 0, false);
      Serial.printf("[tx] %s %s\n", TOPIC_HEARTBEAT, buf);
    }

    delay(10);
  }
}
```

- [ ] **Step 5: Build and resolve the known `esp_insights` path bug**

```bash
cd firmware/mqtt_test
git add -A   # idf-component-manager's CMake integration requires the project dir to be inside a committed git tree
pio run
```

This will very likely fail with the exact same error found during the design spike: `arduino-esp32`'s `idf_component.yml` unconditionally depends on `espressif/esp_insights` for the `esp32` target, and that component's `target_add_binary_data("server_certs/https_server.crt", ...)` (or `mqtt_server.crt` if `CONFIG_ESP_INSIGHTS_TRANSPORT_MQTT=y`) resolves to a doubled, nonexistent path under PlatformIO (`.pio/build/esp32dev/.pio/build/esp32dev/https_server.crt.S`), even though the source `.crt` file exists inside the fetched component.

Try, in order, until one produces a clean build:

1. **Build with `idf.py` directly instead of PlatformIO's `pio run`**, to confirm whether the bug is specific to PlatformIO's wrapper:
   ```bash
   . $IDF_PATH/export.sh   # IDF_PATH is wherever framework-espidf was installed, e.g. /home/wafdan/.platformio/packages/framework-espidf
   idf.py -C firmware/mqtt_test/.pio/build/esp32dev build   # or set up a proper idf.py project dir if PlatformIO's generated one isn't directly usable
   ```
   If this succeeds, the fix is to document (in this task's report and Task 4's README) that this project must be built via `idf.py`, not `pio run` — update `platformio.ini`'s header comment accordingly and move on.
2. **If `idf.py` hits the same bug**, look for a way to exclude `espressif/esp_insights` from the dependency graph entirely (the firmware never uses ESP Insights/RainMaker) — check whether the IDF Component Manager supports a project-level override or exclusion for a transitive dependency (search `idf-component-manager`'s own docs/CHANGELOG for "exclude" or "override" — this was not investigated during the design spike).
3. **If neither resolves it**, manually pre-create the two expected `.S` files at the exact broken path the error names, as a build-time workaround, and note this as a real, load-bearing wart to flag to the human partner rather than silently accepting — this is the least clean option and should not be the first thing tried.

- [ ] **Step 6: Verify the build succeeds and inspect the binary**

```bash
cd firmware/mqtt_test
pio run
```

Expected: `[SUCCESS]`, with a `.pio/build/esp32dev/firmware.bin` produced. Run `pio run -t size` and confirm no errors — this is the full pass/fail bar for this task (no hardware to flash).

- [ ] **Step 7: Commit**

```bash
git add firmware/mqtt_test/
git commit -m "feat(firmware): port mqtt_test to esp_mqtt_client over WebSocket, ESP-IDF+arduino-component build"
```

---

### Task 2: Verify Mosquitto's WebSocket URI/path against the real local broker

**Files:**
- Modify: `firmware/pelletq_esp32/README.md:1-30` (the transport note added during the Cloudflare Tunnel migration) — replace the "to confirm" language with the actual confirmed URI shape once this task's test succeeds.

**Interfaces:**
- Produces: the confirmed `MQTT_URI` value/path convention that Task 3's `secrets.h` and firmware README use. If Mosquitto turns out to require a specific path (e.g. `/mqtt`) rather than accepting any path, that exact value must be documented here for Task 3 to use verbatim.

- [ ] **Step 1: Bring up the project's Mosquitto container**

```bash
cd /home/wafdan/projects/PKM/PelletQ-AI
docker compose up -d mosquitto
docker compose ps mosquitto   # confirm it's running
```

- [ ] **Step 2: Confirm the container's WS listener config**

```bash
grep -A3 "listener 9001" mosquitto/config/mosquitto.conf
```

Expected: `listener 9001` followed by `protocol websockets`, `allow_anonymous false`, `password_file /mosquitto/config/passwd` (this was already confirmed present during the production-deployment work — this step is a sanity check, not new discovery).

- [ ] **Step 3: Attempt a real WebSocket MQTT connection from the dev machine**

```bash
docker run --rm --network host eclipse-mosquitto:2 \
  mosquitto_pub -h 127.0.0.1 -p 9001 -t 'pelletq/test/spike' -m 'hello' \
  -u <username-from-mosquitto-passwd> -P <matching-password> \
  --transport websockets -d
```

(Use the same username/password already set up in `mosquitto/config/passwd` from earlier production-deployment work — check `mosquitto/config/passwd` exists; if not, this project has no MQTT credentials configured yet and this step should create one first via the `mosquitto_passwd` command already documented in `firmware/pelletq_esp32/README.md`.)

Try it first with no path (`-h 127.0.0.1 -p 9001`, which is what the command above does), then, only if that fails, retry with an explicit path by adding `--transport-arg` or an equivalent flag pointing at `/mqtt` — the design spec's hypothesis is that a native `protocol websockets` listener does not do path-based routing at all, so the no-path case is expected to succeed.

- [ ] **Step 4: Record the result**

Document the outcome directly in `firmware/pelletq_esp32/README.md`'s transport section: replace the sentence "Detail library MQTT... nilai koneksi di bawah adalah target akhir, bukan kode yang sudah diuji" (added during the Cloudflare Tunnel migration) with a factual statement of what path/URI actually worked, e.g. "Dikonfirmasi: listener 9001 menerima koneksi WebSocket tanpa memerlukan path tertentu — `ws://<host>:9001` cukup."

- [ ] **Step 5: Commit**

```bash
git add firmware/pelletq_esp32/README.md
git commit -m "docs(firmware): confirm Mosquitto WebSocket listener accepts connections with no path requirement"
```

(Adjust the commit message if Step 3 found a path IS required — state the actual finding either way, don't leave the commit message asserting something Step 3 didn't confirm.)

---

### Task 3: Port the full pelletq_esp32 sketch to the validated ESP-IDF + WebSocket-MQTT structure

**Files:**
- Create: `firmware/pelletq_esp32/platformio.ini`
- Create: `firmware/pelletq_esp32/sdkconfig.defaults`
- Create: `firmware/pelletq_esp32/src/idf_component.yml`
- Create: `firmware/pelletq_esp32/src/pelletq_esp32.cpp` (recovered from `e799f00:firmware/pelletq_esp32/pelletq_esp32.ino`, then the MQTT layer edited per Step 3 below)
- Create: `firmware/pelletq_esp32/src/secrets.h.example` (recovered from `e799f00` if it exists there; if not, write one matching the `#define`s the ported file expects)
- Do not restore: `firmware/pelletq_esp32/ca_cert.h` — no longer needed (see design spec: Cloudflare's edge uses a standard publicly-trusted CA, no pinning required for `ws://` in this local-test task; `wss://` CA trust is a follow-up check once the tunnel is live, out of scope here).

**Interfaces:**
- Consumes: the `platformio.ini`/`sdkconfig.defaults`/`idf_component.yml` pattern validated in Task 1 (same platform pin, same `arduino-esp32@3.2.0` pin, same `CONFIG_FREERTOS_HZ=1000`, and whatever fix Task 1 Step 5 landed on for the `esp_insights` path bug — apply the identical fix here, don't re-derive it). The confirmed `MQTT_URI` shape from Task 2.
- Produces: nothing consumed by a later task in this plan — Task 4 only needs this task's final file list and README-relevant facts (e.g. whether `idf.py` or `pio run` is the build command).

- [ ] **Step 1: Recover the sketch and its example secrets file verbatim**

```bash
cd /home/wafdan/projects/PKM/PelletQ-AI
mkdir -p firmware/pelletq_esp32/src
git show e799f00:firmware/pelletq_esp32/pelletq_esp32.ino > firmware/pelletq_esp32/src/pelletq_esp32.cpp
git show e799f00:firmware/pelletq_esp32/secrets.h.example > firmware/pelletq_esp32/src/secrets.h.example 2>/dev/null || echo "no secrets.h.example at e799f00 - check an earlier commit with: git log --all -- firmware/pelletq_esp32/secrets.h.example"
```

If the second command's fallback message prints, find the right commit (`git log --all --oneline -- firmware/pelletq_esp32/secrets.h.example`) and recover from there instead — do not fabricate the file's contents from scratch, since the real one may document additional variables (e.g. it may already show `MQTT_USERNAME`/`MQTT_PASSWORD` placeholders that must stay consistent with what Step 3 below expects).

- [ ] **Step 2: Write `firmware/pelletq_esp32/platformio.ini`**

```ini
; ============================================================================
; PelletQ-AI ESP32 Hopper Gate Controller — PlatformIO build config
; ============================================================================
;   cd firmware/pelletq_esp32
;   pio run -t upload && pio device monitor
; ESP-IDF primary framework; arduino-esp32 pulled in as an IDF component
; (see src/idf_component.yml). MQTT uses ESP-IDF's esp_mqtt_client over
; WebSocket (see README.md) instead of PubSubClient/raw TLS.
;
; Semua konfigurasi TFT_eSPI di-inject lewat build_flags di bawah, jadi TIDAK
; perlu mengedit User_Setup.h di folder library sama sekali.
; ============================================================================

[env:esp32dev]
platform      = https://github.com/pioarduino/platform-espressif32/releases/download/54.03.20/platform-espressif32.zip
board         = esp32dev
framework     = espidf
monitor_speed = 115200

lib_deps =
    bodmer/TFT_eSPI@^2.5.43
    madhephaestus/ESP32Servo@^3.0.5
    bblanchon/ArduinoJson@^7.0.4

build_flags =
    -DUSER_SETUP_LOADED=1
    -DILI9488_DRIVER=1
    -DTFT_MOSI=13
    -DTFT_SCLK=18
    -DTFT_CS=5
    -DTFT_DC=2
    -DTFT_RST=4
    -DTFT_MISO=-1
    -DSPI_FREQUENCY=27000000
    -DLOAD_GLCD=1
    -DLOAD_FONT2=1
    -DLOAD_FONT4=1
    -DLOAD_GFXFF=1
```

(Same as the pre-deletion `platformio.ini` at `e799f00`, minus `knolleary/PubSubClient` — replaced by the `mqtt` IDF component declared in `idf_component.yml` below — and with `framework`/`platform` updated to match Task 1's validated recipe.)

- [ ] **Step 3: Write `firmware/pelletq_esp32/sdkconfig.defaults` and `src/idf_component.yml`**

Identical to Task 1's, copied verbatim (same constraint applies: `CONFIG_FREERTOS_HZ=1000`, `arduino-esp32` pinned to `3.2.0`, `mqtt` component declared):

```
CONFIG_FREERTOS_HZ=1000
```

```yaml
dependencies:
  espressif/arduino-esp32:
    version: "3.2.0"
  mqtt:
    version: "*"
```

- [ ] **Step 4: Edit the MQTT connection layer in `src/pelletq_esp32.cpp`**

Remove these lines (the exact ones present in the recovered file):
```cpp
#include <WiFiClientSecure.h>
...
#include <PubSubClient.h>
...
#include "ca_cert.h"
...
WiFiClientSecure wifiClient;
PubSubClient     mqtt(wifiClient);
```

Add, near the top (alongside the other includes):
```cpp
#include "mqtt_client.h"
```

Replace the global `wifiClient`/`mqtt` object declarations with:
```cpp
static esp_mqtt_client_handle_t mqttClient = nullptr;
```

Replace the MQTT section of `setup()` (currently: `wifiClient.setCACert(ROOT_CA); mqtt.setServer(...); mqtt.setBufferSize(1024); mqtt.setCallback(...)`) with:

```cpp
  // MQTT (WebSocket lewat Cloudflare Tunnel — lihat README.md)
  esp_mqtt_client_config_t mqtt_cfg = {};
  mqtt_cfg.broker.address.uri = MQTT_BROKER_URI;   // GANTI di secrets.h: "ws://..." (lokal) atau "wss://..." (produksi)
  mqtt_cfg.credentials.client_id = MQTT_CLIENT_ID;
  mqtt_cfg.credentials.username = MQTT_USERNAME;
  mqtt_cfg.credentials.authentication.password = MQTT_PASSWORD;
  mqtt_cfg.session.last_will.topic = TOPIC_STATUS;
  mqtt_cfg.session.last_will.msg = "offline";
  mqtt_cfg.session.last_will.qos = 0;
  mqtt_cfg.session.last_will.retain = true;
  mqtt_cfg.buffer.size = 1024;

  mqttClient = esp_mqtt_client_init(&mqtt_cfg);
  esp_mqtt_client_register_event(mqttClient, MQTT_EVENT_ANY, mqttEventHandler, NULL);
  esp_mqtt_client_start(mqttClient);
```

Add a new function (placed above `setup()`, since `setup()` now references it only indirectly via `esp_mqtt_client_register_event` — no forward declaration needed if it's defined earlier in the file):

```cpp
static void mqttEventHandler(void* handler_args, esp_event_base_t base,
                              int32_t event_id, void* event_data) {
  esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;
  switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
      mqttOk = true;
      Serial.println(F("[mqtt] connected"));
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
      JsonDocument doc;
      if (deserializeJson(doc, event->data, event->data_len)) break;
      size_t topicLen = event->topic_len;
      if (topicLen == strlen(TOPIC_CONFIG) && strncmp(event->topic, TOPIC_CONFIG, topicLen) == 0) {
        applyConfig(doc);
      } else if (topicLen == strlen(TOPIC_COMMAND) && strncmp(event->topic, TOPIC_COMMAND, topicLen) == 0) {
        const char* action = doc["action"];
        if (action) handleCommand(action);
      } else if (topicLen == strlen(TOPIC_FORMULATION) && strncmp(event->topic, TOPIC_FORMULATION, topicLen) == 0) {
        applyFormulation(doc);
      }
      break;
    }
    default:
      break;
  }
}
```

Replace the body of `handleMqtt()` — it previously drove both WiFi reconnect AND polled `PubSubClient` reconnect/`.loop()`. `esp_mqtt_client` reconnects itself internally once started, so only the WiFi half remains:

```cpp
void handleMqtt() {
  static unsigned long lastRetry = 0;
  static bool wasWifi = false;
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    if (wasWifi) { Serial.println(F("[wifi] disconnected")); wasWifi = false; }
    wifiOk = false;
    mqttOk = false;
    if (now - lastRetry >= 5000) {
      lastRetry = now;
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
  // esp_mqtt_client menjaga reconnect + subscribe ulang sendiri lewat
  // mqttEventHandler — tidak perlu polling manual di sini.
}
```

Update every remaining publish call site to use `esp_mqtt_client_publish` instead of `mqtt.publish`, and every `mqtt.connected()` guard to check the existing `mqttOk` global instead (the global itself already exists in the recovered file — only these guard sites change):
- The `TOPIC_CONFIG_ACK` publish (originally `if (mqtt.connected()) mqtt.publish(TOPIC_CONFIG_ACK, (const uint8_t*)buf, n, false);`) becomes `if (mqttOk) esp_mqtt_client_publish(mqttClient, TOPIC_CONFIG_ACK, buf, n, 0, false);`
- `publishTelemetry()`'s guard (`if (!mqtt.connected()) return;`) becomes `if (!mqttOk) return;`, and its publish call becomes `esp_mqtt_client_publish(mqttClient, TOPIC_TELEMETRY, buf, n, 0, false);`
- `publishEvent()`'s guard and publish call change the same way, for `TOPIC_EVENT`.

Finally, replace the file's `void setup() { ... }` / `void loop() { ... }` Arduino entry points with an ESP-IDF native entry point wrapping them (keep `setup()`'s body and `loop()`'s body completely unchanged — only how they're invoked changes):

```cpp
extern "C" void app_main(void) {
  initArduino();
  setup();
  while (true) {
    loop();
    delay(1);   // yield to other FreeRTOS tasks (esp_mqtt_client's included)
  }
}
```

- [ ] **Step 5: Build**

```bash
cd firmware/pelletq_esp32
git add -A
pio run
```

If this hits the `esp_insights` path bug again, apply the exact fix Task 1 Step 5 landed on — do not re-diagnose it from scratch. If it instead fails on `TFT_eSPI`, `ESP32Servo`, or `ArduinoJson` failing to build under this project structure (not verified during the design spike — flagged there as a real open risk), treat that as a new, real finding: read the actual compiler error, and fix it as narrowly as possible (e.g. a missing build flag, an include path issue) without touching the hardware-facing logic in `pelletq_esp32.cpp`. If a library is fundamentally incompatible with this structure and no narrow fix exists, stop and report back rather than working around it by weakening the build.

- [ ] **Step 6: Verify the build succeeds**

```bash
pio run -t size
```

Expected: `[SUCCESS]`, `firmware.bin` produced, no errors. This is the full pass/fail bar (no hardware to flash).

- [ ] **Step 7: Commit**

```bash
git add firmware/pelletq_esp32/
git commit -m "feat(firmware): port pelletq_esp32 to esp_mqtt_client over WebSocket, ESP-IDF+arduino-component build"
```

---

### Task 4: Update the firmware README with the final validated setup

**Files:**
- Modify: `firmware/pelletq_esp32/README.md` (the whole file — it currently documents the pre-migration Caddy/8883 flow with an inline "pending decision" note added during the Cloudflare Tunnel work; both are now stale)

**Interfaces:**
- Consumes: Task 2's confirmed WS URI/path finding, Task 3's final file list and build command (`pio run` vs `idf.py`, whichever Task 1 Step 5 settled on).

- [ ] **Step 1: Rewrite the credentials/connection section**

Replace the current `## Kredensial produksi` section's code block and surrounding prose with the real, final connection config shape (adjust the exact field names/values to match whatever Task 3 actually implemented — this is illustrative of the required content, not to be copied blindly if Task 3's code diverged):

```cpp
#define WIFI_SSID          "GANTI_SSID"
#define WIFI_PASSWORD      "GANTI_PASSWORD"
#define MQTT_BROKER_URI    "wss://mqtt.yourdomain.com"   // GANTI: domain MQTT_DOMAIN produksi
#define MQTT_CLIENT_ID     "pelletq-esp32"
#define MQTT_USERNAME      "GANTI_USERNAME"
#define MQTT_PASSWORD      "GANTI_PASSWORD"
```

Remove the paragraph about pinning `ca_cert.h` for TLS — no longer applicable (Cloudflare's edge uses a standard publicly-trusted CA). Remove the "Transport berubah, firmware belum diimplementasikan ulang" warning block entirely — the firmware now *is* implemented against the new transport.

- [ ] **Step 2: Rewrite "Menyiapkan broker"**

Update the numbered steps to match Task 3's final build: mention `idf_component.yml`/`sdkconfig.defaults` if a reader needs to know about them (they generally don't, unless modifying the project), keep the `mosquitto_passwd` step (unchanged, still needed), remove the `scripts/sync-mqtt-cert.sh` reference (already removed from README.md/docs/DEPLOYMENT.md in the Cloudflare Tunnel migration — this file was the last one still referencing it), and add the build/flash command:

```bash
cd firmware/pelletq_esp32
pio run -t upload && pio device monitor
```

(Replace with the `idf.py` equivalent if that's what Task 1/3 settled on instead.)

- [ ] **Step 3: Leave "Topik MQTT" unchanged**

No edits — this table was accurate before this plan and remains accurate; it documents the topic contract, not the transport.

- [ ] **Step 4: Commit**

```bash
git add firmware/pelletq_esp32/README.md
git commit -m "docs(firmware): document the final ESP-IDF + WebSocket MQTT setup"
```
