/*
 * ============================================================================
 * PelletQ-AI — ESP32 Relay On/Off Bench Test
 * ============================================================================
 * Sketch minimal untuk MENGUJI relay pemanas SAJA — tanpa WiFi/MQTT/TFT/servo/
 * thermocouple. Cukup board ESP32 + USB + relay module terpasang di
 * PIN_HEATER. PIN_HEATER & RELAY_ACTIVE_LOW di bawah SENGAJA disamakan persis
 * dengan firmware/pelletq_esp32/pelletq_esp32.ino supaya hasil tes di sini
 * berlaku untuk sketch utama juga — ganti keduanya bersamaan kalau perlu.
 *
 * Yang dilakukan:
 *   - Boot: relay dipaksa OFF dulu (fail-safe), lalu auto-toggle tiap
 *     AUTO_TOGGLE_MS supaya kamu bisa lihat/dengar relay klik dan lampu
 *     indikatornya berubah tanpa perlu ngetik apa pun.
 *   - Serial commands @115200:
 *       on       - paksa relay ON terus (sampai command lain)
 *       off      - paksa relay OFF terus (sampai command lain)
 *       toggle   - flip sekali dari state sekarang
 *       auto     - balik ke auto-toggle tiap AUTO_TOGGLE_MS
 *
 * Cara pakai buat diagnosa mismatch LED vs kode: jalankan "off", lalu ukur
 * tegangan di GPIO_HEATER dan di pin IN relay module pakai multimeter — kalau
 * GPIO sudah valid HIGH/LOW (sesuai print di serial) tapi LED/klik relay
 * tetap nggak berubah, itu konfirmasi masalahnya ada di modul relay/wiring,
 * bukan firmware.
 *
 * Build:
 *   cd firmware/relay_test && pio run -t upload && pio device monitor
 * Serial monitor @115200.
 * ============================================================================
 */

#include <Arduino.h>

// Harus sama persis dengan firmware/pelletq_esp32/pelletq_esp32.ino. Sempat
// di GPIO33 tapi nggak bisa nge-drive relay module sama sekali (bench test
// isolasi pin di sini) — pindah ke GPIO14, relay langsung respons di sana.
#define PIN_HEATER        14
// Modul relay terpasang aktif-HIGH — lihat catatan panjang di
// firmware/pelletq_esp32/pelletq_esp32.ino. Auto-toggle di sketch ini tetap
// "kelihatan jalan" walau polaritasnya kebalik, jadi kalau mengubah nilai ini
// cocokkan klik relay dengan label ON/OFF yang dicetak ke serial.
#define RELAY_ACTIVE_LOW  false

constexpr unsigned long AUTO_TOGGLE_MS = 3000;

bool          heaterOn   = false;
bool          autoMode   = true;
unsigned long lastToggle = 0;

void setHeater(bool on) {
  heaterOn = on;
  digitalWrite(PIN_HEATER, on ? (RELAY_ACTIVE_LOW ? LOW : HIGH)
                              : (RELAY_ACTIVE_LOW ? HIGH : LOW));
  Serial.printf("[relay] %s (GPIO%d = %s)\n", on ? "ON" : "OFF", PIN_HEATER,
                digitalRead(PIN_HEATER) ? "HIGH" : "LOW");
}

void handleSerial() {
  if (!Serial.available()) return;
  String line = Serial.readStringUntil('\n');
  line.trim();
  if (line.length() == 0) return;

  Serial.printf("[serial] cmd: %s\n", line.c_str());

  if (line == "on") {
    autoMode = false;
    setHeater(true);
  } else if (line == "off") {
    autoMode = false;
    setHeater(false);
  } else if (line == "toggle") {
    autoMode = false;
    setHeater(!heaterOn);
  } else if (line == "auto") {
    autoMode = true;
    lastToggle = millis();
    Serial.println(F("[mode] auto-toggle tiap 3 dtk"));
  } else {
    Serial.println(F("[?] command: on / off / toggle / auto"));
  }
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(F("\n[relay_test] boot"));

  pinMode(PIN_HEATER, OUTPUT);
  setHeater(false);   // fail-safe: mati dulu sebelum apa pun lain

  Serial.println(F("[relay_test] auto-toggle tiap 3 dtk. Ketik 'on'/'off'/'toggle'/'auto' buat override."));
  lastToggle = millis();
}

void loop() {
  handleSerial();

  if (autoMode && millis() - lastToggle >= AUTO_TOGGLE_MS) {
    lastToggle = millis();
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
