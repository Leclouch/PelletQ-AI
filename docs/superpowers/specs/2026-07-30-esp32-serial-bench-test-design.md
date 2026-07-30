# ESP32 Serial Bench-Test Interface — Design

## Purpose
Allow testing `pelletq_esp32.ino`'s full state machine (IDLE → HEATING → MIXING →
DISPENSING) on a bench, without a WiFi/MQTT broker reachable from the device
(e.g. university WiFi with client isolation), and without needing to physically
heat the thermocouple to the real `thresholdTemp` (95°C default).

## Scope
Single file: `firmware/pelletq_esp32/pelletq_esp32.ino`. No new files, no new
library dependencies, no changes to the MQTT command/config schema or
telemetry payload.

## Design

### 1. Serial command interface
- In `loop()`, read a line from `Serial` when available (newline-terminated),
  trim whitespace.
- Commands `start`, `open`, `close`, `reset` are routed through the existing
  `handleCommand(const char* action)` — identical behavior to the MQTT command
  path, just a second entry point.
- One bench-only command, not available over MQTT: `temp <value>`.
  - Sets a manual override so `tempC` reports `<value>` instead of the real
    MAX6675 reading, driven by a `bool tempOverrideActive` flag checked at the
    top of `readTemperature()` — when active, the function returns immediately
    without touching `tempC` or reading the sensor.
  - `temp auto` clears the override and resumes real sensor reads.
  - This lets HEATING→MIXING→DISPENSING be exercised by typing
    `temp 96` instead of applying real heat.

### 2. Debug logging (new)
- `enterState()`: log `[state] <OLD> -> <NEW>` on every transition.
- `openHopper()` / `closeHopper()`: log `[servo] open angle=%d` /
  `[servo] close angle=%d`.
- New serial command handler: log `[serial] cmd: <raw line>` for whatever was
  typed.
- Existing WiFi/MQTT/event logging (pelletq_esp32.ino:453-538) is unchanged —
  it already works offline (`handleMqtt()` returns early without blocking the
  state machine when WiFi/MQTT is down).

## Out of scope
- No changes to MQTT config schema, telemetry JSON, or `applyConfig()`.
- No persistence of the temp override across reboot.
- No new serial commands beyond the four MQTT-mirrored ones + `temp`.

## Testing
Manual, via Serial Monitor @115200:
1. Flash, confirm boot log + TFT shows IDLE, W/M dots red (no WiFi).
2. Type `temp 96` → confirm display shows overridden temp, log shows no
   further real MAX6675 reads.
3. Type `start` → confirm `[state] IDLE -> HEATING` then, since temp already
   ≥ threshold, `[state] HEATING -> MIXING` and a `THRESHOLD_REACHED` event.
4. Type `open` / `close` → confirm `[servo]` logs and TFT servo status update.
5. Type `temp auto` → confirm real MAX6675 reads resume.
6. Type `reset` → confirm return to IDLE.
