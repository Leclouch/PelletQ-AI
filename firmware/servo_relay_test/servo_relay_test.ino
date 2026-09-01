/*
 * ============================================================================
 * PelletQ-AI — ESP32 Servo + Relay Bench Test
 * ============================================================================
 * Sketch minimal untuk MENGUJI servo gerbang hopper + relay pemanas SAJA —
 * tanpa WiFi/MQTT/TFT/thermocouple. Cukup board ESP32 + USB + servo di
 * PIN_SERVO + relay module di PIN_HEATER.
 *
 * Semua konstanta di bawah SENGAJA disamakan persis dengan
 * firmware/pelletq_esp32/pelletq_esp32.ino supaya hasil tes di sini berlaku
 * untuk sketch utama juga — ganti bersamaan kalau perlu.
 *
 * KENAPA SKETCH INI ADA
 * ---------------------
 * Firmware utama baru saja mengganti dua hal sekaligus (belum di-commit):
 *   1. Sudut servo 90/0 (travel 90 derajat) -> 0/150 (travel 150 derajat).
 *   2. Servo tidak lagi attached terus; di-detach SERVO_HOLD_MS (600 ms)
 *      setelah write, supaya tidak menarik arus saat diam.
 * Kalau 600 ms ternyata lebih pendek dari waktu tempuh servo untuk 150
 * derajat (apalagi kalau rail 5V drop karena coil relay + servo barengan),
 * gerbang berhenti di tengah jalan tiap siklus. Command "measure" dan "both"
 * di bawah dibuat khusus untuk membuktikan/menyangkal itu.
 *
 * MODE AUTOTESTER
 * ---------------
 * Begitu boot, servo LANGSUNG ayun 180 <-> 0 tiap 5 detik sendiri
 * (AUTO_START_SWEEP) tanpa perlu ngetik command apa pun — sama semangatnya
 * dengan auto-toggle di firmware/relay_test/relay_test.ino. Sudut & interval
 * ini sengaja beda dari cfg firmware utama (0/150, 5/10 dtk): di sini yang
 * diuji servo-nya sendiri, jadi travel dibikin penuh. Pakai "angles 0 150"
 * + "secs 5 10" kalau mau meniru firmware persis.
 *
 * Relay sengaja dibiarkan OFF di boot karena sketch ini kemungkinan dipakai
 * dengan elemen pemanas beneran terpasang; ketik "relay auto" atau "both"
 * kalau relay mau ikut diuji.
 *
 * SERIAL COMMANDS @115200
 * -----------------------
 *   SERVO
 *     open              - servo ke servoOpenAngle
 *     close             - servo ke servoCloseAngle
 *     angle <0-180>     - servo ke sudut bebas
 *     sweep             - auto buka/tutup tiap openSeconds/closeSeconds
 *                         (meniru siklus updateAutomation di firmware utama;
 *                         sudah jalan sendiri sejak boot)
 *     stop              - hentikan sweep, tutup gerbang
 *     secs <o> <c>      - percepat siklus autotest, mis. "secs 2 2"
 *     hold <ms>         - ubah jendela tahan sebelum detach (default 600)
 *     detach / nodetach - hidupkan/matikan skema attach-only-while-moving.
 *                         "nodetach" = perilaku LAMA (servo attached terus).
 *                         Ini A/B test langsung buat regresi di atas.
 *     measure           - buka/tutup berulang dengan hold makin pendek
 *                         (1500 -> 300 ms). Lihat di hold berapa gerbang
 *                         mulai TIDAK sampai tujuan; SERVO_HOLD_MS di
 *                         firmware utama harus di atas nilai itu + margin.
 *
 *   RELAY
 *     on / off / toggle - paksa relay
 *     relay auto        - auto-toggle relay tiap RELAY_AUTO_MS
 *     relay stop        - hentikan auto-toggle
 *
 *   GABUNGAN
 *     both              - stress test rail 5V: relay di-toggle TEPAT saat
 *                         servo mulai bergerak. Kalau servo cuma gagal di
 *                         mode ini (dan normal di "sweep"), masalahnya
 *                         suplai daya/wiring, bukan timing firmware.
 *
 *   LAIN
 *     status            - cetak state sekarang
 *     help              - daftar command
 *
 * Build:
 *   cd firmware/servo_relay_test && pio run -t upload && pio device monitor
 * ============================================================================
 */

