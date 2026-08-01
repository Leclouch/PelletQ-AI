# Formulation → ESP32 MQTT Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a formulation is generated, publish its per-batch ingredient list (name + kg) and batch-repeat count to MQTT, retained, so the ESP32 can show the operator exactly what to load into the mixer — "Batch 2/4", "Tepung Ikan 1.5kg" — on its TFT while idle.

**Architecture:** `/api/formulation` already computes `resepPerBatch` (per-batch ingredient amounts) and the pieces of `batchInfo` — this plan reshapes that into a small MQTT payload and publishes it via a new singleton MQTT client (`src/lib/mqtt.ts`, same pattern as the existing Prisma singleton). The ESP32 subscribes to the new retained topic, stores it in a fixed-size struct array (no `String`/heap churn), advances a `currentBatch` counter on its existing `CYCLE_COMPLETE` transitions, and renders it only while `ST_IDLE` — the busy states (`HEATING`/`MIXING`/`DISPENSING`) are untouched.

**Tech Stack:** Next.js API route (TypeScript) + `mqtt` npm package for the publisher; Arduino/C++ (`PubSubClient`, `ArduinoJson` v7 — both already firmware dependencies) for the receiver/display.

## Global Constraints

- New MQTT topic `pelletq/formulation`, retained, backend → device only (no ack topic, unlike `pelletq/config`).
- Payload shape is fixed: `{ batchSizeKg, totalBatches, lastBatchKg, ingredients: [{ name, kg }] }`. `ingredients[].kg` are **full-batch** amounts — the ESP32 scales them for the final partial batch itself (`kg * lastBatchKg / batchSizeKg`), the backend never sends a second scaled list.
- Backend MQTT publish failures must be logged only — they must never turn a successful formulation into an HTTP error response.
- Firmware: no `String`/dynamic allocation for the new data. Fixed struct array, `MAX_INGREDIENTS = 12`, ingredient name buffer `char[20]` (truncate longer names, don't crash or overflow).
- The ingredient/batch display only renders while `state == ST_IDLE`. No layout changes to `HEATING`/`MIXING`/`DISPENSING`/`ABORTED`.
- Do not change the `pelletq/config` or `pelletq/command` topic schemas, or `Config` struct fields.
- **No automated test framework exists in this repo** (`package.json` has no `test` script, no Jest/Vitest; firmware is Arduino, hardware-in-the-loop only). Verification is manual per task: `mosquitto_sub`/`curl`/`test/test-formulation.sh` for the backend, Serial Monitor bench commands for firmware — matching the existing conventions in `test/test-formulation.sh` and `docs/superpowers/specs/2026-07-30-esp32-serial-bench-test-design.md`.
- Reference spec: `docs/superpowers/specs/2026-08-01-formulation-mqtt-display-design.md`.

---

### Task 1: Backend MQTT publisher singleton

**Files:**
- Create: `src/lib/mqtt.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (via `pnpm add`)

**Interfaces:**
- Produces: `publishRetained(topic: string, payload: unknown): Promise<void>` — Task 2 calls this directly.

- [ ] **Step 1: Install the `mqtt` package**

```bash
pnpm add mqtt
```

- [ ] **Step 2: Write the singleton client**

Create `src/lib/mqtt.ts`:

```ts
import mqtt, { MqttClient } from "mqtt";

const globalForMqtt = globalThis as unknown as {
  mqttClient: MqttClient | undefined;
};

function createMqttClient(): MqttClient {
  const url = process.env.MQTT_BROKER_URL;
  if (!url) throw new Error("MQTT_BROKER_URL belum di-set.");
  return mqtt.connect(url, { reconnectPeriod: 5000 });
}

export const mqttClient = globalForMqtt.mqttClient ?? createMqttClient();

if (process.env.NODE_ENV !== "production") {
  globalForMqtt.mqttClient = mqttClient;
}

export function publishRetained(topic: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    mqttClient.publish(
      topic,
      JSON.stringify(payload),
      { retain: true, qos: 0 },
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}
```

This mirrors `src/lib/prisma.ts`'s global-caching pattern (avoids reconnecting on every Next.js dev hot-reload). `mqtt.connect()` returns immediately and queues outgoing publishes internally until the socket is actually up, so callers don't need to wait for a `connect` event before calling `publishRetained`.

- [ ] **Step 3: Verify against a real broker**

Make sure Mosquitto is up:

```bash
docker compose up -d mosquitto
```

In one terminal, listen for the retained message:

```bash
mosquitto_sub -h localhost -t pelletq/formulation/verify -v
```

In another terminal, publish once via the new module directly (bypassing the API route, since it doesn't call this yet):

```bash
MQTT_BROKER_URL=mqtt://localhost:1883 pnpm exec tsx -e "
import('./src/lib/mqtt.ts').then(async (m) => {
  await m.publishRetained('pelletq/formulation/verify', { hello: 'world' });
  console.log('published');
  process.exit(0);
});
"
```

Expected: the `mosquitto_sub` terminal prints `pelletq/formulation/verify {"hello":"world"}` and the publish command exits `0` without hanging.

- [ ] **Step 4: Commit**

```bash
git add src/lib/mqtt.ts package.json pnpm-lock.yaml
git commit -m "feat(backend): add MQTT publisher singleton"
```

---

### Task 2: Publish the formulation on successful generation

**Files:**
- Modify: `src/app/api/formulation/route.ts:1-13` (imports), `src/app/api/formulation/route.ts:330-355` (response building)

**Interfaces:**
- Consumes: `publishRetained(topic: string, payload: unknown): Promise<void>` (Task 1).

- [ ] **Step 1: Import the publisher**

Find the import block at the top of `route.ts`:

```ts
import {
  explainFormulation,
  explainInfeasible,
  type FormulationResult,
  type InfeasibleDiagnostic,
} from "@/lib/gemini-explainer";
```

Add directly after it:

```ts
import { publishRetained } from "@/lib/mqtt";
```

- [ ] **Step 2: Extract `batchInfo` and publish before returning**

Find (around line 330-355):

```ts
    // 7. Response
    const resepPerBatch = lpResult.ingredients.map((ing) => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      persentase: ing.persentase,
      jumlahKg: Math.round((ing.persentase / 100) * batchSizeKg * 1000) / 1000,
    }));

    return NextResponse.json({
      formulationId: formulation.id,
      formulasi: {
        ingredients: lpResult.ingredients,
        totalBiayaRp: lpResult.totalBiayaRp,
        estimasiNutrisi: lpResult.estimasi,
      },
      batchInfo: {
        batchSizeKg,
        jumlahBatchPenuh: Math.floor(targetProduksiKgBatch / BATCH_KG),
        sisaKg: Math.round((targetProduksiKgBatch % BATCH_KG) * 1000) / 1000,
      },
      resepPerBatch,
      validasiSni: validasi,
      parameterMesin: ruleResult.machineParams,
      peringatan: ruleResult.warnings,
      penjelasan,
    });
