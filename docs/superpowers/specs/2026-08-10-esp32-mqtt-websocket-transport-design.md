# ESP32 Firmware: MQTT-over-WebSocket Transport Migration — Design

## Context

PelletQ-AI's production deployment moved from Caddy + direct port-forwarding
(raw MQTT-over-TLS on port 8883) to Cloudflare Tunnel, because the server is
behind CGNAT with no public IP to forward. Cloudflare's free tier proxies
HTTP/WebSocket traffic but not arbitrary raw TCP, so the MQTT broker's public
listener is now WebSocket-based (`mosquitto.conf`'s `listener 9001`,
`protocol websockets`) instead of a raw TLS socket on 8883, which has been
removed.

The ESP32 firmware that talks to this broker is intentionally on a different
network than the server — this is a fish-pellet production machine meant to
be deployed at a site separate from wherever the backend runs (see
`docker-compose.yml`'s pre-existing comment: MQTT TLS port was "publik,
dipakai ESP32 (beda jaringan dari server)"). So the transport change is a
real, load-bearing requirement, not incidental scope creep.

### What already exists

A substantial, working ESP32 firmware was built for this project and later
deleted from the repository in commit `860a270 "deleted unnecessary files"`
(the same commit that also deleted `mosquitto/config/mosquitto.conf`, which
had to be restored earlier in the production-deployment work). It's fully
recoverable from git history at commit `e799f00` (`feat(firmware): connect
to MQTT over TLS with credentials`), the last commit before deletion:

- `firmware/pelletq_esp32/pelletq_esp32.ino` (933 lines) — the full hopper
  gate controller: ILI9488 TFT display (`TFT_eSPI`), MAX6675 thermocouple
  over SPI, servo-actuated gate (`ESP32Servo`), a non-blocking state machine
  (`IDLE → HEATING → MIXING → DISPENSING → ABORTED`), MQTT via `PubSubClient`
  + `WiFiClientSecure` (TLS, pinned via `ca_cert.h`), retained-config
  handling, per-batch formulation scaling, and a serial bench-test command
  interface.
- `firmware/pelletq_esp32/platformio.ini` — PlatformIO build config,
  `framework = arduino`, pinned library versions
  (`TFT_eSPI`, `ESP32Servo`, `PubSubClient`, `ArduinoJson`).
- `firmware/mqtt_test/mqtt_test.ino` + its `platformio.ini` — a deliberately
  minimal WiFi+MQTT-only bench sketch with no display/servo/sensor
  dependencies, built specifically to validate connectivity in isolation
  before wiring up the full hardware stack.

None of this is starting from scratch. The MQTT topic set already documented
in `firmware/pelletq_esp32/README.md` (`pelletq/telemetry`,
`pelletq/command`, `pelletq/config`, `pelletq/config/ack`,
`pelletq/event`/`formulation`, `pelletq/status`) matches what's hardcoded in
the deleted sketch.

### Why not a full ESP-IDF rewrite

The initial instinct (native ESP-IDF, since `esp-mqtt` supports `wss://`
transport out of the box while Arduino's common MQTT libraries don't) holds
for the MQTT client specifically, but doesn't hold for the whole firmware:
`TFT_eSPI`, `ESP32Servo`, and the MAX6675 SPI read are all Arduino-ecosystem
libraries with no drop-in ESP-IDF equivalent (`esp_lcd`, `ledc`/`mcpwm`, and
raw SPI are different APIs entirely). A full rewrite would throw away
working, iterated-on hardware integration code to solve a problem that's
really confined to one component: the MQTT client.

`arduino-esp32` (the Arduino core PlatformIO uses for ESP32) is itself built
on top of ESP-IDF, and PlatformIO supports a combined
`framework = arduino, espidf` mode for exactly this situation — keeping
Arduino APIs for everything else while getting access to ESP-IDF components
(like `esp-mqtt`) that Arduino alone doesn't expose. This design treats that
combination as unverified but promising, and spikes it before committing the
full sketch to it.

## Constraints

- **No ESP32 hardware is currently available.** All verification in this
  round is at the PlatformIO build (compile + link) level, or against a
  local Mosquitto WebSocket listener from a dev machine — not an actual
  flashed board. A manual test checklist is produced for whenever hardware
  is available, rather than any claim of runtime verification now.
- **The Cloudflare Tunnel isn't live yet** — `TUNNEL_TOKEN` in `.env.example`
  is still a placeholder, no tunnel has been created in the Cloudflare
  dashboard. Testing against the real public `wss://mqtt.<domain>` endpoint
  is out of scope for this round; testing targets a local Mosquitto
  WebSocket listener instead.
- The firmware/pelletq_esp32/mqtt_test.ino connection layer is the only
  thing intentionally changing. Topics, state machine, config schema,
  hardware pin map, and bench-test commands are unchanged from the recovered
  `e799f00` version unless a hybrid-framework constraint forces a change
  (to be discovered during the spike, not assumed up front).

## Design

### Step 1 — Recover the deleted firmware

Restore, unmodified, from commit `e799f00`:
- `firmware/pelletq_esp32/pelletq_esp32.ino`
- `firmware/pelletq_esp32/platformio.ini`
- `firmware/mqtt_test/mqtt_test.ino`
- `firmware/mqtt_test/platformio.ini`

`ca_cert.h` is deliberately **not** restored — see Step 3.

### Step 2 — Spike the hybrid framework on the bare MQTT sketch

Using `firmware/mqtt_test/` (no display/servo/sensor dependencies, so the
fastest thing to iterate on):

1. Change `platformio.ini`'s `framework = arduino` to
   `framework = arduino, espidf`.
2. Replace the `PubSubClient`-based connection code with ESP-IDF's
   `esp_mqtt_client`, configured for WebSocket transport:
   `esp_mqtt_client_config_t` with `.broker.address.uri` set to a `ws://`
   URI and `.transport = MQTT_TRANSPORT_OVER_WS` (switching to `wss://` /
   `MQTT_TRANSPORT_OVER_WSS` is Step 3's concern once a real public
   endpoint exists). Keep the existing heartbeat/LWT/echo behavior, just
   ported onto the new client's callback style.
3. `pio run`. Success is a clean compile and link — this is what actually
   tests whether the combined framework works for this dependency set at
   all. If it fails in a way that isn't a quick fix (missing component,
   genuine incompatibility), that's a decision point to come back to the
   user with, not something to route around silently.