#include <Arduino.h>
#include <ESP32Servo.h>

// ============================================================================
// PIN MAP — harus sama persis dengan firmware/pelletq_esp32/pelletq_esp32.ino
// ============================================================================
#define PIN_SERVO   27
#define PIN_HEATER  14    // relay pemanas; sempat di GPIO33 tapi nggak bisa
                          // nge-drive relay module sama sekali — lihat catatan
                          // di firmware/relay_test/relay_test.ino.

// Modul relay terpasang aktif-HIGH (HIGH = kontak nyala). Kalau diubah,
// cocokkan klik relay dengan label ON/OFF yang dicetak ke serial.
#define RELAY_ACTIVE_LOW false

// ============================================================================
// PARAMETER — default sama dengan cfg di firmware utama
// ============================================================================
// Autotest pakai ayunan penuh 180 <-> 0 tiap 5 detik. Ini SENGAJA beda dari
// cfg firmware utama (0/150, 5 dtk buka / 10 dtk tutup): tujuan sketch ini
// nguji servo & relay-nya sendiri, jadi travel-nya dibikin paling ekstrem dan
// intervalnya rata biar gampang dilihat. Kalau mau meniru firmware persis,
// ketik "angles 0 150" lalu "secs 5 10".
int servoOpenAngle  = 180;
int servoCloseAngle = 0;
int openSeconds     = 5;
int closeSeconds    = 5;

// Jendela tahan sebelum servo di-detach. Bisa diubah runtime lewat "hold".
unsigned long servoHoldMs = 600;

// Rentang lebar pulsa yang dikirim ke servo, dalam mikrodetik. Default 500/2400
// menyamai firmware utama — TAPI ini rentang yang LEBAR: write(0) jadi 500us dan
// write(180) jadi 2400us, dan banyak servo (SG90/MG996R, apalagi klonan) secara
// mekanis nggak sampai ke sana. Servo bakal nabrak end stop internal, pot
// feedback-nya nggak pernah nyampe target, motornya terus didorong = STALL &
// bunyi getar. Servo checker biasanya cuma ayun ~1000-2000us, makanya di
// checker kelihatan sehat. Ubah runtime pakai "pulse <min> <max>".
int pulseMinUs = 500;
int pulseMaxUs = 2400;

// Cara servo "diistirahatkan" setelah selesai bergerak.
//   IDLE_NONE   - dibiarkan attached & bertenaga terus (perilaku firmware LAMA,
//                 ini yang TERBUKTI jalan di bench).
//   IDLE_DETACH - detach penuh (skema di working tree firmware utama). TERBUKTI
//                 RUSAK di ESP32Servo 3.0.5 + arduino-esp32 3.2.0: attach
//                 pertama setelah boot jalan, tiap RE-attach setelah detach
//                 tidak menghasilkan pulsa lagi. Lihat esp32-hal-ledc.c:121 —
//                 kalau channel-nya masih tercatat terpakai, ledcAttachChannel
//                 cuma me-route ulang pin tanpa mengkonfigurasi timer/duty.
//   IDLE_DUTY0  - tetap attached, tapi duty di-set 0 (pin LOW terus = tidak ada
//                 pulsa). Servo ikut lemas & berhenti narik arus seperti
//                 detach, TAPI channel LEDC tidak pernah dibongkar-pasang, jadi
//                 tidak kena bug re-attach di atas. Ini kandidat pengganti.
enum IdleMode { IDLE_NONE, IDLE_DETACH, IDLE_DUTY0 };
IdleMode idleMode = IDLE_DETACH;

// true = begitu boot langsung sweep buka/tutup sendiri (mode autotester),
// tanpa perlu ngetik command. Set false kalau mau serba manual.
constexpr bool AUTO_START_SWEEP = true;

constexpr unsigned long RELAY_AUTO_MS = 3000;

// ============================================================================
// STATE
// ============================================================================
Servo hopperServo;

