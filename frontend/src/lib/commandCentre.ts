// Shared command-centre contract types + design-figure fallback for the views
// that read GET /api/command-centre/functions (§2): Operating and Overview.
// Payload shapes mirror backend src/services/commandCentreService.js.

import { functionsRaw, compositionDefs, obsSentence, opKpis } from './designData';

export type KpiTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface OpKpi {
  eyebrow: string;
  value: string;
  note: string;
  tone: KpiTone;
}

export interface OpComposition {
  label: string;
  approved: number;
  spent: number;
  tone: string;
}

export interface OpFunction {
  name: string;
  budget: number;
  used_pct: number;
  spent: number;
  remaining: number;
  status: 'ok' | 'tight' | 'over';
}

export interface OperatingPayload {
  generated_at: string;
  period: { label: string; elapsed_pct: number };
  kpis: OpKpi[];
  composition: OpComposition[];
  observation: string;
  functions: OpFunction[];
}

// ---------------------------------------------------------------------------
// Fallback (design figures, shaped exactly like the contract payload)
// ---------------------------------------------------------------------------

const KPI_TONES: KpiTone[] = ['neutral', 'neutral', 'bad', 'warn'];

export const OPERATING_FALLBACK: OperatingPayload = {
  generated_at: '2026-05-31T10:00:00',
  period: { label: 'FY2026 to date', elapsed_pct: 42 },
  kpis: opKpis.map((k, i) => ({ eyebrow: k.eyebrow, value: k.value, note: k.note, tone: KPI_TONES[i] })),
  composition: compositionDefs.map((c, i) => ({
    label: c.label,
    approved: c.approved,
    spent: c.spent,
    tone: i === 0 ? 'good' : 'neutral',
  })),
  observation: obsSentence,
  functions: functionsRaw.map((f) => {
    const spent = Math.round((f.budget * f.used) / 100);
    const remaining = f.budget - spent;
    const status: OpFunction['status'] = remaining < 0 ? 'over' : f.used >= 85 ? 'tight' : 'ok';
    return { name: f.name, budget: f.budget, used_pct: f.used, spent, remaining, status };
  }),
};
