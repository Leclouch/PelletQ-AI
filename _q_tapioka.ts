import { config } from "dotenv";
config();
import("./src/lib/prisma").then(async ({ prisma }) => {
  try {
    const tapioka = await prisma.ingredient.findFirst({
      where: { name: "Tapioka" },
      select: { id: true, name: true, karakterBahan: true },
    });
    console.log(JSON.stringify(tapioka, null, 2));
  } catch (e) {
    console.error("ERR:", e);
  } finally {
    process.exit(0);
  }
});
