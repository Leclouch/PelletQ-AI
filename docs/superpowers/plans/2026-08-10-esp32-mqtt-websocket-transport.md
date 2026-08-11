# ESP32 MQTT-over-WebSocket Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the ESP32 firmware and migrate its MQTT transport from Arduino `PubSubClient` over raw TCP/TLS to ESP-IDF `esp-mqtt` over WebSocket, preserving the controller’s existing behavior.

**Architecture:** ESP-IDF owns the PlatformIO application entry point and MQTT client. `initArduino()` preserves the Arduino APIs needed by the existing hardware controller. Each sketch uses a small non-blocking Wi-Fi/MQTT service loop around an `esp_mqtt_client_handle_t`; the IDF MQTT event callback handles connection, subscription, received payloads, and disconnect state.

**Tech Stack:** PlatformIO, ESP-IDF, `espressif/arduino-esp32` 3.2.0, ESP-IDF `esp-mqtt`, Arduino APIs, Mosquitto WebSocket listener.

## Global Constraints

- Recover `pelletq_esp32.ino`, both `platformio.ini` files, and `mqtt_test.ino` from `e799f00`; do not recover `ca_cert.h`.
- Use `framework = espidf`, `CONFIG_FREERTOS_HZ=1000`, and `espressif/arduino-esp32` version `3.2.0`.
- Keep MQTT topics, config schema, state machine, hardware pin map, and bench serial commands unchanged.
- Use a `ws://` URI for the local listener; document the production `wss://` URI and default CA bundle follow-up.
- Verify by compiling both PlatformIO projects and, where Docker is available, publishing and subscribing through Mosquitto’s WebSocket listener. Do not claim hardware or public-tunnel testing.

---

### Task 1: Restore and make the MQTT bench sketch use ESP-IDF WebSockets

**Files:**
- Create: `firmware/mqtt_test/mqtt_test.ino`, `firmware/mqtt_test/platformio.ini`, `firmware/mqtt_test/sdkconfig.defaults`, `firmware/mqtt_test/src/idf_component.yml`

**Interfaces:**
- Consumes: Wi-Fi credentials and `MQTT_URI` constants defined in the sketch.
- Produces: an `app_main()` entry point, event-driven `esp_mqtt_client` connection, retained `pelletq/test/status` LWT, heartbeat publishing, and `pelletq/test/cmd` subscription.

- [ ] **Step 1: Restore the historical bench sketch and config, then run the build to establish the missing-transport baseline.**

Run: `cd firmware/mqtt_test && pio run`

Expected: the historical Arduino-only project is present but cannot satisfy the new ESP-IDF MQTT-WebSocket requirements.

- [ ] **Step 2: Add the ESP-IDF project configuration.**

Set `framework = espidf`, pin the `pioarduino/platform-espressif32` platform, add `sdkconfig.defaults` containing `CONFIG_FREERTOS_HZ=1000`, and declare these dependencies in `src/idf_component.yml`:

```yaml
dependencies:
  espressif/arduino-esp32: "3.2.0"
  espressif/mqtt: "*"
```

- [ ] **Step 3: Replace the `PubSubClient` loop with `esp_mqtt_client`.**

Use `esp_mqtt_client_config_t` with `.broker.address.uri = MQTT_URI`, configure a retained `offline` LWT, start the client after Wi-Fi connects, subscribe/publish `online` in `MQTT_EVENT_CONNECTED`, echo command data in `MQTT_EVENT_DATA`, and publish the existing heartbeat JSON only when connected.

- [ ] **Step 4: Compile the bench sketch.**

Run: `cd firmware/mqtt_test && pio run`

Expected: exit code 0 and a linked `firmware.elf`.

### Task 2: Verify the local WebSocket listener contract

**Files:**
- Modify: `firmware/pelletq_esp32/README.md`

