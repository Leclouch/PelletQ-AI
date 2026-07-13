"use client";

import { useEffect, useState } from "react";

// ============================================================
// Tipe
// ============================================================
type Species = { id: string; name: string; phases: string[] };
type Ingredient = {
  id: string;
  name: string;
  hargaStandarPerKg: number;
  karakterBahan: string;
  proteinPct: number;
};
type Options = { species: Species[]; ingredients: Ingredient[] };

type BahanRow = {
  ingredientId: string;
  name: string;
  include: boolean;
  stokKg: number;
  hargaPerKg: number;
  kondisiBahan: string;
  bentukBahan: string;
};

// ============================================================
// Konstanta pilihan
// ============================================================
const PHASES = ["BENIH", "GROWER", "FINISHER", "INDUK"];
const JENIS_PELET = ["TERAPUNG", "TENGGELAM"];
const PANJANG = ["", "PENDEK", "SEDANG", "PANJANG"];
const PRIORITAS = ["TERMURAH", "SEIMBANG", "NUTRISI_TINGGI"];
const MODE = ["MANUAL", "OTOMATIS"];
const KONDISI = ["KERING", "AGAK_LEMBAP", "BASAH"];
const BENTUK = ["HALUS", "SEDANG", "KASAR"];

// ============================================================
// Style helper (inline, tanpa dependency)
// ============================================================
const card: React.CSSProperties = {
  border: "1px solid #d0d7de",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  background: "#fff",
};
const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 4, color: "#24292f" };
const input: React.CSSProperties = { width: "100%", padding: "6px 8px", border: "1px solid #d0d7de", borderRadius: 6, fontSize: 14, boxSizing: "border-box" };
const th: React.CSSProperties = { textAlign: "left", fontSize: 12, padding: "6px 8px", borderBottom: "2px solid #d0d7de", color: "#57606a" };
const td: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid #eaeef2", fontSize: 13 };