bool          servoHolding    = false;
unsigned long servoDetachAtMs = 0;
int           servoAngleNow   = -1;      // sudut terakhir yang di-write
const char*   gateStateStr    = "CLOSED";

bool          sweepMode       = false;
bool          sweepOpenPhase  = false;
unsigned long sweepPhaseEndMs = 0;

bool          bothMode        = false;   // toggle relay barengan gerak servo

bool          heaterOn        = false;
bool          relayAutoMode   = false;
unsigned long relayLastToggle = 0;

// Mode "measure": turunkan hold tiap gerakan sampai servo kelihatan nggak sampai.
const unsigned long MEASURE_STEPS[] = {1500, 1200, 1000, 800, 600, 500, 400, 300};
constexpr int MEASURE_STEP_COUNT = sizeof(MEASURE_STEPS) / sizeof(MEASURE_STEPS[0]);
bool          measureMode      = false;
int           measureIdx       = 0;
bool          measureOpenPhase = false;
unsigned long measureNextMs    = 0;
// Jeda antar gerakan saat measure: cukup lama supaya operator sempat lihat
// posisi akhir gerbang sebelum gerakan berikutnya.
constexpr unsigned long MEASURE_GAP_MS = 2500;

// ============================================================================
// RELAY
// ============================================================================
void setHeater(bool on) {
  heaterOn = on;
  digitalWrite(PIN_HEATER, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH)
                              : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  Serial.printf("[relay] %s (GPIO%d = %s)\n", on ? "ON" : "OFF", PIN_HEATER,
                digitalRead(PIN_HEATER) ? "HIGH" : "LOW");
}

// ============================================================================
// SERVO
// ============================================================================
// Sama persis dengan holdServo() di firmware utama, plus satu hal yang belum
// ada di sana: pin di-drive LOW setelah detach supaya jalur sinyal tidak
// floating.
//
// NOISE YANG NORMAL — jangan dikejar. Tiap attach, serial akan memuntahkan:
//   ledc: GPIO 27 is not usable, maybe conflict with others
//   [E] ledcAttachChannel(): Pin 27 is already attached to LEDC (channel 0...)
//   ESP32PWM: ERROR PWM channel failed to configure on pin 27!
//   ESP32Servo: Success to Attach servo : 27 on PWM 0
// Itu bug kosmetik di ESP32Servo 3.0.5: ESP32PWM::attachPin(pin,freq,res)
// memanggil setup() yang SUDAH melakukan ledcAttachChannel(), lalu memanggil
// attachPin(pin) yang melakukannya LAGI. Panggilan kedua wajar ditolak karena
// pin-nya memang baru saja diklaim oleh panggilan pertama — dan panggilan
// pertama itulah yang benar-benar mengkonfigurasi channel. Servo tetap jalan.
static void holdServo(int angle) {
  if (!hopperServo.attached()) {
    hopperServo.setPeriodHertz(50);
    int ch = hopperServo.attach(PIN_SERVO, pulseMinUs, pulseMaxUs);
    // JANGAN pakai "ch == 0" sebagai tanda gagal. Servo::attach() me-return
    // pwm.getChannel(), dan PWM_BASE_INDEX di ESP32Servo 3.x = 0 — jadi
    // channel 0 itu channel VALID yang justru dipakai pertama kali. Cek
    // attached() yang beneran mencerminkan berhasil/tidaknya.
    if (!hopperServo.attached()) {
      Serial.println(F("[servo] GAGAL attach — channel LEDC habis / pin invalid"));
      return;
    }
    Serial.printf("[servo] attached ke GPIO%d (LEDC ch %d)\n", PIN_SERVO, ch);
  }

  int prev = servoAngleNow;
  hopperServo.write(angle);
  servoAngleNow = angle;

  if (prev >= 0) {
    Serial.printf("[servo] write %d -> %d (travel %d deg), hold %lu ms%s\n",
                  prev, angle, abs(angle - prev), servoHoldMs,
                  idleMode == IDLE_NONE ? " (idle NONE)" : "");
  } else {
    Serial.printf("[servo] write %d (posisi awal), hold %lu ms\n", angle, servoHoldMs);
  }

  servoHolding    = true;
  servoDetachAtMs = millis() + servoHoldMs;
}

