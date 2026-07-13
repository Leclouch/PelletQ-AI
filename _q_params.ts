import { config } from "dotenv";
config();
import("./src/lib/prisma").then(async ({ prisma }) => {
  try {
    const rps = await prisma.ruleParameter.findMany({
      where: { key: { in: ["binder_min_pct", "pati_min_terapung_pct"] } },
      select: { key: true, value: true },
    });
    console.log(JSON.stringify(rps, null, 2));
  } catch (e) {
    console.error("ERR:", e);
  } finally {
    process.exit(0);
  }
});
