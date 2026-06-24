# PelletQ-AI — Refactor + Ingredient Management Design
**Date:** 2026-06-24  
**Status:** Approved

---

## Overview

Two goals in one implementation:

1. **Refactor** the 849-line `page.tsx` monolith into a proper pages-and-components structure.
2. **Add ingredient management** — a new "Kelola Bahan" screen where users do full CRUD on the ingredient catalog *and* their personal availability data (stok, harga, kondisi, bentuk). Saved availability pre-fills formulation step 3 so users never re-enter the same data twice.

---

## File Structure

```
src/
  lib/
    types.ts            — all shared TypeScript interfaces
    constants.ts        — PHASE_MAP, DIAMETER_MM, SEVERITY_STYLE, etc.
    helpers.ts          — rp(), todayStr(), pill(), smallPill()

  components/
    ui/
      AppShell.tsx            — outer gradient + 440px white card wrapper
      StickyHeader.tsx        — sticky top bar (back button + title/subtitle slots)
      StickyFooter.tsx        — sticky bottom bar (prev/next buttons)
      Pill.tsx                — large toggle pill button
      SmallPill.tsx           — small toggle pill button
      IngredientDropdown.tsx  — searchable ingredient selector (used in Step 3)

    screens/
      DashboardScreen.tsx
      FormScreen.tsx
      ResultScreen.tsx
      IngredientsScreen.tsx   — NEW

    form-steps/
      Step1Fish.tsx
      Step2Pellet.tsx
      Step3Ingredients.tsx
      Step4Preferences.tsx

  app/
    layout.tsx          — unchanged (Plus Jakarta Sans font)
    globals.css         — unchanged
    page.tsx            — ~80 lines: shared state + screen router only

    api/
      formulation/route.ts          — unchanged
      options/route.ts              — kept for backward compat, deprecated
      ingredients/
        route.ts                    — GET list, POST create
        [id]/route.ts               — PUT update, DELETE
      user-ingredients/
        route.ts                    — GET all availability, POST/PUT upsert
        [id]/route.ts               — DELETE one entry
```

---

## Database Changes

### New model: `UserIngredientAvailability`

```prisma
model UserIngredientAvailability {
  id           String              @id @default(cuid())
  userId       String
  user         User                @relation(fields: [userId], references: [id])
  ingredientId String
  ingredient   Ingredient          @relation(fields: [ingredientId], references: [id], onDelete: Cascade)
  stokKg       Decimal             @db.Decimal(8, 2)
  hargaPerKg   Decimal             @db.Decimal(12, 2)
  kondisi      IngredientCondition @default(KERING)
  bentuk       IngredientForm?
  updatedAt    DateTime            @updatedAt

  @@unique([userId, ingredientId])
  @@map("user_ingredient_availability")
}
```

### Changes to existing models

- **`Ingredient`**: add reverse relation `userAvailability UserIngredientAvailability[]`
- **`User`**: add reverse relation `ingredientAvailability UserIngredientAvailability[]`
- No new enum values needed — reuses `IngredientCondition` and `IngredientForm`.
- Deletion strategy: hard delete ingredient if it has no `FormulationIngredient` rows; soft delete (`statusTersedia = false`) if referenced by historical formulations.

### Migration

Run `prisma migrate dev --name add_user_ingredient_availability` after schema changes.

---

## API Routes

### Ingredient catalog (base CRUD)

| Method | Route | Body / Params | Response |
|--------|-------|---------------|----------|
| `GET` | `/api/ingredients` | — | `{ ingredients: IngredientOption[] }` |
| `POST` | `/api/ingredients` | `{ name, proteinPct, lemakPct, seratKasarPct, abuPct, kadarAirPct, karakterBahan, hargaStandarPerKg }` | created ingredient |
| `PUT` | `/api/ingredients/[id]` | same fields (all optional) | updated ingredient |
| `DELETE` | `/api/ingredients/[id]` | — | `{ deleted: true }` or `{ softDeleted: true }` |

### User ingredient availability

| Method | Route | Body / Params | Response |
|--------|-------|---------------|----------|
| `GET` | `/api/user-ingredients` | — | `{ availability: UserIngredientAvailability[] }` |
| `POST` | `/api/user-ingredients` | `{ ingredientId, stokKg, hargaPerKg, kondisi, bentuk }` | upserted record |
| `DELETE` | `/api/user-ingredients/[id]` | — | `{ deleted: true }` |

All routes use the dev user (`dev@pelletq.local`) until auth is implemented.

---

## Screens

### `page.tsx` (router)