void openGate() {
  holdServo(servoOpenAngle);
  gateStateStr = "OPEN";
}

void closeGate() {
  holdServo(servoCloseAngle);
  gateStateStr = "CLOSED";
}

void updateServoIdle() {
  if (!servoHolding) return;
  if (idleMode == IDLE_NONE) return;                     // dibiarkan bertenaga
  if ((long)(millis() - servoDetachAtMs) < 0) return;    // aman terhadap wrap

  servoHolding = false;

  if (idleMode == IDLE_DUTY0) {
    // Duty 0 = pin LOW terus = tidak ada pulsa sama sekali. Servo lemas dan
    // berhenti narik arus, tapi channel LEDC tetap terkonfigurasi sehingga
    // gerakan berikutnya cukup ledcWrite duty baru — tanpa attach ulang.
    ledcWrite(PIN_SERVO, 0);
    Serial.println(F("[servo] idle: duty 0 (tetap attached, tanpa pulsa)"));
    return;
  }

  if (hopperServo.attached()) {
    hopperServo.detach();
    // ledcDetach() melepas pin jadi input — jalur sinyal servo floating dan
    // bisa kena noise dari relay/WiFi. Drive LOW supaya servo lihat "tidak
    // ada pulsa" yang bersih, bukan derau.
    pinMode(PIN_SERVO, OUTPUT);
    digitalWrite(PIN_SERVO, LOW);
    Serial.println(F("[servo] detached (idle), pin di-drive LOW"));
  }
}

// ============================================================================
// MODE
// ============================================================================
void stopAllModes(const char* reason) {
  if (sweepMode || measureMode || bothMode || relayAutoMode)
    Serial.printf("[mode] semua mode otomatis dihentikan (%s)\n", reason);
  sweepMode     = false;
  measureMode   = false;
  bothMode      = false;
  relayAutoMode = false;
}

// Satu langkah siklus buka/tutup, dipakai "sweep" dan "both".
static void sweepStep() {
  unsigned long now = millis();

  if (bothMode) {
    // Toggle relay TEPAT sebelum servo bergerak — inrush coil relay dan arus
    // start servo bertabrakan di rail 5V yang sama.
    setHeater(!heaterOn);
  }

  if (sweepOpenPhase) {
    closeGate();
    sweepOpenPhase  = false;
    sweepPhaseEndMs = now + (unsigned long)closeSeconds * 1000UL;
  } else {
    openGate();
    sweepOpenPhase  = true;
    sweepPhaseEndMs = now + (unsigned long)openSeconds * 1000UL;
  }
}

void updateSweep() {
  if (!sweepMode && !bothMode) return;
  if ((long)(sweepPhaseEndMs - millis()) > 0) return;
  sweepStep();
}

void updateMeasure() {
  if (!measureMode) return;
  if ((long)(measureNextMs - millis()) > 0) return;

  if (measureIdx >= MEASURE_STEP_COUNT) {
    measureMode = false;
    Serial.println(F("[measure] selesai. Hold TERKECIL yang gerbangnya masih"));
    Serial.println(F("[measure] sampai tujuan = batas bawah. Set SERVO_HOLD_MS"));
    Serial.println(F("[measure] di firmware utama minimal 1.5x nilai itu."));
    closeGate();
    return;
  }

  servoHoldMs = MEASURE_STEPS[measureIdx];
  Serial.printf("\n[measure] === langkah %d/%d: hold %lu ms ===\n",
                measureIdx + 1, MEASURE_STEP_COUNT, servoHoldMs);

  if (measureOpenPhase) {
    closeGate();
    measureOpenPhase = false;
    measureIdx++;                 // satu langkah = sepasang buka+tutup
  } else {
    openGate();
    measureOpenPhase = true;
  }

  measureNextMs = millis() + MEASURE_GAP_MS;
}

