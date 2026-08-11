# Task 8 Report

Implemented the ESP-IDF MQTT event sentinel cast in both required registration calls:

- `firmware/mqtt_test/mqtt_test.ino`
- `firmware/pelletq_esp32/pelletq_esp32.ino`

Verification completed:

- `git diff --check` passed.
- Static assertion found exactly two registrations using `static_cast<esp_mqtt_event_id_t>(ESP_EVENT_ANY_ID)`.

No build or dependency download was run, as directed.
