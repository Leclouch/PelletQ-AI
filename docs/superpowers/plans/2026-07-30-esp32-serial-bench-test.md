# ESP32 Serial Bench-Test Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `pelletq_esp32.ino` be driven and observed entirely over Serial, so the full IDLE→HEATING→MIXING→DISPENSING state machine can be bench-tested without a reachable MQTT broker and without physically heating the thermocouple.

**Architecture:** A serial line reader in `loop()` parses one command per line and either calls the existing `handleCommand()` (for `start`/`open`/`close`/`reset`, identical to the MQTT path) or a new bench-only `temp <value>` / `temp auto` override that short-circuits `readTemperature()`. Debug logging is added at the three points that currently have none: state transitions, servo moves, and serial command receipt.

**Tech Stack:** Arduino/C++ (ESP32 core), single `.ino` file, no new libraries.

## Global Constraints
- Single file only: `firmware/pelletq_esp32/pelletq_esp32.ino`. No new files, no new `lib_deps` in `platformio.ini`.
- The `temp` override command must NOT be reachable via MQTT (`applyConfig`/`handleCommand` from the MQTT callback) — serial-only, so it can never leak into a real demo run.
- Do not change the MQTT command vocabulary, telemetry JSON shape, or `Config` struct fields.
- **No automated build/test tooling is available in this environment** — the PlatformIO CLI installed here (`pio`, v4.3.4) is broken (`AttributeError: 'PlatformioCLI' object has no attribute 'resultcallback'`), unrelated to this change and out of scope to fix. Verification per task is: (a) careful manual read-through of the diff for syntax/logic correctness, since there's no compiler to catch mistakes, and (b) the end-to-end manual bench checklist from the spec (`docs/superpowers/specs/2026-07-30-esp32-serial-bench-test-design.md`), which requires the physical ESP32 and is run by the user after flashing, not by the implementer.

---

### Task 1: Manual temperature override

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:115-120` (sensor globals), `firmware/pelletq_esp32/pelletq_esp32.ino:253-273` (`readTemperature()`)

**Interfaces:**
- Produces: `bool tempOverrideActive` (global), `void setTempOverride(float v)`, `void clearTempOverride()` — Task 3's serial parser calls these two functions directly.

- [ ] **Step 1: Add the override flag next to the existing sensor globals**

In `pelletq_esp32.ino`, find this block (around line 115-120):

```cpp
// Sensor
float tempC        = 0.0f;
bool  tcOpen       = false;          // thermocouple lepas
float tempSamples[5] = {0};
int   sampleIdx    = 0;
int   sampleCount  = 0;
```

Add one line after `tcOpen`:

```cpp
// Sensor
float tempC        = 0.0f;
bool  tcOpen       = false;          // thermocouple lepas
bool  tempOverrideActive = false;    // true = tempC dikunci manual via serial "temp <v>"
float tempSamples[5] = {0};
int   sampleIdx    = 0;
int   sampleCount  = 0;
```

- [ ] **Step 2: Short-circuit `readTemperature()` when the override is active**

Find `readTemperature()` (around line 253-273):

```cpp
void readTemperature() {
  uint16_t raw = readMax6675Raw();
```

Change to:

```cpp
void readTemperature() {
  if (tempOverrideActive) return;    // suhu dikunci manual, jangan baca sensor

  uint16_t raw = readMax6675Raw();
```

- [ ] **Step 3: Add the two override control functions**

Place these directly after `readTemperature()` (after its closing brace, before the `// STATE MACHINE` section comment):

```cpp
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
```

- [ ] **Step 4: Add forward declarations**

Find the prototype block (around line 143-154):

```cpp
uint16_t readMax6675Raw();
void readTemperature();
```

Add two lines after `readTemperature();`:

```cpp
uint16_t readMax6675Raw();
void readTemperature();
void setTempOverride(float v);
void clearTempOverride();
```

- [ ] **Step 5: Read through the diff**

Confirm: `tempOverrideActive` starts `false` (so boot behavior is unchanged — real sensor reads happen until a `temp` command is typed), `setTempOverride`/`clearTempOverride` are declared before first use (via the prototypes in Step 4), and `readTemperature()`'s existing moving-average logic below the new early-return is untouched.

- [ ] **Step 6: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): add manual temp override for bench testing"
```

---

### Task 2: Debug logging for state transitions and servo moves

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:278-305` (`enterState()`), `firmware/pelletq_esp32/pelletq_esp32.ino:373-381` (`openHopper()`/`closeHopper()`)

**Interfaces:**
- Consumes: `stateName(State s)` (already defined at pelletq_esp32.ino:540, returns `const char*`).
- Produces: none consumed by later tasks — this is pure logging, no new symbols.

- [ ] **Step 1: Log every state transition in `enterState()`**

Find:

```cpp
void enterState(State s) {
  state = s;
  switch (s) {
```

Change to:

```cpp
void enterState(State s) {
  Serial.printf("[state] %s -> %s\n", stateName(state), stateName(s));
  state = s;
  switch (s) {
```

(`stateName()` is defined later in the file but already forward-declared in the prototype block at line 146, so this compiles fine.)

- [ ] **Step 2: Log servo moves in `openHopper()`/`closeHopper()`**

Find:

```cpp
void openHopper() {
  hopperServo.write(cfg.servoOpenAngle);
  servoStateStr = "OPEN";
}

void closeHopper() {
  hopperServo.write(cfg.servoCloseAngle);
  servoStateStr = "CLOSED";
}
```

Change to:

```cpp
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
```

- [ ] **Step 3: Read through the diff**

Confirm `stateName(state)` is called with the *old* state before the `state = s;` assignment overwrites it — the log line must print `OLD -> NEW`, not `NEW -> NEW`.

- [ ] **Step 4: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): log state transitions and servo moves to serial"
```

---

### Task 3: Serial command parser

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:217-238` (`loop()`)