### Step 3 — Verify the WebSocket path/URI against a real Mosquitto listener

Independent of hardware: bring up the project's Mosquitto container locally
and connect to its `listener 9001` (`protocol websockets`) using a
WebSocket-capable MQTT client from the dev machine (e.g. `mosquitto_pub`
with `--transport websockets` support). Confirm empirically what URI path
Mosquitto actually expects — a native `protocol websockets` listener isn't
expected to do path-based routing (no `http_dir` is configured), so any
path should work, but this gets confirmed rather than assumed, since it
determines the exact URI the firmware config needs. Document the result
directly in the firmware README's transport section.

### Step 4 — Apply the validated transport change to the real sketch

Once Step 2 compiles clean and Step 3 confirms the URI shape:

- Apply the same `esp_mqtt_client` connection-layer change to
  `pelletq_esp32.ino`, in place of its `PubSubClient`/`WiFiClientSecure`
  code. TFT, servo, thermocouple, state machine, config, and bench-command
  code are untouched.
- Drop the dependency on a pinned `ca_cert.h`: the old design pinned a
  Let's Encrypt cert because Caddy issued one specifically for
  `MQTT_DOMAIN`. Cloudflare's edge terminates TLS with a certificate from a
  standard, widely-trusted public CA, so ESP-IDF's default certificate
  bundle (`esp-tls`'s bundled CA store) should trust it without pinning
  anything. This gets confirmed once the tunnel is live (out of scope now,
  documented as a follow-up check).
- Update `firmware/pelletq_esp32/README.md`'s transport section (currently
  carrying an inline note flagging it as pending this exact decision) to
  describe the final `wss://` connection config, replacing the placeholder
  note added during the Cloudflare Tunnel migration.

## Testing

- **Step 2:** `pio run` exit code, read for compiler/linker errors. No unit
  test framework applies to embedded firmware here; this matches how the
  original firmware was verified (bench sketches + serial monitor, per its
  own README conventions).
- **Step 3:** A real WebSocket MQTT connection attempt against the actual
  running Mosquitto container, not a mock — pass/fail is "did it connect
  and does pub/sub work on a test topic."
- **Step 4:** Same build-level check as Step 2, applied to the full sketch
  this time (more dependencies compiling together is itself a meaningful
  check). A manual hardware test checklist gets written for later use, not
  executed now.

## Out of scope

- Any change to hardware pin mapping, the state machine, MQTT topics, config
  schema, or bench-test command interface.
- Testing against the real public Cloudflare Tunnel endpoint (tunnel not
  created yet).
- Testing on real ESP32 hardware (none available this round).
- Choosing between `arduino, espidf` staying permanent vs. later migrating
  further ESP-IDF-ward — this design only resolves the immediate transport
  problem.
