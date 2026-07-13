-- CreateTable
CREATE TABLE "user_ingredient_availability" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "stokKg" DECIMAL(8,2) NOT NULL,
    "hargaPerKg" DECIMAL(12,2) NOT NULL,
    "kondisi" "IngredientCondition" NOT NULL DEFAULT 'KERING',
    "bentuk" "IngredientForm",
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ingredient_availability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_ingredient_availability_userId_ingredientId_key" ON "user_ingredient_availability"("userId", "ingredientId");

-- AddForeignKey
ALTER TABLE "user_ingredient_availability" ADD CONSTRAINT "user_ingredient_availability_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_ingredient_availability" ADD CONSTRAINT "user_ingredient_availability_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
