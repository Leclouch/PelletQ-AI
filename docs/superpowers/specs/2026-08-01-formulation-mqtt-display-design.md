# Formulation → ESP32 MQTT Display — Design

## Purpose
Show the operator what to load into the mixer directly on the ESP32's TFT —
ingredient names and kg amounts for the current batch, plus which batch (of
how many repeats) is in progress — instead of requiring them to read the
formulation off the website while standing at the machine.

## Scope
- New backend module: MQTT publisher (`src/lib/mqtt.ts`).
- `src/app/api/formulation/route.ts`: publish the already-computed
  `resepPerBatch` / `batchInfo` after a successful formulation.
- `firmware/pelletq_esp32/pelletq_esp32.ino`: subscribe to the new topic,
  store the formulation, track batch progression, render it on the IDLE
  screen.
- New npm dependency: `mqtt`.

Out of scope: dashboard/manual-mode UI changes, historical formulation
browsing on-device, touch/scroll input, changes to the existing
`pelletq/config` or `pelletq/command` schemas.

## Design

### 1. Data flow
`POST /api/formulation` already computes, per successful request
(`route.ts:331-350`):
- `resepPerBatch`: ingredient list scaled to **one full batch**
  (`{ ingredientId, nama, jumlahKg, ... }`, batch size = `min(target,
  BATCH_KG)`).
- `batchInfo`: `{ batchSizeKg, jumlahBatchPenuh, sisaKg }`.

After the formulation is saved to the DB and the HTTP response body is
built, publish this to MQTT topic **`pelletq/formulation`**, retained.
Publish failure (broker unreachable, no ESP32 listening) is logged and does
**not** fail the request — MQTT delivery is a best-effort convenience on top
of the existing "mode manual" dashboard fallback, not a requirement for the
website flow to succeed.

### 2. MQTT payload
```json
{
  "batchSizeKg": 5,
  "totalBatches": 4,
  "lastBatchKg": 0,
  "ingredients": [
    { "name": "Tepung Ikan", "kg": 1.5 },
    { "name": "Dedak", "kg": 2.0 }
  ]
}
```
- `ingredients[].kg` are amounts for one **full** batch (`batchSizeKg`
  total).
- `totalBatches` = `jumlahBatchPenuh + (sisaKg > 0 ? 1 : 0)`.
- `lastBatchKg` = `sisaKg` when production doesn't divide evenly into
  `BATCH_KG`-sized batches, otherwise `0`. The ESP32 derives the scaled
  final-batch amounts itself (`kg * lastBatchKg / batchSizeKg`) rather than
  the backend sending a second ingredient list — mirrors the scaling already
  done client-side in `ResultScreen.tsx:15-16`.
- New topic rather than folding into `pelletq/config`: config is
  machine-behavior params with an ack round-trip; this is read-only display
  data with a different shape and no ack.

### 3. Backend implementation
- `src/lib/mqtt.ts`: singleton client (same pattern as `src/lib/prisma.ts`),
  connects once to `MQTT_BROKER_URL` (already in `.env.example`), exposes a
  `publish(topic, payload, opts)` helper. Connection is lazy (first publish
  call) and reused for the life of the process.
- `route.ts`: after building the response payload, call the publisher with
  the `pelletq/formulation` topic, `retain: true`. Wrapped in try/catch;
  errors are `console.error`-logged only.

### 4. Firmware — receiving & storing
- `#define TOPIC_FORMULATION "pelletq/formulation"`, subscribed in the
  existing MQTT connect/subscribe block alongside `TOPIC_COMMAND` /
  `TOPIC_CONFIG`.
- Fixed-size storage (no `String`, to avoid heap fragmentation, consistent
  with the rest of the firmware):
  ```cpp
  #define MAX_INGREDIENTS 12
  struct Ingredient { char name[20]; float kg; };
  Ingredient formulationIngredients[MAX_INGREDIENTS];
  int   ingredientCount = 0;
  float batchSizeKg     = 0;
  int   totalBatches    = 0;
  float lastBatchKg     = 0;
  int   currentBatch    = 1;
  ```
- On receipt of a `pelletq/formulation` message: parse into the struct
  array (names truncated to 19 chars + NUL if longer; extra ingredients
  beyond `MAX_INGREDIENTS` are dropped with a serial warning), set
  `batchSizeKg`/`totalBatches`/`lastBatchKg`, and reset `currentBatch = 1`.
- `currentBatch` increments (capped at `totalBatches`) in the existing
  `CYCLE_COMPLETE` path — `ST_DISPENSING`'s completion, right before
  `enterState(ST_IDLE)` (`pelletq_esp32.ino:405-410`). This is the point
  where a physical batch cycle has actually finished and the operator would
  reload the mixer for the next repeat.

### 5. Firmware — bench-test command
Extend the existing Serial bench-test interface (no WiFi/MQTT needed) with
one more command so the new screen can be tested standalone:
- `formulation <json>` — feeds the same payload shape as the MQTT topic
  through the same parse/store path, for testing without a broker running.

### 6. Display
- Only rendered while `state == ST_IDLE` — during `HEATING` / `MIXING` /
  `DISPENSING` the screen keeps its current layout (temp, countdown,
  progress bar); the ingredient list isn't relevant mid-cycle and there's no
  room for it alongside the existing widgets.
- IDLE screen shows, replacing today's mostly-empty IDLE view:
  - `Batch <currentBatch>/<totalBatches>`
  - Up to `MAX_INGREDIENTS` rows of `<name>  <kg>kg`, using the scaled
    amount (`kg * lastBatchKg / batchSizeKg`) when
    `currentBatch == totalBatches && lastBatchKg > 0`, otherwise the raw
    per-batch `kg`.
  - WiFi/MQTT status dots stay in the header as today.
- If no formulation has been received yet (boot default,
  `ingredientCount == 0`), IDLE falls back to today's blank state — no
  crash/placeholder text needed beyond that.

## Testing
Manual, via Serial Monitor @115200 (per existing bench-test pattern):
1. Boot with no formulation sent — confirm IDLE looks as it does today.
2. Send `formulation {...}` with a 3-4 ingredient payload,
   `totalBatches: 2`, `lastBatchKg: 0` — confirm IDLE shows
   `Batch 1/2` and correct per-batch kg values.
3. Type `start`, `temp 96` to run the cycle to completion — confirm on
   return to IDLE the screen shows `Batch 2/2` with the same kg values
   (full batch, since `lastBatchKg` is 0).
4. Repeat with a payload where `lastBatchKg > 0` (e.g. `totalBatches: 2`,
   `batchSizeKg: 5`, `lastBatchKg: 2`) — confirm batch 2's displayed kg
   values are the batch-1 values × 0.4.
5. Send a new `formulation` payload mid-run — confirm `currentBatch` resets
   to 1 and the new ingredient list replaces the old one.
6. Backend: run `test/test-formulation.sh` (or equivalent POST) against a
   running Mosquitto broker with `mosquitto_sub -t pelletq/formulation -v`
   listening — confirm the retained message arrives with the expected
   shape, and that a broker-down scenario still returns HTTP 200 from the
   API (publish failure doesn't break the response).