**Interfaces:**
- Consumes: `handleCommand(const char* action)` (pelletq_esp32.ino:386), `setTempOverride(float v)` and `clearTempOverride()` (from Task 1).
- Produces: none — this is the top-level entry point, nothing downstream depends on it.

- [ ] **Step 1: Add the serial-reading function**

Place this new function directly before `void loop()` (around line 217, right after the `readMax6675Raw();` prototype block or anywhere above `loop()`):

```cpp
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
  } else {
    handleCommand(line.c_str());   // start / open / close / reset
  }
}
```

- [ ] **Step 2: Call it from `loop()`**

Find:

```cpp
void loop() {
  unsigned long now = millis();

  handleMqtt();   // jaga koneksi WiFi/MQTT + mqtt.loop() (non-blocking)
```

Change to:

```cpp
void loop() {
  unsigned long now = millis();

  handleSerialCommand();   // bench-test: start/open/close/reset/temp via Serial
  handleMqtt();   // jaga koneksi WiFi/MQTT + mqtt.loop() (non-blocking)
```

- [ ] **Step 3: Add the forward declaration**

In the prototype block (around line 143-154), add after `void handleMqtt();`:

```cpp
void handleMqtt();
void handleSerialCommand();
```

- [ ] **Step 4: Read through the diff**

Confirm: `handleCommand()` receives the raw trimmed line unchanged for anything that isn't a `temp` command, so `start`/`open`/`close`/`reset` fall through to the existing `strcmp` chain in `handleCommand()` (pelletq_esp32.ino:386-404) exactly as MQTT does. Confirm `"temp "` (5 chars, trailing space) is the correct prefix length for `line.substring(5)` to yield just the number.

- [ ] **Step 5: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): add serial command interface for offline bench testing"
```

---

### Task 4: Document the new commands in the file header

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:1-47` (top header comment)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Add a bench-test section to the header comment**

Find the end of the header comment block:

```cpp
 * ----------------------------------------------------------------------------
 * SHARED SPI BUS — ATURAN KRITIS:
 *   TFT (MOSI13/SCK18) dan MAX6675 (SCK18/SO19) berbagi bus VSPI + SCK GPIO18.
 *   MAX6675 dibaca MANUAL lewat hardware SPI yang sama (lihat readMax6675Raw).
 *   JANGAN pakai library MAX6675 bit-bang (software SPI) — pinMode/digitalWrite
 *   pada GPIO18 akan melepas pin dari peripheral SPI dan merusak TFT.
 * ============================================================================
 */
```

Insert a new section before the closing `====` line:

```cpp
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
 * ============================================================================
 */
```

- [ ] **Step 2: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "docs(firmware): document serial bench-test commands"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers the `temp`/`temp auto` override (spec §1), Task 2 covers debug logging for state/servo (spec §2), Task 3 covers the `start`/`open`/`close`/`reset` mirroring + serial command log (spec §1, §2), Task 4 documents it (implied by spec's testing section needing discoverability). All spec sections have a task.
- **Placeholder scan:** none — every step has literal code.
- **Type consistency:** `setTempOverride(float v)` / `clearTempOverride()` signatures in Task 1 match the calls in Task 3 exactly. `stateName(State s)` return type (`const char*`) matches its use in `Serial.printf("%s", ...)` in Task 2.
- **Ordering:** Tasks are ordered so each only depends on symbols already introduced by an earlier task (Task 3 calls functions from Task 1); Task 2 is independent of Tasks 1/3 and could run in any order relative to them, but is sequenced second since it's smaller.