**Interfaces:**
- Consumes: Mosquitto `listener 9001` with `protocol websockets`.
- Produces: the confirmed local URI shape and repeatable `ws://` pub/sub verification commands.

- [ ] **Step 1: Start Mosquitto locally and use a WebSocket-capable client to publish and subscribe.**

Run: `docker compose up -d mosquitto`, then use an MQTT client configured for WebSockets to subscribe to and publish on `pelletq/test/transport`.

Expected: a subscriber receives the published payload using `ws://127.0.0.1:9001` without an application path.

- [ ] **Step 2: Record the verified transport configuration and the deferred public-TLS check in the firmware README.**

Document `MQTT_URI` as `ws://<local-host>:9001` for local testing and `wss://mqtt.<domain>` for production, with credentials passed to `esp-mqtt`; state that the public Cloudflare endpoint and default CA trust must be checked when the tunnel exists.

### Task 3: Restore the controller and port only its MQTT layer

**Files:**
- Create: `firmware/pelletq_esp32/pelletq_esp32.ino`, `firmware/pelletq_esp32/platformio.ini`, `firmware/pelletq_esp32/sdkconfig.defaults`, `firmware/pelletq_esp32/src/idf_component.yml`, `firmware/pelletq_esp32/secrets.h.example`

**Interfaces:**
- Consumes: the historical Arduino controller APIs, `esp_mqtt_client_handle_t`, and unchanged MQTT topics/payloads.
- Produces: the original state machine and hardware behavior with an ESP-IDF WebSocket MQTT adapter.

- [ ] **Step 1: Restore the historical controller files without `ca_cert.h`, then build to verify the old raw-TCP dependencies are gone from the current repository.**

Run: `cd firmware/pelletq_esp32 && pio run`

Expected: the initial historical sketch cannot be the final WebSocket transport implementation.

- [ ] **Step 2: Add ESP-IDF configuration while retaining TFT, servo, and JSON dependencies.**

Use the same framework, platform pin, component manifest, and FreeRTOS tick-rate configuration as Task 1. Keep the existing TFT build flags and library dependencies, omitting `PubSubClient`.

- [ ] **Step 3: Replace `WiFiClientSecure` and `PubSubClient` with an event-driven ESP-IDF adapter.**

Keep all topics and handlers. Convert received MQTT payloads into a bounded, null-terminated buffer before parsing. Publish telemetry/config acknowledgements/events/status via `esp_mqtt_client_publish`; retain the `offline` LWT and subscribe to the existing retained config, command, and formulation topics on connection. Replace `mqtt.loop()` with the non-blocking connection service.

- [ ] **Step 4: Compile the complete controller.**

Run: `cd firmware/pelletq_esp32 && pio run`

Expected: exit code 0 and a linked `firmware.elf` with the TFT, servo, MAX6675, ArduinoJson, Wi-Fi, and ESP-IDF MQTT code together.

- [ ] **Step 5: Add the deferred hardware checklist to the README.**

Include connect/reconnect, retained config/formulation receipt, command handling, heartbeat/telemetry, LWT, and TLS connection checks for the real `wss://` endpoint.

### Task 4: Review and verify the completed migration

**Files:**
- Modify: `docs/superpowers/plans/2026-08-10-esp32-mqtt-websocket-transport.md`

- [ ] **Step 1: Confirm no recovered source includes `PubSubClient`, `WiFiClientSecure`, or `ca_cert.h`.**

Run: `rg -n "PubSubClient|WiFiClientSecure|ca_cert" firmware/mqtt_test firmware/pelletq_esp32`

Expected: no production source matches; README text may only mention the removal where useful.

- [ ] **Step 2: Run both PlatformIO builds and retain their outputs as verification evidence.**

Run: `cd firmware/mqtt_test && pio run`; then `cd ../pelletq_esp32 && pio run`

Expected: both commands exit 0.

- [ ] **Step 3: Review scope and working tree.**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; only the planned firmware, documentation, and pre-existing user changes are present.
