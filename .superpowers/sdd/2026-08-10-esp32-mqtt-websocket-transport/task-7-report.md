# Task 7 Report: ESP-IDF 5.4 MQTT Header

## Change

Replaced `#include <esp_mqtt_client.h>` with `#include <mqtt_client.h>` in:

- `firmware/mqtt_test/mqtt_test.ino`
- `firmware/pelletq_esp32/pelletq_esp32.ino`

No MQTT API symbols, handlers, configuration, manifests, or other source lines were changed.

## Verification

- `git diff --check` completed successfully.
- Both sketches contain `#include <mqtt_client.h>`.
- Neither sketch contains `#include <esp_mqtt_client.h>`.
- Both sketches retain their `esp_mqtt_client_*` API symbols.
- No build was run, as required by the task brief.
