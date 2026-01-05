// ... existing code ...
// new file: lib/businessDay.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { todayIso as utilTodayIso } from './date';

// This module implements a lightweight business day ledger stored in AsyncStorage.
// It is additive and does not change any existing database schemas. It stores
// per-date metadata and lists of sale/expense ids so the app can present
// day-scoped views and snapshots without modifying historic records.

const STORAGE_KEY = 'pos_business_day_v1';

export type BusinessDayStatus = 'open' | 'closed';

export type BusinessDayRecord = {
  businessDate: string; // YYYY-MM-DD
  status: BusinessDayStatus;
  openedBy?: string | null;
  openedAt?: string | null; // ISO
  closedBy?: string | null;
  closedAt?: string | null; // ISO
  sales: string[]; // sale ids
  expenses: string[]; // expense ids
  snapshot?: {
    totalSales: number;
    totalExpenses: number;
    createdAt: string;
  } | null;
};

export type BusinessDayStore = {
  current?: BusinessDayRecord | null;
  history: Record<string, BusinessDayRecord>;
};

async function readStore(): Promise<BusinessDayStore> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: null, history: {} };
    return JSON.parse(raw) as BusinessDayStore;
  } catch (e) {
    return { current: null, history: {} };
  }
}

async function writeStore(store: BusinessDayStore) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function todayIso(date?: string | Date) {
  if (!date) return utilTodayIso();
  if (typeof date === 'string') return utilTodayIso(date);
  return utilTodayIso(date);
}

export async function startBusinessDay(businessDate?: string, userId?: string) {
  const dateKey = todayIso(businessDate);
  const store = await readStore();
  // If there's a different current open day, keep it in history and set new one as current
  const record: BusinessDayRecord = {
    businessDate: dateKey,
    status: 'open',
    openedBy: userId || null,
    openedAt: new Date().toISOString(),
    closedBy: null,
    closedAt: null,
    sales: [],
    expenses: [],
    snapshot: null,
  };
  store.current = record;
  store.history[dateKey] = record;
  await writeStore(store);
  return record;
}

export async function closeBusinessDay(userId?: string, snapshot?: { totalSales: number; totalExpenses: number }) {
  const store = await readStore();
  if (!store.current) return null;
  const rec = { ...store.current };
  rec.status = 'closed';
  rec.closedBy = userId || null;
  rec.closedAt = new Date().toISOString();
  rec.snapshot = {
    totalSales: snapshot?.totalSales ?? 0,
    totalExpenses: snapshot?.totalExpenses ?? 0,
    createdAt: new Date().toISOString(),
  };
  store.current = rec;
  store.history[rec.businessDate] = rec;
  await writeStore(store);
  return rec;
}

export async function getCurrentBusinessDay(): Promise<BusinessDayRecord | null> {
  const store = await readStore();
  return store.current || null;
}

export async function isDayOpen(): Promise<boolean> {
  const cur = await getCurrentBusinessDay();
  return !!cur && cur.status === 'open';
}

export async function appendSaleToDay(saleId: string) {
  if (!saleId) return;
  const store = await readStore();
  if (!store.current) return;
  const cur = { ...store.current };
  if (!cur.sales.includes(saleId)) cur.sales = [...cur.sales, saleId];
  store.current = cur;
  store.history[cur.businessDate] = cur;
  await writeStore(store);
}

export async function appendExpenseToDay(expenseId: string) {
  if (!expenseId) return;
  const store = await readStore();
  if (!store.current) return;
  const cur = { ...store.current };
  if (!cur.expenses.includes(expenseId)) cur.expenses = [...cur.expenses, expenseId];
  store.current = cur;
  store.history[cur.businessDate] = cur;
  await writeStore(store);
}

export async function getDailySnapshot(businessDate?: string) {
  const store = await readStore();
  const key = businessDate ? todayIso(businessDate) : (store.current?.businessDate ?? null);
  if (!key) return null;
  const rec = store.history[key] || null;
  return rec;
}

export async function listBusinessHistory() {
  const store = await readStore();
  return Object.values(store.history).sort((a, b) => (b.businessDate || '').localeCompare(a.businessDate || ''));
}

export async function clearBusinessLedger() {
  // Utility for dev/testing only
  await AsyncStorage.removeItem(STORAGE_KEY);
}