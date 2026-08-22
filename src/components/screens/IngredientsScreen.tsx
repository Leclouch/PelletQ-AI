'use client';

import { useState } from 'react';
import AppShell from '@/components/ui/AppShell';
import StickyHeader from '@/components/ui/StickyHeader';
import BottomNav from '@/components/ui/BottomNav';
import { IngredientOption, UserIngredientAvailability } from '@/lib/types';
import { KARAKTER_DISPLAY, KARAKTER_OPTIONS } from '@/lib/constants';
import { rp } from '@/lib/helpers';

interface IngredientsScreenProps {
  ingredients: IngredientOption[];
  userAvailability: UserIngredientAvailability[];
  onBack: () => void;
  onSaved: () => void;
  onStartForm: () => void;
  onGoHelp: () => void;
  onLogout: () => void;
}

interface CatalogForm {
  name: string; proteinPct: string; lemakPct: string; seratKasarPct: string;
  abuPct: string; kadarAirPct: string; karakterBahan: string; hargaStandarPerKg: string;
}
interface AvailForm { stokKg: string; hargaPerKg: string; }

const EMPTY_CAT: CatalogForm = { name: '', proteinPct: '', lemakPct: '', seratKasarPct: '', abuPct: '', kadarAirPct: '', karakterBahan: 'NETRAL', hargaStandarPerKg: '' };
const EMPTY_AVAIL: AvailForm = { stokKg: '', hargaPerKg: '' };

const fieldStyle: React.CSSProperties = { width: '100%', padding: '10px 11px', border: '1.5px solid #E2DDCE', borderRadius: 11, fontSize: 14, fontWeight: 700, background: '#FCFBF7', color: '#1C2E27' };
const labelStyle: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#9AA69E', marginBottom: 4, display: 'block' };

