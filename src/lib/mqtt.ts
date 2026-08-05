import mqtt, { MqttClient } from "mqtt";

// mqtt.js meng-antre publish QoS 0 saat client belum terkoneksi dan tidak
// pernah memanggil callback publish-nya kalau broker tak terjangkau — tanpa
// timeout ini, publishRetained() bisa menggantung tanpa batas.
const PUBLISH_TIMEOUT_MS = 3000;

const globalForMqtt = globalThis as unknown as {
  mqttClient: MqttClient | undefined;
};

function createMqttClient(url: string): MqttClient {
  return mqtt.connect(url, {
    reconnectPeriod: 5000,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
  });
}

// Dibuat lazy (baru dipanggil dari publishRetained), BUKAN di module scope.
// route.ts meng-import modul ini secara statis, jadi kalau client dibuat
// (dan bisa throw karena MQTT_BROKER_URL belum di-set) saat modul
// dievaluasi, seluruh API /api/formulation ikut gagal hanya gara-gara
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