Holds:
- `screen` state: `'dashboard' | 'form' | 'result' | 'ingredients'`
- `riwayat` state + localStorage sync
- `fishSpeciesId` + `ingredients` fetched from `/api/ingredients`
- `userAvailability` fetched from `/api/user-ingredients`
- Active formulation result
- All navigation handlers (`goDash`, `startForm`, `goIngredients`, etc.)

Renders: `<DashboardScreen>`, `<FormScreen>`, `<ResultScreen>`, or `<IngredientsScreen>` based on `screen` state.

---

### `DashboardScreen`

Props: `riwayat`, `onStart`, `onGoIngredients`, `onOpenDetail`, `onRename`, `onDelete`, `fishSpeciesId`

Changes from current:
- Add "Kelola Bahan" secondary button (white bg, green border) below "Buat Formulasi Baru"
- Add delete (trash) icon on each riwayat card alongside rename pencil
- Inline delete confirm: "Hapus formulasi ini?" + "Ya, hapus" / "Batal" — no modal

---

### `IngredientsScreen` (new)

Props: `ingredients`, `userAvailability`, `onBack`, `onSaved`

Layout:
- Sticky header: "Kelola Bahan" + back button
- Scrollable list of ingredient cards
- FAB `+` button (bottom-right, fixed) to add a new ingredient

**Each ingredient card — two inline-expandable zones:**

```
┌─────────────────────────────────────────────┐
│  Tepung Ikan                    [✏️] [🗑️]  │
│  NETRAL · P 55% · L 8% · Serat 1%          │
│  Harga standar: Rp 15.000/kg               │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤
│  Ketersediaan saya              [Atur ▼]   │
│  (if set): 50 kg · Rp 17.000/kg · Kering  │
│  (if not): Belum diatur                    │
└─────────────────────────────────────────────┘
```

- Tapping ✏️ expands an inline catalog-edit form (all fields editable)
- Tapping 🗑️ shows inline confirm before delete
- Tapping "Atur ▼" expands an inline availability form (stokKg, hargaPerKg, kondisi, bentuk) with Save/Cancel
- Soft-deleted ingredients (statusTersedia=false) are hidden from this list but still in DB

**Add new ingredient** (FAB `+`): opens an inline panel at the top of the list with all catalog fields. On save → POST `/api/ingredients` → refreshes list.

---

### `FormScreen` + `Step3Ingredients`

`FormScreen` receives `userAvailability` as a prop. When mounted on step 3, `Step3Ingredients` calls a `getDefaultBahan()` helper that maps userAvailability records onto the initial bahan rows — ingredients with availability pre-fill their stok/harga/kondisi/bentuk. The user can still edit all values before submitting.

---

### `ResultScreen`

Props: `entry: RiwayatEntry`, `onBack`  
No structural changes — just extracted from `page.tsx` into its own file.

---

### Shared UI components

**`AppShell`** — wraps every screen in the `radial-gradient` outer div + `#F6F2E9` inner card. Accepts `children`.

**`StickyHeader`** — renders the sticky top bar. Props: `onBack?`, `title`, `subtitle?`, `right?` (slot for status chip or other content).

**`StickyFooter`** — renders the sticky bottom bar. Props: `children` (any buttons).

**`Pill`** — props: `selected: boolean`, `onClick`, `children`. Encapsulates the pill style function.

**`SmallPill`** — same as Pill but with small variant styles.

**`IngredientDropdown`** — self-contained dropdown for ingredient selection. Props: `ingredients`, `value`, `onChange`, `open`, `onToggle`. Used in Step3 rows.

---

## Data Flow

```
page.tsx
  ├── fetches /api/ingredients       → ingredients[]
  ├── fetches /api/user-ingredients  → userAvailability[]
  │
  ├── DashboardScreen
  │     └── shows riwayat + Kelola Bahan button
  │
  ├── IngredientsScreen
  │     ├── reads ingredients + userAvailability from props
  │     ├── calls PUT/POST/DELETE /api/ingredients
  │     ├── calls POST/DELETE /api/user-ingredients
  │     └── calls onSaved() → page.tsx re-fetches both lists
  │
  └── FormScreen
        └── Step3Ingredients
              └── uses userAvailability to pre-fill bahan rows
```

---

## Error Handling

- API errors surface as inline red banners (same pattern as current Step 4 apiError)
- Delete with referenced formulations → backend returns `{ softDeleted: true }` → frontend shows "Bahan disembunyikan (masih ada di riwayat lama)"
- Empty ingredient list on Step 3 → show instructional empty state with link to "Kelola Bahan"

---

## Out of Scope

- Auth (still uses dev@pelletq.local)
- MQTT / "Kirim ke Mesin" button
- LLM / Gemini integration
- SNI standards editing
- Rule parameters editing