```

Replace with:

```ts
    // 7. Response
    const resepPerBatch = lpResult.ingredients.map((ing) => ({
      ingredientId: ing.ingredientId,
      name: ing.name,
      persentase: ing.persentase,
      jumlahKg: Math.round((ing.persentase / 100) * batchSizeKg * 1000) / 1000,
    }));

    const batchInfo = {
      batchSizeKg,
      jumlahBatchPenuh: Math.floor(targetProduksiKgBatch / BATCH_KG),
      sisaKg: Math.round((targetProduksiKgBatch % BATCH_KG) * 1000) / 1000,
    };

    // Kirim ke ESP32 via MQTT (retained) — best-effort, tidak boleh
    // menggagalkan response API kalau broker/ESP32 tidak terjangkau.
    try {
      await publishRetained("pelletq/formulation", {
        batchSizeKg: batchInfo.batchSizeKg,
        totalBatches: batchInfo.jumlahBatchPenuh + (batchInfo.sisaKg > 0 ? 1 : 0),
        lastBatchKg: batchInfo.sisaKg,
        ingredients: resepPerBatch.map((r) => ({ name: r.name, kg: r.jumlahKg })),
      });
    } catch (err) {
      console.error("[formulation] MQTT publish gagal:", err);
    }

    return NextResponse.json({
      formulationId: formulation.id,
      formulasi: {
        ingredients: lpResult.ingredients,
        totalBiayaRp: lpResult.totalBiayaRp,
        estimasiNutrisi: lpResult.estimasi,
      },
      batchInfo,
      resepPerBatch,
      validasiSni: validasi,
      parameterMesin: ruleResult.machineParams,
      peringatan: ruleResult.warnings,
      penjelasan,
    });