export default function TestPage() {
  const [opts, setOpts] = useState<Options | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // form state
  const [fishSpeciesId, setFishSpeciesId] = useState("");
  const [phase, setPhase] = useState("GROWER");
  const [umurIkanHari, setUmur] = useState(45);
  const [jumlahIkanEkor, setJumlah] = useState(7000);
  const [bobotRataRataGram, setBobot] = useState(20);
  const [jenisPelet, setJenisPelet] = useState("TERAPUNG");
  const [diameterPelletMm, setDiameter] = useState(2.5);
  const [panjangPelet, setPanjang] = useState("SEDANG");
  const [targetProduksiKgBatch, setTarget] = useState(5);
  const [prioritas, setPrioritas] = useState("TERMURAH");
  const [modeOperasi, setMode] = useState("MANUAL");
  const [bahan, setBahan] = useState<BahanRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errorResp, setErrorResp] = useState<any>(null);

  // load options
  useEffect(() => {
    fetch("/api/options")
      .then((r) => r.json())
      .then((d: Options) => {
        setOpts(d);
        if (d.species[0]) setFishSpeciesId(d.species[0].id);
        // default: bahan yang dipakai di test, lainnya tersedia tapi unchecked
        const defaultUsed = ["Tepung Ikan", "Bungkil Kedelai", "Tepung Jagung", "Dedak Padi", "Tapioka"];
        setBahan(
          d.ingredients.map((i) => ({
            ingredientId: i.id,
            name: i.name,
            include: defaultUsed.includes(i.name),
            stokKg: 5,
            hargaPerKg: i.hargaStandarPerKg,
            kondisiBahan: "KERING",
            bentukBahan: "HALUS",
          }))
        );
      })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  function updateBahan(id: string, patch: Partial<BahanRow>) {
    setBahan((prev) => prev.map((b) => (b.ingredientId === id ? { ...b, ...patch } : b)));
  }

  const selectedSpecies = opts?.species.find((s) => s.id === fishSpeciesId);
  const availablePhases = selectedSpecies?.phases.length ? selectedSpecies.phases : PHASES;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setErrorResp(null);

    const body = {
      fishSpeciesId,
      phase,
      umurIkanHari: Number(umurIkanHari),
      jumlahIkanEkor: Number(jumlahIkanEkor),
      bobotRataRataGram: Number(bobotRataRataGram),
      jenisPelet,
      diameterPelletMm: Number(diameterPelletMm),
      panjangPelet: panjangPelet || null,
      targetProduksiKgBatch: Number(targetProduksiKgBatch),
      prioritas,
      modeOperasi,
      bahanBaku: bahan
        .filter((b) => b.include)
        .map((b) => ({
          ingredientId: b.ingredientId,
          stokKg: Number(b.stokKg),
          hargaPerKg: Number(b.hargaPerKg),
          kondisiBahan: b.kondisiBahan,
          bentukBahan: b.bentukBahan,
        })),
    };

    try {
      const res = await fetch("/api/formulation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) setResult(data);
      else setErrorResp({ status: res.status, ...data });
    } catch (err) {
      setErrorResp({ error: String(err) });
    } finally {
      setLoading(false);
    }
  }

  if (loadErr)
    return <main style={{ padding: 24 }}>Gagal memuat opsi: {loadErr}. Pastikan DB & dev server jalan.</main>;
  if (!opts) return <main style={{ padding: 24 }}>Memuat…</main>;

  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1f2328" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>PelletQ-AI — Uji Formulasi</h1>
      <p style={{ color: "#57606a", marginTop: 0, fontSize: 14 }}>
        Form pengujian endpoint <code>POST /api/formulation</code>. Lihat juga{" "}
        <a href="/docs" style={{ color: "#0969da" }}>dokumentasi Swagger</a>.
      </p>

      <form onSubmit={submit}>
        {/* Data ikan & pelet */}
        <div style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Data Ikan & Pelet</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            <div>
              <label style={label}>Spesies</label>
              <select style={input} value={fishSpeciesId} onChange={(e) => setFishSpeciesId(e.target.value)}>
                {opts.species.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={label}>Fase</label>
              <select style={input} value={phase} onChange={(e) => setPhase(e.target.value)}>
                {availablePhases.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Prioritas</label>
              <select style={input} value={prioritas} onChange={(e) => setPrioritas(e.target.value)}>
                {PRIORITAS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Umur ikan (hari)</label>
              <input style={input} type="number" value={umurIkanHari} onChange={(e) => setUmur(+e.target.value)} />
            </div>
            <div>
              <label style={label}>Jumlah ikan (ekor)</label>
              <input style={input} type="number" value={jumlahIkanEkor} onChange={(e) => setJumlah(+e.target.value)} />
            </div>
            <div>
              <label style={label}>Bobot rata-rata (gram)</label>
              <input style={input} type="number" value={bobotRataRataGram} onChange={(e) => setBobot(+e.target.value)} />
            </div>
            <div>
              <label style={label}>Jenis pelet</label>
              <select style={input} value={jenisPelet} onChange={(e) => setJenisPelet(e.target.value)}>
                {JENIS_PELET.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Diameter (mm)</label>
              <input style={input} type="number" step="0.1" value={diameterPelletMm} onChange={(e) => setDiameter(+e.target.value)} />
            </div>
            <div>
              <label style={label}>Panjang pelet</label>
              <select style={input} value={panjangPelet} onChange={(e) => setPanjang(e.target.value)}>
                {PANJANG.map((p) => <option key={p} value={p}>{p || "(kosong)"}</option>)}
              </select>
            </div>
            <div>
              <label style={label}>Target produksi (kg/batch)</label>
              <input style={input} type="number" step="0.1" value={targetProduksiKgBatch} onChange={(e) => setTarget(+e.target.value)} />
            </div>
            <div>
              <label style={label}>Mode operasi</label>
              <select style={input} value={modeOperasi} onChange={(e) => setMode(e.target.value)}>
                {MODE.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Bahan baku */}
        <div style={card}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Bahan Baku Tersedia</h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Pakai</th>
                <th style={th}>Bahan</th>
                <th style={th}>Karakter</th>
                <th style={th}>Stok (kg)</th>
                <th style={th}>Harga/kg</th>
                <th style={th}>Kondisi</th>
                <th style={th}>Bentuk</th>
              </tr>
            </thead>
            <tbody>
              {bahan.map((b) => {
                const meta = opts.ingredients.find((i) => i.id === b.ingredientId);
                return (
                  <tr key={b.ingredientId} style={{ opacity: b.include ? 1 : 0.5 }}>
                    <td style={td}>
                      <input type="checkbox" checked={b.include} onChange={(e) => updateBahan(b.ingredientId, { include: e.target.checked })} />
                    </td>
                    <td style={td}>{b.name}</td>
                    <td style={{ ...td, fontSize: 11, color: meta?.karakterBahan === "MUDAH_MENGIKAT" ? "#1a7f37" : "#57606a" }}>
                      {meta?.karakterBahan}
                    </td>
                    <td style={td}>
                      <input style={{ ...input, width: 70 }} type="number" step="0.1" value={b.stokKg} onChange={(e) => updateBahan(b.ingredientId, { stokKg: +e.target.value })} />
                    </td>
                    <td style={td}>
                      <input style={{ ...input, width: 90 }} type="number" value={b.hargaPerKg} onChange={(e) => updateBahan(b.ingredientId, { hargaPerKg: +e.target.value })} />
                    </td>
                    <td style={td}>
                      <select style={{ ...input, width: 120 }} value={b.kondisiBahan} onChange={(e) => updateBahan(b.ingredientId, { kondisiBahan: e.target.value })}>
                        {KONDISI.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                    <td style={td}>
                      <select style={{ ...input, width: 100 }} value={b.bentukBahan} onChange={(e) => updateBahan(b.ingredientId, { bentukBahan: e.target.value })}>
                        {BENTUK.map((k) => <option key={k} value={k}>{k}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{ background: "#1f883d", color: "#fff", border: 0, borderRadius: 6, padding: "10px 20px", fontSize: 15, fontWeight: 600, cursor: loading ? "wait" : "pointer" }}
        >
          {loading ? "Menghitung…" : "Hitung Formulasi"}
        </button>
      </form>

      {/* Error */}
      {errorResp && (
        <div style={{ ...card, borderColor: "#cf222e", background: "#fff5f5", marginTop: 16 }}>
          <strong style={{ color: "#cf222e" }}>Error {errorResp.status ?? ""}</strong>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>{JSON.stringify(errorResp, null, 2)}</pre>
        </div>
      )}

      {/* Result */}
      {result && <ResultView result={result} />}
    </main>
  );
}

function Badge({ status }: { status: string }) {
  const ok = status === "SESUAI";
  return (
    <span style={{ background: ok ? "#dafbe1" : "#ffebe9", color: ok ? "#1a7f37" : "#cf222e", padding: "2px 8px", borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {status}
    </span>
  );
}

function ResultView({ result }: { result: any }) {
  const f = result.formulasi;
  const v = result.validasiSni;
  const m = result.parameterMesin;
  return (
    <div style={{ marginTop: 16 }}>
      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>
          Hasil Formulasi — Status SNI: <Badge status={v.statusKeseluruhan} />
        </h2>
        <p style={{ fontSize: 14 }}>
          Total biaya: <strong>Rp {f.totalBiayaRp.toLocaleString("id-ID")}</strong>
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Bahan</th><th style={th}>Jumlah (kg)</th><th style={th}>%</th><th style={th}>Harga/kg</th></tr></thead>
          <tbody>
            {f.ingredients.map((i: any) => (
              <tr key={i.ingredientId}>
                <td style={td}>{i.name}</td>
                <td style={td}>{i.jumlahKg}</td>
                <td style={td}>{i.persentase}%</td>
                <td style={td}>Rp {i.hargaPerKg.toLocaleString("id-ID")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontSize: 13, color: "#57606a", marginBottom: 0 }}>
          Estimasi nutrisi — protein {f.estimasiNutrisi.proteinPct}%, lemak {f.estimasiNutrisi.lemakPct}%, serat {f.estimasiNutrisi.seratKasarPct}%, abu {f.estimasiNutrisi.abuPct}%, air {f.estimasiNutrisi.kadarAirPct}%
        </p>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Validasi SNI</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Parameter</th><th style={th}>Nilai</th><th style={th}>Batas</th><th style={th}>Status</th></tr></thead>
          <tbody>
            {v.items.map((it: any) => (
              <tr key={it.parameter}>
                <td style={td}>{it.parameter}</td>
                <td style={td}>{it.nilai}</td>
                <td style={td}>{it.batasSni}</td>
                <td style={td}><Badge status={it.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Parameter Mesin</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, fontSize: 14 }}>
          <div>Suhu heater: <strong>{m.suhuHeaterCelcius}°C</strong></div>
          <div>Extruder: <strong>{m.kecepatanExtruderRpm} RPM</strong></div>
          <div>Pisau: <strong>{m.kecepatanPisauRpm} RPM</strong></div>
          <div>Mixing: <strong>{m.waktuMixingMenit} menit</strong></div>
          <div>Kadar air adonan: <strong>{m.targetKadarAirAdonanPct}%</strong></div>
          <div>Air tambahan: <strong>{m.estimasiAirTambahanMl} ml</strong></div>
        </div>
        <ol style={{ fontSize: 13, color: "#57606a", marginBottom: 0 }}>
          {m.urutanProses.map((s: string, idx: number) => <li key={idx}>{s.replace(/^\d+\.\s*/, "")}</li>)}
        </ol>
      </div>

      {result.peringatan?.length > 0 && (
        <div style={{ ...card, borderColor: "#d4a72c", background: "#fff8c5" }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Peringatan</h2>
          {result.peringatan.map((w: any, idx: number) => (
            <div key={idx} style={{ fontSize: 13, marginBottom: 6 }}>
              <strong>[{w.severity}] {w.jenis}</strong> — {w.rekomendasi}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