// ============================================================================
// SERIAL COMMAND PARSER
// ============================================================================
void printHelp() {
  Serial.println(F("\n--- SERVO ---"));
  Serial.println(F("  open | close | angle <0-180>"));
  Serial.println(F("  sweep | stop         (sweep JALAN SENDIRI sejak boot)"));
  Serial.println(F("  angles <o> <c>       ganti sudut, mis. 'angles 0 150'"));
  Serial.println(F("  secs <open> <close>  ubah interval siklus, detik"));
  Serial.println(F("  hold <ms>            jendela tahan sebelum detach"));
  Serial.println(F("  detach | nodetach | duty0   cara servo diistirahatkan"));
  Serial.println(F("  release              lepas servo SEKARANG (abort stall)"));
  Serial.println(F("  pulse <min> <max>    rentang us, mis. 'pulse 1000 2000'"));
  Serial.println(F("  measure              cari SERVO_HOLD_MS minimum"));
  Serial.println(F("--- RELAY ---"));
  Serial.println(F("  on | off | toggle"));
  Serial.println(F("  relay auto | relay stop"));
  Serial.println(F("--- GABUNGAN ---"));
  Serial.println(F("  both                 relay toggle barengan gerak servo"));
  Serial.println(F("--- LAIN ---"));
  Serial.println(F("  status | help"));
  Serial.println();
}

void printStatus() {
  Serial.println(F("--- STATUS ---"));
  Serial.printf("  gerbang     : %s (write terakhir %d deg)\n", gateStateStr, servoAngleNow);
  Serial.printf("  sudut       : open=%d close=%d (travel %d deg)\n",
                servoOpenAngle, servoCloseAngle, abs(servoOpenAngle - servoCloseAngle));
  Serial.printf("  servo attach: %s\n", hopperServo.attached() ? "YA" : "TIDAK");
  Serial.printf("  hold        : %lu ms (detach %s)\n",
                servoHoldMs,
                idleMode == IDLE_NONE ? "NONE" : (idleMode == IDLE_DETACH ? "DETACH" : "DUTY0"));
  Serial.printf("  pulse       : %d..%d us\n", pulseMinUs, pulseMaxUs);
  Serial.printf("  relay       : %s (GPIO%d = %s, active-%s)\n",
                heaterOn ? "ON" : "OFF", PIN_HEATER,
                digitalRead(PIN_HEATER) ? "HIGH" : "LOW",
                RELAY_ACTIVE_LOW ? "LOW" : "HIGH");
  Serial.printf("  mode        : sweep=%d both=%d measure=%d relayAuto=%d\n",
                sweepMode, bothMode, measureMode, relayAutoMode);
  Serial.println();
}