```

Note the response JSON shape is unchanged (`batchInfo` and `resepPerBatch` still have the same fields) — this is a pure refactor-and-add, not a breaking change to the frontend contract.

- [ ] **Step 3: Type-check**

```bash
pnpm exec tsc --noEmit
```

Expected: no new errors.

- [ ] **Step 4: Verify end-to-end against the running app**

```bash
docker compose up -d mosquitto
mosquitto_sub -h localhost -t pelletq/formulation -v &
pnpm dev &
# wait for dev server to be ready, then:
bash test/test-formulation.sh
```

Expected: the `mosquitto_sub` terminal prints a retained JSON message on `pelletq/formulation` shaped like:
```json
{"batchSizeKg":5,"totalBatches":1,"lastBatchKg":0,"ingredients":[{"name":"...","kg":...}, ...]}
```
(the test script's `targetProduksiKgBatch` is 5, i.e. exactly one batch, so `totalBatches: 1` and `lastBatchKg: 0` is expected for this particular payload).

- [ ] **Step 5: Verify broker-down doesn't break the API**

Stop the broker and re-run the same request:

```bash
docker compose stop mosquitto
bash test/test-formulation.sh
```

Expected: the script still prints `HTTP:200` (or whatever success code it already reports today), and the `pnpm dev` server log shows `[formulation] MQTT publish gagal: ...` rather than the request failing. Restart the broker afterward: `docker compose start mosquitto`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/formulation/route.ts
git commit -m "feat(backend): publish formulation to ESP32 via MQTT on generation"
```

---

### Task 3: Firmware — receive and store the formulation, track batch progress

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:86-95` (MQTT topics), `:100-109` (globals, new section after `Config cfg`), `:151-169` (prototypes), `:207-226` (`setup()` MQTT block), `:405-411` (`updateStateMachine()` DISPENSING completion), `:440-458` (`handleCommand()`)

**Interfaces:**
- Produces: `void applyFormulation(JsonDocument& doc)`, `void advanceBatch()`, globals `formulationIngredients[]`, `ingredientCount`, `batchSizeKg`, `totalBatches`, `lastBatchKg`, `currentBatch`, `bool formulationDirty` — Task 4 (bench command) calls `applyFormulation` directly; Task 5 (display) reads all the globals and clears `formulationDirty`.

- [ ] **Step 1: Add the new topic**

Find (around line 86-95):

```cpp
#define MQTT_CLIENT_ID   "pelletq-esp32"
#define TOPIC_TELEMETRY  "pelletq/telemetry"
#define TOPIC_COMMAND    "pelletq/command"
#define TOPIC_CONFIG     "pelletq/config"
#define TOPIC_CONFIG_ACK "pelletq/config/ack"
#define TOPIC_EVENT      "pelletq/event"
#define TOPIC_STATUS     "pelletq/status"   // LWT retained
```

Add one line:

```cpp
#define MQTT_CLIENT_ID     "pelletq-esp32"
#define TOPIC_TELEMETRY    "pelletq/telemetry"
#define TOPIC_COMMAND      "pelletq/command"
#define TOPIC_CONFIG       "pelletq/config"
#define TOPIC_CONFIG_ACK   "pelletq/config/ack"
#define TOPIC_FORMULATION  "pelletq/formulation"
#define TOPIC_EVENT        "pelletq/event"
#define TOPIC_STATUS       "pelletq/status"   // LWT retained
```

- [ ] **Step 2: Add the formulation data model**

Find the end of the `Config` struct (around line 100-109):

```cpp
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
```

Add a new section directly after it:

```cpp
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
```

- [ ] **Step 3: Add `applyFormulation()` and `advanceBatch()`**

Place these two functions directly after `applyConfig()` (which ends around line 502, right before the `// MQTT` section comment):

