import { solveFormulation } from "./src/lib/lp-solver";

const testIngredients = [
  { ingredientId: "id1", name: "Tapioka", stokKg: 3, hargaPerKg: 7000, proteinPct: 1, lemakPct: 0.5, seratKasarPct: 0.5, abuPct: 0.5, kadarAirPct: 13, kondisiBahan: "KERING", bentukBahan: "HALUS", karakterBahan: "MUDAH_MENGIKAT" },
  { ingredientId: "id2", name: "Bungkil Kedelai", stokKg: 3, hargaPerKg: 8000, proteinPct: 45, lemakPct: 8, seratKasarPct: 8, abuPct: 7, kadarAirPct: 11, kondisiBahan: "KERING", bentukBahan: "HALUS", karakterBahan: "NETRAL" },
  { ingredientId: "id3", name: "Tepung Jagung", stokKg: 5, hargaPerKg: 5000, proteinPct: 8, lemakPct: 4, seratKasarPct: 2, abuPct: 1.5, kadarAirPct: 12, kondisiBahan: "KERING", bentukBahan: "SEDANG", karakterBahan: "NETRAL" },
];

const result = solveFormulation(
  testIngredients,
  { proteinMinPct: 28, lemakMinPct: 5, seratKasarMaksPct: 8, abuMaksPct: 13, kadarAirMaksPct: 12 },
  5,
  "TERMURAH",
  10, // binderMinPct
  15  // patiMinPctTerapung
);

console.log("Feasible:", result.feasible);
console.log("Ingredients:", result.ingredients.map(i => `${i.name}: ${i.persentase}%`).join(", "));
console.log("Tapioka %:", result.ingredients.find(i => i.name === "Tapioka")?.persentase || 0);
console.log("Tepung Jagung %:", result.ingredients.find(i => i.name === "Tepung Jagung")?.persentase || 0);
console.log("Total pati %:", (result.ingredients.find(i => i.name === "Tapioka")?.persentase || 0) + (result.ingredients.find(i => i.name === "Tepung Jagung")?.persentase || 0));
