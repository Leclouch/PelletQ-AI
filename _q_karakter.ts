import { config } from "dotenv";
config();
import("./src/lib/prisma").then(async ({ prisma }) => {
  try {
    const ing = await prisma.ingredient.findFirst({ where: { name: "Tapioka" } });
    if (ing) {
      console.log("Raw karakterBahan:", ing.karakterBahan, typeof ing.karakterBahan);
      console.log("String(karakterBahan):", String(ing.karakterBahan));
      console.log("Equal to MUDAH_MENGIKAT?", String(ing.karakterBahan) === "MUDAH_MENGIKAT");
    }
  } catch (e) {
    console.error("ERR:", e);
  } finally {
    process.exit(0);
  }
});
