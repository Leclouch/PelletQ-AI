'use client';

import { useState, useEffect } from 'react';
import DashboardScreen from '@/components/screens/DashboardScreen';
import FormScreen from '@/components/screens/FormScreen';
import ResultScreen from '@/components/screens/ResultScreen';
import IngredientsScreen from '@/components/screens/IngredientsScreen';
import { Screen, FormData, RiwayatEntry, IngredientOption, UserIngredientAvailability, ApiResult, Diagnosa } from '@/lib/types';
import { DEFAULT_FORM, PHASE_MAP } from '@/lib/constants';
import { todayStr, getDefaultBahan } from '@/lib/helpers';

export default function HomePage() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [step, setStep] = useState(1);
  const [computing, setComputing] = useState(false);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [riwayat, setRiwayat] = useState<RiwayatEntry[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [openBahan, setOpenBahan] = useState<number | null>(null);
  const [openBahanDetails, setOpenBahanDetails] = useState<Record<number, boolean>>({});
  const [ingredients, setIngredients] = useState<IngredientOption[]>([]);
  const [userAvailability, setUserAvailability] = useState<UserIngredientAvailability[]>([]);
  const [fishSpeciesId, setFishSpeciesId] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [diagnosa, setDiagnosa] = useState<Diagnosa[] | null>(null);
  const [penjelasanGagal, setPenjelasanGagal] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('pelletq-riwayat');
    if (saved) { try { setRiwayat(JSON.parse(saved)); } catch {} }
    refreshIngredients();
    refreshAvailability();
  }, []);

  const refreshIngredients = async () => {
    try {
      const [ingRes, optRes] = await Promise.all([
        fetch('/api/ingredients'),
        fetch('/api/options'),
      ]);
      const ingData = await ingRes.json();
      const optData = await optRes.json();
      setIngredients(ingData.ingredients ?? []);
      const lele = (optData.species ?? []).find((s: { id: string; name: string }) => s.name === 'Lele Dumbo');
      if (lele) setFishSpeciesId(lele.id);
    } catch {}
  };

  const refreshAvailability = async () => {
    try {
      const res = await fetch('/api/user-ingredients');
      const data = await res.json();
      setUserAvailability(data.availability ?? []);
    } catch {}
  };

  const refreshAll = () => { refreshIngredients(); refreshAvailability(); };

  const saveRiwayat = (list: RiwayatEntry[]) => {
    setRiwayat(list);
    localStorage.setItem('pelletq-riwayat', JSON.stringify(list));
  };

  // ── Navigation ──────────────────────────────────────────────────────────────

  const goDash = () => { setScreen('dashboard'); setApiError(null); setDiagnosa(null); setPenjelasanGagal(null); };
  const goIngredients = () => setScreen('ingredients');

  const startForm = () => {
    setForm({ ...DEFAULT_FORM, bahan: getDefaultBahan(userAvailability, ingredients) });
    setOpenBahanDetails({});
    setStep(1);
    setScreen('form');
    setApiError(null);
    setDiagnosa(null);
    setPenjelasanGagal(null);
  };

  const prevStep = () => {
    if (step <= 1) { goDash(); } else { setStep(s => s - 1); scrollTo(0, 0); }
  };

  const nextStep = async () => {
    // Validasi bahan saat pindah dari langkah Bahan Baku (2) ke Ringkasan (3).
    if (step === 2 && form.bahan.filter(b => b.ingredientId).length < 3) {
      setApiError('Minimal 3 bahan baku harus dipilih.');
      return;
    }
    if (step < 3) { setStep(s => s + 1); scrollTo(0, 0); setApiError(null); return; }

    const validBahan = form.bahan.filter(b => b.ingredientId);
    if (validBahan.length < 3) { setApiError('Minimal 3 bahan baku harus dipilih.'); return; }
    if (!fishSpeciesId) { setApiError('Data spesies belum termuat. Coba refresh halaman.'); return; }

    setComputing(true); setApiError(null); setDiagnosa(null); setPenjelasanGagal(null);

    const body = {
      fishSpeciesId,
      phase: PHASE_MAP[form.fase] || 'GROWER',
      umurIkanHari: parseInt(form.umur) || 45,
      jumlahIkanEkor: parseInt(form.jumlah) || 1000,
      bobotRataRataGram: form.bobot ? parseFloat(form.bobot) : null,
      targetProduksiKgBatch: parseFloat(form.targetProduksi) || 25,
      bahanBaku: validBahan.map(b => ({
        ingredientId: b.ingredientId,
        stokKg: parseFloat(b.stok) || 999,
        hargaPerKg: parseFloat(b.harga) || (ingredients.find(i => i.id === b.ingredientId)?.hargaStandarPerKg ?? 10000),
      })),
    };

    try {
      const res = await fetch('/api/formulation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        setApiError(data.saran || data.error || 'Terjadi kesalahan.');
        setDiagnosa(data.diagnosa ?? null);
        setPenjelasanGagal(data.penjelasan ?? null);
        setComputing(false);
        return;
      }

      const result = data as ApiResult;
      const targetKg = parseFloat(form.targetProduksi) || 25;
      const entry: RiwayatEntry = {
        id: 'r' + Math.random().toString(36).slice(2, 7),
        nama: `Pakan ${form.fase} Lele`,
        tanggal: todayStr(),
        fase: form.fase, targetKg,
        totalBiayaRp: result.formulasi.totalBiayaRp,
        biayaPerKg: result.formulasi.totalBiayaRp / targetKg,
        sniOk: result.validasiSni.statusKeseluruhan === 'SESUAI',
        result,
      };
      saveRiwayat([entry, ...riwayat]);
      setActiveId(entry.id);
      setComputing(false);
      setScreen('result');
      scrollTo(0, 0);
    } catch {
      setApiError('Gagal terhubung ke server. Pastikan database aktif.');
      setComputing(false);
    }
  };

  // ── Riwayat handlers ────────────────────────────────────────────────────────

  const openDetail = (id: string) => { setActiveId(id); setScreen('result'); scrollTo(0, 0); };
  const startRename = (id: string) => { const r = riwayat.find(x => x.id === id); setRenamingId(id); setRenameValue(r?.nama ?? ''); };
  const saveRename = () => {
    if (!renamingId) return;
    const v = renameValue.trim();
    if (v) saveRiwayat(riwayat.map(r => r.id === renamingId ? { ...r, nama: v } : r));
    setRenamingId(null);
  };

  // ── Form handlers ────────────────────────────────────────────────────────────

  const setField = (name: keyof FormData, value: string) => setForm(f => ({ ...f, [name]: value }));
  const setChoice = (field: string, value: string) => setForm(f => ({ ...f, [field]: value }));
  const setBahanField = (idx: number, name: string, value: string) =>
    setForm(f => ({ ...f, bahan: f.bahan.map((b, j) => j === idx ? { ...b, [name]: value } : b) }));
  const selectIngredient = (idx: number, id: string, name: string) => {
    const ing = ingredients.find(i => i.id === id);
    const saved = userAvailability.find(a => a.ingredientId === id);
    setForm(f => ({
      ...f, bahan: f.bahan.map((b, j) => j === idx ? {
        ...b, ingredientId: id, nama: name,
        harga: saved ? String(saved.hargaPerKg) : (b.harga || String(ing?.hargaStandarPerKg ?? '')),
        stok: saved ? String(saved.stokKg) : b.stok,
      } : b),
    }));
    setOpenBahan(null);
  };
  const addBahan = () => { if (form.bahan.length >= 8) return; setForm(f => ({ ...f, bahan: [...f.bahan, { ingredientId: '', nama: '', stok: '', harga: '' }] })); };
  const removeBahan = (idx: number) => { if (form.bahan.length <= 3) return; setForm(f => ({ ...f, bahan: f.bahan.filter((_, j) => j !== idx) })); setOpenBahan(null); };
  const toggleBahanDetail = (idx: number) => setOpenBahanDetails(d => ({ ...d, [idx]: !d[idx] }));

  const active = riwayat.find(r => r.id === activeId);

  // ── Render ───────────────────────────────────────────────────────────────────

  if (screen === 'dashboard') return (
    <DashboardScreen
      riwayat={riwayat}
      fishSpeciesId={fishSpeciesId}
      renamingId={renamingId}
      renameValue={renameValue}
      deletingId={deletingId}
      onStart={startForm}
      onGoIngredients={goIngredients}
      onOpenDetail={openDetail}
      onStartRename={startRename}
      onRenameInput={setRenameValue}
      onSaveRename={saveRename}
      onCancelRename={() => setRenamingId(null)}
      onStartDelete={id => setDeletingId(id)}
      onConfirmDelete={id => { saveRiwayat(riwayat.filter(r => r.id !== id)); setDeletingId(null); }}
      onCancelDelete={() => setDeletingId(null)}
    />
  );

  if (screen === 'form') return (
    <FormScreen
      form={form} step={step} ingredients={ingredients}
      computing={computing} apiError={apiError} diagnosa={diagnosa} penjelasanGagal={penjelasanGagal}
      openBahan={openBahan} openBahanDetails={openBahanDetails}
      onGoDash={goDash} onPrevStep={prevStep} onNextStep={nextStep}
      onField={setField} onChoice={setChoice}
      onBahanField={setBahanField}
      onSelectIngredient={selectIngredient}
      onToggleMenu={setOpenBahan}
      onToggleDetail={toggleBahanDetail}
      onCloseMenus={() => setOpenBahan(null)}
      onAddBahan={addBahan} onRemoveBahan={removeBahan}
    />
  );

  if (screen === 'result' && active) return (
    <ResultScreen entry={active} onBack={goDash} />
  );

  if (screen === 'ingredients') return (
    <IngredientsScreen
      ingredients={ingredients}
      userAvailability={userAvailability}
      onBack={goDash}
      onSaved={refreshAll}
    />
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <button onClick={goDash} style={{ color: '#1A8A5E', fontWeight: 800, cursor: 'pointer', fontSize: 14 }}>← Beranda</button>
    </div>
  );
}
