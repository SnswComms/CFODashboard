'use client';

import { createContext, useContext } from 'react';

export interface DateRangeState {
  key: string;
  label: string;
  from: string;
  to: string;
  query: string;
  refreshing: boolean;
}

export const DEFAULT_DATE_RANGE: DateRangeState = {
  key: 'fytd',
  label: 'FY2026 to date',
  from: '2026-01-01',
  to: '2026-07-04',
  query: 'range=fytd&from_date=2026-01-01&to_date=2026-07-04',
  refreshing: false,
};

export const DateRangeContext = createContext<DateRangeState>(DEFAULT_DATE_RANGE);

export function useDateRange() {
  return useContext(DateRangeContext);
}

const APP_TIME_ZONE = 'Asia/Manila';

function appDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function isoFromParts(year: number, month: number, day: number) {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addMonthsIso(year: number, month: number, day: number, months: number) {
  const shifted = new Date(Date.UTC(year, month - 1 + months, day));
  return isoFromParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

export function resolveRange(key: string, custom?: { from: string; to: string }): Omit<DateRangeState, 'refreshing'> {
  const todayParts = appDateParts();
  const today = isoFromParts(todayParts.year, todayParts.month, todayParts.day);
  let from = `${todayParts.year}-01-01`;
  let to = today;
  let label = `FY${todayParts.year} to date`;

  if (key === 'month') {
    from = isoFromParts(todayParts.year, todayParts.month, 1);
    label = 'This month';
  } else if (key === 'quarter') {
    from = isoFromParts(todayParts.year, Math.floor((todayParts.month - 1) / 3) * 3 + 1, 1);
    label = 'This quarter';
  } else if (key === '12m') {
    from = addMonthsIso(todayParts.year, todayParts.month, todayParts.day, -12);
    label = 'Last 12 months';
  } else if (key === 'year') {
    from = `${todayParts.year}-01-01`;
    to = `${todayParts.year}-12-31`;
    label = `Full year FY${todayParts.year}`;
  } else if (key === 'custom' && custom?.from && custom?.to) {
    from = custom.from;
    to = custom.to;
    const f = new Date(`${from}T00:00:00`);
    const t = new Date(`${to}T00:00:00`);
    const opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
    label = f.toLocaleDateString('en-AU', opt) + ' - ' + t.toLocaleDateString('en-AU', opt);
  }

  const query = new URLSearchParams({ range: key, from_date: from, to_date: to }).toString();
  return { key, label, from, to, query };
}