function CatalogFields({ form, onChange }: { form: CatalogForm; onChange: (k: keyof CatalogForm, v: string) => void }) {
  const numFields: { key: keyof CatalogForm; label: string }[] = [
    { key: 'proteinPct', label: 'Protein' }, { key: 'lemakPct', label: 'Lemak' },
    { key: 'seratKasarPct', label: 'Serat Kasar' }, { key: 'abuPct', label: 'Abu' },
    { key: 'kadarAirPct', label: 'Kadar Air' },
  ];
  return (
    <>
      <div>
        <label style={labelStyle}>Nama Bahan</label>
        <input value={form.name} onChange={e => onChange('name', e.target.value)} placeholder="mis. Tepung Ikan" style={fieldStyle} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {numFields.map(({ key, label }) => (
          <div key={key}>
            <label style={labelStyle}>{label}</label>
            <div style={{ position: 'relative' }}>
              <input value={form[key]} onChange={e => onChange(key, e.target.value)} inputMode="decimal" style={{ ...fieldStyle, paddingRight: 28 }} />
              <span style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9AA69E', fontWeight: 600 }}>%</span>
            </div>
          </div>
        ))}
        <div>
          <label style={labelStyle}>Harga Standar</label>
          <div style={{ position: 'relative' }}>
            <input value={form.hargaStandarPerKg} onChange={e => onChange('hargaStandarPerKg', e.target.value)} inputMode="numeric" style={{ ...fieldStyle, paddingLeft: 26 }} />
            <span style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: '#9AA69E', fontWeight: 600 }}>Rp</span>
          </div>
        </div>
      </div>
      <div>
        <label style={labelStyle}>Karakter Bahan</label>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {KARAKTER_OPTIONS.map(v => (
            <button key={v} onClick={() => onChange('karakterBahan', v)} style={{ padding: '6px 10px', borderRadius: 8, fontSize: 11, fontWeight: form.karakterBahan === v ? 800 : 600, background: form.karakterBahan === v ? '#E1EBFB' : '#F6F3EA', color: form.karakterBahan === v ? '#1D4ED8' : '#6B7A6F', border: `1px solid ${form.karakterBahan === v ? '#2563EB' : '#E7E1D2'}`, cursor: 'pointer' }}>
              {KARAKTER_DISPLAY[v]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

export default function IngredientsScreen({ ingredients, userAvailability, onBack, onSaved, onStartForm, onGoHelp, onLogout }: IngredientsScreenProps) {
  const [expandedCatalog, setExpandedCatalog] = useState<string | null>(null);
  const [expandedAvail, setExpandedAvail] = useState<string | null>(null);
  const [catalogForms, setCatalogForms] = useState<Record<string, CatalogForm>>({});
  const [availForms, setAvailForms] = useState<Record<string, AvailForm>>({});
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState<CatalogForm>(EMPTY_CAT);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getAvail = (ingredientId: string) => userAvailability.find(a => a.ingredientId === ingredientId);

  const startEditCatalog = (ing: IngredientOption) => {
    setCatalogForms(f => ({
      ...f,
      [ing.id]: { name: ing.name, proteinPct: String(ing.proteinPct), lemakPct: String(ing.lemakPct), seratKasarPct: String(ing.seratKasarPct), abuPct: String(ing.abuPct), kadarAirPct: String(ing.kadarAirPct), karakterBahan: ing.karakterBahan, hargaStandarPerKg: String(ing.hargaStandarPerKg) },
    }));
    setExpandedCatalog(expandedCatalog === ing.id ? null : ing.id);
    setExpandedAvail(null);
  };

  const startEditAvail = (ing: IngredientOption) => {
    const existing = getAvail(ing.id);
    setAvailForms(f => ({
      ...f,
      [ing.id]: existing
        ? { stokKg: String(existing.stokKg), hargaPerKg: String(existing.hargaPerKg) }
        : { ...EMPTY_AVAIL, hargaPerKg: String(ing.hargaStandarPerKg) },
    }));
    setExpandedAvail(expandedAvail === ing.id ? null : ing.id);
    setExpandedCatalog(null);
  };

  const saveCatalog = async (id: string) => {
    const f = catalogForms[id];
    if (!f?.name.trim()) return;
    setSaving(id + '-cat'); setError(null);
    try {
      const res = await fetch(`/api/ingredients/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: f.name.trim(), proteinPct: parseFloat(f.proteinPct) || 0, lemakPct: parseFloat(f.lemakPct) || 0, seratKasarPct: parseFloat(f.seratKasarPct) || 0, abuPct: parseFloat(f.abuPct) || 0, kadarAirPct: parseFloat(f.kadarAirPct) || 0, karakterBahan: f.karakterBahan, hargaStandarPerKg: parseFloat(f.hargaStandarPerKg) || 0 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setExpandedCatalog(null); onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  };

  const saveAvail = async (ingredientId: string) => {
    const f = availForms[ingredientId];
    if (!f) return;
    setSaving(ingredientId + '-avail'); setError(null);
    try {
      const res = await fetch('/api/user-ingredients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredientId, stokKg: parseFloat(f.stokKg) || 0, hargaPerKg: parseFloat(f.hargaPerKg) || 0, kondisi: 'KERING', bentuk: null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setExpandedAvail(null); onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  };

  const deleteAvail = async (availId: string) => {
    setSaving(availId + '-del-avail');
    try { await fetch(`/api/user-ingredients/${availId}`, { method: 'DELETE' }); onSaved(); }
    finally { setSaving(null); }
  };

  const deleteIngredient = async (id: string) => {
    setSaving(id + '-del'); setError(null);
    try {
      const res = await fetch(`/api/ingredients/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      if (data.softDeleted) setError('Bahan disembunyikan (masih dipakai di riwayat formulasi lama).');
      setDeleteConfirm(null); onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  };

  const addIngredient = async () => {
    if (!newForm.name.trim()) return;
    setSaving('new'); setError(null);
    try {
      const res = await fetch('/api/ingredients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newForm.name.trim(), proteinPct: parseFloat(newForm.proteinPct) || 0, lemakPct: parseFloat(newForm.lemakPct) || 0, seratKasarPct: parseFloat(newForm.seratKasarPct) || 0, abuPct: parseFloat(newForm.abuPct) || 0, kadarAirPct: parseFloat(newForm.kadarAirPct) || 0, karakterBahan: newForm.karakterBahan, hargaStandarPerKg: parseFloat(newForm.hargaStandarPerKg) || 0 }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setNewForm(EMPTY_CAT); setAddingNew(false); onSaved();
    } catch (e: any) { setError(e.message); }
    finally { setSaving(null); }
  };

  const visibleIngredients = ingredients.filter(i => i.statusTersedia || userAvailability.some(a => a.ingredientId === i.id));

  return (
    <AppShell>
      <StickyHeader
        onBack={onBack}
        title="Kelola Bahan"
        subtitle={`${visibleIngredients.length} bahan baku`}
        right={
          <button onClick={() => { setAddingNew(true); scrollTo(0, 0); document.querySelector('.app-shell-inner')?.scrollTo({ top: 0 }); }} title="Tambah Bahan Baru" style={{ width: 38, height: 38, borderRadius: 12, background: 'linear-gradient(135deg,#2563EB 0%,#1D4ED8 100%)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: 'none' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        }
      />

      <div style={{ flex: 1, padding: '18px 18px 132px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {error && (
          <div style={{ background: '#FBE7E1', border: '1px solid #E2A593', borderRadius: 12, padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#8F3520', lineHeight: 1.4 }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 10, fontSize: 12, fontWeight: 800, color: '#8F3520', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Add new form */}
        {addingNew && (
          <div style={{ background: '#E1EBFB', border: '1.5px solid #2563EB', borderRadius: 18, padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1D4ED8' }}>Tambah Bahan Baru</div>
            <CatalogFields form={newForm} onChange={(k, v) => setNewForm(f => ({ ...f, [k]: v }))} />
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => { setAddingNew(false); setNewForm(EMPTY_CAT); }} style={{ flex: 1, padding: 12, borderRadius: 12, background: '#fff', border: '1.5px solid #E2DDCE', color: '#46554E', fontWeight: 700, cursor: 'pointer' }}>Batal</button>
              <button onClick={addIngredient} disabled={saving === 'new' || !newForm.name.trim()} style={{ flex: 2, padding: 12, borderRadius: 12, background: '#2563EB', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: !newForm.name.trim() ? 0.6 : 1 }}>
                {saving === 'new' ? 'Menyimpan…' : 'Simpan Bahan'}
              </button>
            </div>
          </div>
        )}

        {visibleIngredients.map(ing => {
          const avail = getAvail(ing.id);
          const catOpen = expandedCatalog === ing.id;
          const availOpen = expandedAvail === ing.id;
          const catForm = catalogForms[ing.id];
          const avForm = availForms[ing.id];

          return (
            <div key={ing.id} style={{ background: '#fff', border: '1px solid #ECE6D8', borderRadius: 18, overflow: 'hidden', boxShadow: '0 1px 2px rgba(28,46,39,.04)' }}>
              {/* Catalog section */}
              <div style={{ padding: '14px 14px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#1C2E27' }}>{ing.name}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#9AA69E', marginTop: 3 }}>
                      <span style={{ background: '#F0F0E8', borderRadius: 6, padding: '1px 6px', marginRight: 6, fontSize: 11, fontWeight: 700, color: '#6B7A6F' }}>{KARAKTER_DISPLAY[ing.karakterBahan] ?? ing.karakterBahan}</span>
                      P {ing.proteinPct}% · L {ing.lemakPct}% · Serat {ing.seratKasarPct}%
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#B3BCB4', marginTop: 2 }}>Harga standar: {rp(ing.hargaStandarPerKg)}/kg</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => startEditCatalog(ing)} style={{ width: 32, height: 32, borderRadius: 9, background: catOpen ? '#E1EBFB' : '#F6F3EA', border: `1px solid ${catOpen ? '#2563EB' : '#E7E1D2'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={catOpen ? '#1D4ED8' : '#7C8A80'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    {deleteConfirm === ing.id ? (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => deleteIngredient(ing.id)} disabled={saving === ing.id + '-del'} style={{ fontSize: 11, fontWeight: 800, padding: '4px 9px', borderRadius: 8, background: '#C06A4E', color: '#fff', cursor: 'pointer' }}>Hapus</button>
                        <button onClick={() => setDeleteConfirm(null)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 8, background: '#F0EDE5', color: '#46554E', cursor: 'pointer' }}>Batal</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(ing.id)} style={{ width: 32, height: 32, borderRadius: 9, background: '#FBEDE7', border: '1px solid #EDC4BB', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#C06A4E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                      </button>
                    )}
                  </div>
                </div>

                {catOpen && catForm && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <CatalogFields form={catForm} onChange={(k, v) => setCatalogForms(f => ({ ...f, [ing.id]: { ...f[ing.id], [k]: v } }))} />
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setExpandedCatalog(null)} style={{ flex: 1, padding: 10, borderRadius: 10, background: '#F0EDE5', color: '#46554E', fontWeight: 700, cursor: 'pointer' }}>Batal</button>
                      <button onClick={() => saveCatalog(ing.id)} disabled={saving === ing.id + '-cat'} style={{ flex: 2, padding: 10, borderRadius: 10, background: '#2563EB', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                        {saving === ing.id + '-cat' ? 'Menyimpan…' : 'Simpan'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ height: 1, background: '#F2EEE2', margin: '0 14px' }} />

              {/* Availability section */}
              <div style={{ padding: '12px 14px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#46554E' }}>Ketersediaan saya</div>
                    {avail ? (
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#9AA69E', marginTop: 2 }}>
                        {avail.stokKg} kg · {rp(avail.hargaPerKg)}/kg
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, fontWeight: 600, color: '#B3BCB4', marginTop: 2 }}>Belum diatur</div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    {avail && (
                      <button onClick={() => deleteAvail(avail.id)} disabled={saving === avail.id + '-del-avail'} style={{ fontSize: 11, fontWeight: 700, padding: '5px 9px', borderRadius: 8, background: '#FBEDE7', color: '#C06A4E', cursor: 'pointer' }}>Hapus</button>
                    )}
                    <button onClick={() => startEditAvail(ing)} style={{ fontSize: 12, fontWeight: 800, padding: '5px 11px', borderRadius: 9, background: availOpen ? '#E1EBFB' : '#F6F3EA', border: `1px solid ${availOpen ? '#2563EB' : '#E7E1D2'}`, color: availOpen ? '#1D4ED8' : '#46554E', cursor: 'pointer' }}>
                      {avail ? 'Edit' : 'Atur'} {availOpen ? '▲' : '▼'}
                    </button>
                  </div>
                </div>

                {availOpen && avForm && (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1, position: 'relative' }}>
                        <input value={avForm.stokKg} onChange={e => setAvailForms(f => ({ ...f, [ing.id]: { ...f[ing.id], stokKg: e.target.value } }))} inputMode="numeric" placeholder="Stok" style={{ ...fieldStyle, paddingRight: 36 }} />
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#9AA69E' }}>kg</span>
                      </div>
                      <div style={{ flex: 1.3, position: 'relative' }}>
                        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, fontWeight: 700, color: '#9AA69E' }}>Rp</span>
                        <input value={avForm.hargaPerKg} onChange={e => setAvailForms(f => ({ ...f, [ing.id]: { ...f[ing.id], hargaPerKg: e.target.value } }))} inputMode="numeric" placeholder="Harga" style={{ ...fieldStyle, padding: '10px 32px 10px 30px' }} />
                        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 600, color: '#9AA69E' }}>/kg</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => setExpandedAvail(null)} style={{ flex: 1, padding: 10, borderRadius: 10, background: '#F0EDE5', color: '#46554E', fontWeight: 700, cursor: 'pointer' }}>Batal</button>
                      <button onClick={() => saveAvail(ing.id)} disabled={saving === ing.id + '-avail'} style={{ flex: 2, padding: 10, borderRadius: 10, background: '#2563EB', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>
                        {saving === ing.id + '-avail' ? 'Menyimpan…' : 'Simpan Ketersediaan'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <BottomNav
        active="ingredients"
        onGoDash={onBack}
        onGoIngredients={() => {}}
        onStartForm={onStartForm}
        onGoHelp={onGoHelp}
        onLogout={onLogout}
      />
    </AppShell>
  );
}
