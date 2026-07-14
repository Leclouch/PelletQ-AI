'use client';

import AppShell from '@/components/ui/AppShell';
import StickyHeader from '@/components/ui/StickyHeader';
import StickyFooter from '@/components/ui/StickyFooter';
import Step1Fish from '@/components/form-steps/Step1Fish';
import Step3Ingredients from '@/components/form-steps/Step3Ingredients';
import Step3Summary from '@/components/form-steps/Step3Summary';
import { FormData, IngredientOption, Diagnosa } from '@/lib/types';

interface FormScreenProps {
  form: FormData;
  step: number;
  ingredients: IngredientOption[];
  computing: boolean;
  apiError: string | null;
  diagnosa: Diagnosa[] | null;
  openBahan: number | null;
  openBahanDetails: Record<number, boolean>;
  onGoDash: () => void;
  onPrevStep: () => void;
  onNextStep: () => void;
  onField: (name: keyof FormData, value: string) => void;
  onChoice: (field: string, value: string) => void;
  onBahanField: (idx: number, name: string, value: string) => void;
  onSelectIngredient: (idx: number, id: string, name: string) => void;
  onToggleMenu: (idx: number | null) => void;
  onToggleDetail: (idx: number) => void;
  onCloseMenus: () => void;
  onAddBahan: () => void;
  onRemoveBahan: (idx: number) => void;
}

const STEP_TITLES = ['Data Ikan', 'Bahan Baku', 'Ringkasan'];

export default function FormScreen({
  form, step, ingredients, computing, apiError, diagnosa,
  openBahan, openBahanDetails,
  onGoDash, onPrevStep, onNextStep, onField, onChoice,
  onBahanField, onSelectIngredient,
  onToggleMenu, onToggleDetail, onCloseMenus, onAddBahan, onRemoveBahan,
}: FormScreenProps) {
  return (
    <AppShell>
      <StickyHeader
        onBack={onGoDash}
        title="Buat Formulasi"
        subtitle={`Langkah ${step} dari 3 · ${STEP_TITLES[step - 1]}`}
      >
        <div style={{ display: 'flex', gap: 7 }}>
          {[1, 2, 3].map(n => (
            <div key={n} style={{ flex: 1, height: 5, borderRadius: 999, background: n <= step ? '#1A8A5E' : '#E6E0D1', transition: 'background .25s' }} />
          ))}
        </div>
      </StickyHeader>

      <div style={{ flex: 1, padding: '18px 18px 120px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {step === 1 && <Step1Fish form={form} onField={onField} onChoice={onChoice} />}
        {step === 2 && (
          <Step3Ingredients
            form={form}
            ingredients={ingredients}
            openBahan={openBahan}
            openBahanDetails={openBahanDetails}
            onAddBahan={onAddBahan}
            onRemoveBahan={onRemoveBahan}
            onBahanField={onBahanField}
            onSelectIngredient={onSelectIngredient}
            onToggleMenu={onToggleMenu}
            onToggleDetail={onToggleDetail}
            onCloseMenus={onCloseMenus}
          />
        )}
        {step === 3 && <Step3Summary form={form} onField={onField} apiError={apiError} diagnosa={diagnosa} />}
      </div>

      <StickyFooter>
        <button onClick={onPrevStep} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '15px 20px', borderRadius: 14, background: '#fff', border: '1.5px solid #E2DDCE', color: '#46554E', fontSize: 15, fontWeight: 800, cursor: 'pointer', flexShrink: 0 }}>
          {step === 1 ? 'Batal' : 'Kembali'}
        </button>
        <button onClick={onNextStep} disabled={computing} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 15, borderRadius: 14, background: computing ? '#E8E2D4' : 'linear-gradient(135deg,#1A8A5E 0%,#11623F 100%)', color: computing ? '#A6AFA7' : '#fff', fontSize: 15.5, fontWeight: 800, cursor: computing ? 'not-allowed' : 'pointer', boxShadow: computing ? 'none' : '0 6px 16px rgba(17,98,63,.24)' }}>
          {step === 3 ? 'Hitung Formulasi ✨' : 'Lanjut →'}
        </button>
      </StickyFooter>

      {computing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(246,242,233,.86)', backdropFilter: 'blur(6px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <div style={{ width: 58, height: 58, borderRadius: '50%', border: '5px solid #E4F1E9', borderTopColor: '#1A8A5E', animation: 'spin .8s linear infinite' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 800 }}>Menghitung formulasi…</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#7C8A82', marginTop: 4 }}>Menyeimbangkan nutrisi & biaya</div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
