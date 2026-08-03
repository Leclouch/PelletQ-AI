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