```cpp
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
```

- [ ] **Step 4: Subscribe and route the new topic**

Find the MQTT callback in `setup()` (around line 214-223):

```cpp
  mqtt.setBufferSize(512);
  mqtt.setCallback([](char* topic, byte* payload, unsigned int len) {
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) return;   // JSON invalid -> abaikan
    if (strcmp(topic, TOPIC_CONFIG) == 0) {
      applyConfig(doc);
    } else if (strcmp(topic, TOPIC_COMMAND) == 0) {
      const char* action = doc["action"];
      if (action) handleCommand(action);
    }
  });
```

Replace with (buffer bumped from 512 to 1024 — 12 ingredients at up to 19 chars each plus JSON overhead can exceed 512 bytes):

```cpp
  mqtt.setBufferSize(1024);
  mqtt.setCallback([](char* topic, byte* payload, unsigned int len) {
    JsonDocument doc;
    if (deserializeJson(doc, payload, len)) return;   // JSON invalid -> abaikan
    if (strcmp(topic, TOPIC_CONFIG) == 0) {
      applyConfig(doc);
    } else if (strcmp(topic, TOPIC_COMMAND) == 0) {
      const char* action = doc["action"];
      if (action) handleCommand(action);
    } else if (strcmp(topic, TOPIC_FORMULATION) == 0) {
      applyFormulation(doc);
    }
  });
```

Find the subscribe calls a few lines later (around line 543-544):

```cpp
        mqtt.subscribe(TOPIC_CONFIG);        // retained -> config terakhir masuk
        mqtt.subscribe(TOPIC_COMMAND);
```

Add one line:

```cpp
        mqtt.subscribe(TOPIC_CONFIG);        // retained -> config terakhir masuk
        mqtt.subscribe(TOPIC_COMMAND);
        mqtt.subscribe(TOPIC_FORMULATION);   // retained -> formulasi terakhir masuk
```

- [ ] **Step 5: Advance the batch counter on cycle completion**

There are two places a `DISPENSING` cycle completes (normal timeout, and manual `close` override). Both need `advanceBatch()`.

Find in `updateStateMachine()` (around line 405-411):

```cpp
    case ST_DISPENSING:
      if ((long)(dispenseEndMs - now) <= 0) {
        closeHopper();
        publishEvent("CYCLE_COMPLETE");
        enterState(ST_IDLE);
      }
      break;
```

Change to:

```cpp
    case ST_DISPENSING:
      if ((long)(dispenseEndMs - now) <= 0) {
        closeHopper();
        publishEvent("CYCLE_COMPLETE");
        advanceBatch();
        enterState(ST_IDLE);
      }
      break;
```

Find in `handleCommand()` (around line 440-458):

```cpp
  } else if (strcmp(action, "close") == 0) {
    closeHopper();
    if (state == ST_DISPENSING) {   // batalkan sisa timer buka
      publishEvent("CYCLE_COMPLETE");
      enterState(ST_IDLE);
    }
```

Change to:

```cpp
  } else if (strcmp(action, "close") == 0) {
    closeHopper();
    if (state == ST_DISPENSING) {   // batalkan sisa timer buka
      publishEvent("CYCLE_COMPLETE");
      advanceBatch();
      enterState(ST_IDLE);
    }
```

- [ ] **Step 6: Add forward declarations**