void handleSerial() {
  if (!Serial.available()) return;

  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  Serial.printf("[serial] cmd: %s\n", line.c_str());

  // ---- SERVO ----
  if (line == "open") {
    stopAllModes("manual open");
    openGate();

  } else if (line == "close") {
    stopAllModes("manual close");
    closeGate();

  } else if (line.startsWith("angle ")) {
    int a = line.substring(6).toInt();
    if (a < 0 || a > 180) {
      Serial.println(F("[?] sudut harus 0-180"));
      return;
    }
    stopAllModes("manual angle");
    holdServo(a);
    gateStateStr = "MANUAL";

  } else if (line == "sweep") {
    stopAllModes("mulai sweep");
    sweepMode       = true;
    sweepOpenPhase  = false;
    sweepPhaseEndMs = millis();     // langsung mulai di loop berikutnya
    Serial.printf("[mode] sweep: open %d dtk / close %d dtk\n",
                  openSeconds, closeSeconds);

  } else if (line == "stop") {
    stopAllModes("stop");
    closeGate();

  } else if (line.startsWith("angles ")) {
    // "angles 0 150" — balik ke sudut firmware utama tanpa reflash.
    String rest = line.substring(7);
    rest.trim();
    int sp = rest.indexOf(' ');
    if (sp < 0) {
      Serial.println(F("[?] pakai: angles <openDeg> <closeDeg>"));
      return;
    }
    int o = rest.substring(0, sp).toInt();
    int c = rest.substring(sp + 1).toInt();
    if (o < 0 || o > 180 || c < 0 || c > 180) {
      Serial.println(F("[?] sudut harus 0-180"));
      return;
    }
    servoOpenAngle  = o;
    servoCloseAngle = c;
    Serial.printf("[mode] sudut: open=%d close=%d (travel %d deg)\n",
                  servoOpenAngle, servoCloseAngle, abs(o - c));

  } else if (line.startsWith("secs ")) {
    // "secs 2 2" — percepat siklus autotest tanpa reflash. Default 5/10
    // mengikuti cfg firmware utama, tapi buat ngeliat gerakan berulang-ulang
    // itu kelamaan.
    String rest = line.substring(5);
    rest.trim();
    int sp = rest.indexOf(' ');
    if (sp < 0) {
      Serial.println(F("[?] pakai: secs <openDetik> <closeDetik>"));
      return;
    }
    int o = rest.substring(0, sp).toInt();
    int c = rest.substring(sp + 1).toInt();
    if (o < 1 || o > 300 || c < 1 || c > 300) {
      Serial.println(F("[?] detik harus 1-300"));
      return;
    }
    openSeconds  = o;
    closeSeconds = c;
    Serial.printf("[mode] siklus: open %d dtk / close %d dtk\n", openSeconds, closeSeconds);

  } else if (line.startsWith("hold ")) {
    long ms = line.substring(5).toInt();
    if (ms < 50 || ms > 10000) {
      Serial.println(F("[?] hold harus 50-10000 ms"));
      return;
    }
    servoHoldMs = (unsigned long)ms;
    Serial.printf("[servo] hold = %lu ms\n", servoHoldMs);

  } else if (line.startsWith("pulse ")) {
    // "pulse 1000 2000" — rentang aman standar hobby servo. Kalau getarnya
    // hilang setelah ini, penyebabnya memang endpoint 500/2400us yang di luar
    // jangkauan mekanis servo, bukan suplai daya.
    String rest = line.substring(6);
    rest.trim();
    int sp = rest.indexOf(' ');
    if (sp < 0) {
      Serial.println(F("[?] pakai: pulse <minUs> <maxUs>, mis. 'pulse 1000 2000'"));
      return;
    }
    int lo = rest.substring(0, sp).toInt();
    int hi = rest.substring(sp + 1).toInt();
    if (lo < 500 || hi > 2500 || lo >= hi) {
      Serial.println(F("[?] rentang 500-2500 us, dan min harus < max"));
      return;
    }
    pulseMinUs = lo;
    pulseMaxUs = hi;
    // Rentang baru cuma kepakai saat attach berikutnya — lepas sekarang.
    servoHolding = false;
    if (hopperServo.attached()) {
      hopperServo.detach();
      pinMode(PIN_SERVO, OUTPUT);
      digitalWrite(PIN_SERVO, LOW);
    }
    servoAngleNow = -1;
    Serial.printf("[servo] pulse = %d..%d us (aktif di gerakan berikutnya)\n",
                  pulseMinUs, pulseMaxUs);

  } else if (line == "release") {
    // Abort cepat: lepas servo SEKARANG juga, tidak nunggu servoHoldMs.
    // Dipakai buat menghentikan servo yang lagi mentok/stall waktu ngukur
    // arus — stall lama bikin gearbox & driver IC panas/rusak.
    stopAllModes("release");
    servoHolding = false;
    if (hopperServo.attached()) {
      hopperServo.detach();
      pinMode(PIN_SERVO, OUTPUT);
      digitalWrite(PIN_SERVO, LOW);
    }
    Serial.println(F("[servo] RELEASE — detach paksa, servo tidak bertenaga"));

  } else if (line == "detach") {
    idleMode = IDLE_DETACH;
    Serial.println(F("[servo] idle = DETACH (skema working-tree firmware; terbukti rusak)"));

  } else if (line == "nodetach") {
    idleMode = IDLE_NONE;
    Serial.println(F("[servo] idle = NONE — attached terus (perilaku firmware LAMA)"));

  } else if (line == "duty0") {
    idleMode = IDLE_DUTY0;
    servoHolding = false;
    Serial.println(F("[servo] idle = DUTY0 — tetap attached, pulsa dimatikan saat diam"));

  } else if (line == "measure") {
    stopAllModes("mulai measure");
    measureMode      = true;
    measureIdx       = 0;
    measureOpenPhase = false;
    measureNextMs    = millis();
    Serial.println(F("[mode] measure: hold turun 1500 -> 300 ms."));
    Serial.println(F("[mode] Perhatikan di hold berapa gerbang mulai nggak sampai tujuan."));

  // ---- RELAY ----
  } else if (line == "on") {
    relayAutoMode = false;
    setHeater(true);

  } else if (line == "off") {
    relayAutoMode = false;
    setHeater(false);

  } else if (line == "toggle") {
    relayAutoMode = false;
    setHeater(!heaterOn);

  } else if (line == "relay auto") {
    relayAutoMode   = true;
    relayLastToggle = millis();
    Serial.println(F("[mode] relay auto-toggle tiap 3 dtk"));

  } else if (line == "relay stop") {
    relayAutoMode = false;
    setHeater(false);
    Serial.println(F("[mode] relay auto-toggle berhenti"));

  // ---- GABUNGAN ----
  } else if (line == "both") {
    stopAllModes("mulai both");
    bothMode        = true;
    sweepOpenPhase  = false;
    sweepPhaseEndMs = millis();
    Serial.println(F("[mode] both: relay di-toggle tepat saat servo mulai gerak."));
    Serial.println(F("[mode] Kalau servo cuma gagal di sini, masalahnya suplai 5V."));

  // ---- LAIN ----
  } else if (line == "status") {
    printStatus();

  } else if (line == "help") {
    printHelp();

  } else {
    Serial.println(F("[?] command tidak dikenal — ketik 'help'"));
  }
}

