import mqtt, { MqttClient } from "mqtt";

// mqtt.js meng-antre publish QoS 0 saat client belum terkoneksi dan tidak
// pernah memanggil callback publish-nya kalau broker tak terjangkau — tanpa
// timeout ini, publishRetained() bisa menggantung tanpa batas.
const PUBLISH_TIMEOUT_MS = 3000;

// LWT retained ESP32 ("online" saat konek, "offline" kalau putus — lihat
// TOPIC_STATUS di firmware) — dipantau di sini juga (bukan koneksi MQTT
// terpisah) supaya publish (kirim formulasi) & subscribe (status alat) cukup
// satu koneksi. Dipakai oleh getMachineStatus() di bawah.
const STATUS_TOPIC = "pelletq/status";
type MachineStatus = "online" | "offline" | "unknown";

const globalForMqtt = globalThis as unknown as {
  mqttClient: MqttClient | undefined;
  machineStatus: MachineStatus | undefined;
};

function createMqttClient(url: string): MqttClient {
  const client = mqtt.connect(url, {
    reconnectPeriod: 5000,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  });

  client.on("connect", () => {
    client.subscribe(STATUS_TOPIC, { qos: 0 });
  });
  client.on("message", (topic, payload) => {
    if (topic !== STATUS_TOPIC) return;
    globalForMqtt.machineStatus = payload.toString() === "online" ? "online" : "offline";
  });
  // Koneksi kita ke broker putus -> kita juga tidak tahu lagi status alat
  // yang sebenarnya (retained value lama bisa saja sudah basi).
  client.on("close", () => {
    globalForMqtt.machineStatus = "unknown";
  });

  return client;
}

// Dibuat lazy (baru dipanggil dari publishRetained/getMachineStatus), BUKAN
// di module scope. route.ts meng-import modul ini secara statis, jadi kalau
// client dibuat (dan bisa throw karena MQTT_BROKER_URL belum di-set) saat
// modul dievaluasi, seluruh API /api/formulation ikut gagal hanya gara-gara
// konfigurasi MQTT — padahal MQTT hanyalah lapisan best-effort di atas alur
// formulasi utama, bukan sesuatu yang boleh mematikan API inti.
function getClient(): MqttClient {
  if (!globalForMqtt.mqttClient) {
    const url = process.env.MQTT_BROKER_URL;
    if (!url) throw new Error("MQTT_BROKER_URL belum di-set.");
    // Simpan di globalThis (bukan variabel modul biasa) supaya bertahan
    // lintas hot-reload dev Next.js — sama seperti pola singleton di
    // src/lib/prisma.ts, tapi di sini pembuatannya lazy (lihat komentar di
    // atas fungsi ini).
    globalForMqtt.mqttClient = createMqttClient(url);
  }
  return globalForMqtt.mqttClient;
}

export function publishRetained(topic: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    let client: MqttClient;
    try {
      client = getClient();
    } catch (err) {
      // MQTT_BROKER_URL belum di-set — reject promise, JANGAN throw
      // synchronous supaya caller (route.ts) selalu bisa try/catch ini
      // seperti kegagalan publish lainnya.
      reject(err);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`MQTT publish timeout setelah ${PUBLISH_TIMEOUT_MS}ms`));
    }, PUBLISH_TIMEOUT_MS);

    client.publish(
      topic,
      JSON.stringify(payload),
      { retain: true, qos: 0 },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Status ESP32 untuk badge "Sistem Aktif" di dashboard. "unknown" kalau kita
// sendiri belum sempat konek ke broker (mis. MQTT_BROKER_URL belum di-set,
// atau broker belum terjangkau) — bukan berarti alatnya offline, cuma kita
// belum tahu.
export function getMachineStatus(): MachineStatus {
  try {
    getClient();   // pastikan client (dan subscription pelletq/status) sudah dibuat
  } catch {
    return "unknown";
  }
  return globalForMqtt.machineStatus ?? "unknown";
}