Find the prototype block (around line 151-169):

```cpp
void applyConfig(JsonDocument& doc);
void handleCommand(const char* action);
```

Add two lines after `applyConfig`:

```cpp
void applyConfig(JsonDocument& doc);
void applyFormulation(JsonDocument& doc);
void advanceBatch();
void handleCommand(const char* action);
```

- [ ] **Step 7: Read through the diff**

Confirm: `formulationIngredients[]` is sized `MAX_INGREDIENTS` and every write path (`applyFormulation`) bounds-checks `ingredientCount` before writing; `strncpy` always leaves room for and sets the trailing `'\0'` (destination size minus 1, then explicit terminator write); `advanceBatch()` is called on both `CYCLE_COMPLETE` sites, not just one; `mqtt.setBufferSize(1024)` is set before `mqtt.setCallback(...)` (order doesn't actually matter for `PubSubClient`, but keep it adjacent for readability as shown).

- [ ] **Step 8: Bench-verify without display changes yet (log-only)**

Flash, open Serial Monitor @115200. With Mosquitto reachable from the ESP32 and a WiFi connection:

```bash
mosquitto_pub -h <broker-ip> -r -t pelletq/formulation -m '{"batchSizeKg":5,"totalBatches":2,"lastBatchKg":2,"ingredients":[{"name":"Tepung Ikan","kg":1.5},{"name":"Dedak","kg":2.0}]}'
```

Expected serial output: `[formulation] 2 ingridien, batchSizeKg=5.00 totalBatches=2 lastBatchKg=2.00`.

Then bench-drive a full cycle (`start`, `temp 96`, wait for `waitMinutes`/`openSeconds` to elapse — or temporarily lower `cfg.waitMinutes`/`cfg.openSeconds` via a `pelletq/config` publish to speed this up for testing). Expected: `[state] DISPENSING -> IDLE` is followed by `[formulation] batch -> 2/2` in the log.

- [ ] **Step 9: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): receive formulation via MQTT and track batch progress"
```

---

### Task 4: Firmware — bench-test command for the formulation payload

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:47-56` (header doc), `:231-248` (`handleSerialCommand()`)

**Interfaces:**
- Consumes: `applyFormulation(JsonDocument& doc)` (Task 3).

- [ ] **Step 1: Add the bench command to `handleSerialCommand()`**

Find (around line 231-248):

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

Change to:

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
```

- [ ] **Step 2: Document the new command in the file header**

Find (around line 47-56):

```cpp
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

Change to:

```cpp
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
```

- [ ] **Step 3: Read through the diff**

Confirm `line.substring(12)` is the correct offset — `"formulation "` is 12 characters (11 letters + 1 space), matching the same pattern already used for `"temp "` (5 chars) in the existing code.

- [ ] **Step 4: Bench-verify**

Flash, open Serial Monitor @115200, type (no WiFi/broker needed):

```
formulation {"batchSizeKg":5,"totalBatches":2,"lastBatchKg":2,"ingredients":[{"name":"Tepung Ikan","kg":1.5},{"name":"Dedak","kg":2.0}]}
```

Expected: `[serial] cmd: formulation {...}` followed by `[formulation] 2 ingridien, batchSizeKg=5.00 totalBatches=2 lastBatchKg=2.00`.

Also test the error path — type `formulation {not valid json}` and confirm `[serial] formulation JSON tidak valid: ...` prints instead of a crash/reboot.

- [ ] **Step 5: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): add serial bench command for formulation payload"
```

---

### Task 5: Firmware — render batch/ingredients on the IDLE screen

**Files:**
- Modify: `firmware/pelletq_esp32/pelletq_esp32.ino:708-761` (`updateDisplay()` countdown/progress block)

**Interfaces:**
- Consumes: `ingredientCount`, `formulationIngredients[]`, `currentBatch`, `totalBatches`, `batchSizeKg`, `lastBatchKg`, `formulationDirty` (all from Task 3); `full` (existing local in `updateDisplay()`, true when the state just changed).

- [ ] **Step 1: Add the IDLE rendering branch**

Find the end of the `ST_DISPENSING` branch inside `updateDisplay()` (around line 745-760):

```cpp
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
  }