// ============================================================================
// SETUP / LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  // Sama alasannya dengan firmware utama: default timeout 1 detik bikin loop
  // berhenti total kalau ada byte masuk tanpa '\n'.
  Serial.setTimeout(20);
  delay(300);
  Serial.println(F("\n[servo_relay_test] boot"));

  // Relay mati dulu sebelum apa pun lain (fail-safe), persis firmware utama.
  pinMode(PIN_HEATER, OUTPUT);
  setHeater(false);

  // Servo — attach diserahkan ke holdServo() supaya hanya bertenaga saat gerak.
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  hopperServo.setPeriodHertz(50);
  closeGate();

  printHelp();
  printStatus();
  relayLastToggle = millis();

  // AUTOTESTER: langsung mulai siklus buka/tutup tanpa perlu ngetik apa pun,
  // sama semangatnya dengan auto-toggle di firmware/relay_test/relay_test.ino.
  // Relay SENGAJA dibiarkan OFF di sini — beda dengan relay_test yang memang
  // cuma nguji satu GPIO tanpa beban, sketch ini kemungkinan besar dijalankan
  // dengan elemen pemanas beneran terpasang. Ketik "relay auto" (relay jalan
  // sendiri, timer terpisah dari servo) atau "both" (relay di-toggle tepat
  // saat servo gerak — stress test rail 5V) kalau mau ikut nguji relay.
  if (AUTO_START_SWEEP) {
    sweepMode       = true;
    sweepOpenPhase  = false;
    sweepPhaseEndMs = millis();
    Serial.printf("[autotest] servo ayun otomatis %d <-> %d deg, tiap %d/%d dtk.\n",
                  servoOpenAngle, servoCloseAngle, openSeconds, closeSeconds);
    Serial.println(F("[autotest] 'stop' berhenti | 'angles <o> <c>' & 'secs <o> <c>'"));
    Serial.println(F("[autotest] ubah sudut/interval | 'relay auto'/'both' ikut relay."));
  }
}

void loop() {
  handleSerial();

  updateSweep();
  updateMeasure();
  updateServoIdle();

  if (relayAutoMode && millis() - relayLastToggle >= RELAY_AUTO_MS) {
    relayLastToggle = millis();
    setHeater(!heaterOn);
  }
}

extern "C" void app_main(void) {
  initArduino();
  setup();

  while (true) {
    loop();
    delay(1);
  }
}