```

Add a new `else if` branch directly after it (still before the `// --- Target aktif` section):

```cpp
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
    tft.fillRect(0, 185, 480, 125, TFT_BLACK);

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
      int maxRows = 5;
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
        tft.drawString(more, 20, rowY);
      }
    }
  }
```

- [ ] **Step 2: Read through the diff**

Confirm: the new branch only fires for `ST_IDLE`, so it can never draw over the `MIXING`/`DISPENSING` widgets; the `tft.fillRect(0, 185, 480, 125, ...)` region (y185–310) sits inside the existing free space between the state-name text (ends ~183) and the banner/target area (banner starts 272, but banner is always 0 during IDLE, and the small target text at y318 is outside this rect) — it does not overlap `updateDisplay()`'s other IDLE-active drawing (temp at 50-130, state name at 138-183, target text at 318); `formulationDirty` is set by `applyFormulation()`/`advanceBatch()` (Task 3) and consumed (reset to `false`) only here, so a new formulation or a batch advance while sitting in IDLE triggers exactly one redraw, not a redraw-every-frame loop.

- [ ] **Step 3: Bench-verify on real hardware**

Flash. With no formulation sent yet, confirm IDLE looks as it did before this change (blank y185-310 area).

Send a formulation via the Task 4 bench command:
```
formulation {"batchSizeKg":5,"totalBatches":2,"lastBatchKg":2,"ingredients":[{"name":"Tepung Ikan","kg":1.5},{"name":"Dedak","kg":2.0},{"name":"Tepung Jagung","kg":1.0}]}
```
Confirm the TFT shows `Batch 1/2` and three ingredient rows with the un-scaled kg values (1.50, 2.00, 1.00).

Run a full cycle (`start`, `temp 96`, wait out `waitMinutes`/`openSeconds`, or lower them via a `pelletq/config` publish first to speed up the bench test). Confirm on return to IDLE the screen shows `Batch 2/2` with each kg value scaled by `2/5 = 0.4` (i.e. 0.60, 0.80, 0.40).

If rows visually overlap or run off-screen on the physical display, adjust `rowY`'s starting value/increment (220 / 18px) — font metrics can vary slightly by build; this is expected tuning, not a logic bug.

- [ ] **Step 4: Commit**

```bash
git add firmware/pelletq_esp32/pelletq_esp32.ino
git commit -m "feat(firmware): show batch progress and ingredient list on IDLE screen"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1+2 cover spec §1 (data flow) and §3 (backend implementation). Task 3 covers spec §2 (payload) and §4 (firmware receiving/storing, including the `CYCLE_COMPLETE` batch-advance hook). Task 4 covers spec §5 (bench-test command). Task 5 covers spec §6 (display). All spec sections have a task.
- **Placeholder scan:** none — every step has literal code or an exact manual command.
- **Type consistency:** `applyFormulation(JsonDocument& doc)` signature in Task 3 matches its two call sites — the MQTT callback (Task 3, Step 4) and the bench command (Task 4, Step 1). `advanceBatch()` (no args) matches both call sites in Task 3, Step 5. Globals (`ingredientCount`, `formulationIngredients[]`, `currentBatch`, `totalBatches`, `batchSizeKg`, `lastBatchKg`, `formulationDirty`) are declared once in Task 3, Step 2 and only read (never redeclared) in Task 5.
- **Ordering:** Task 1 has no dependencies. Task 2 depends on Task 1's `publishRetained`. Task 3 has no dependency on 1/2 (firmware side) and could technically run in parallel, but is sequenced after so the end-to-end MQTT path can be verified once both ends exist. Task 4 depends on Task 3's `applyFormulation`. Task 5 depends on Task 3's globals and is sequenced last since it's the only purely visual, hardware-verification-only piece.
