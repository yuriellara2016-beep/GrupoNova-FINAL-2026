import AsyncStorage from '@react-native-async-storage/async-storage';

export type CashSession = {
  dateKey: string; // YYYY-MM-DD
  startingBalance: number;
  closedAt: string | null;
  expectedCash?: number | null;
  countedCash?: number | null;
};

const KEY = 'cash_sessions_v1';

function todayKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function loadAll(): Promise<CashSession[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as CashSession[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function saveAll(items: CashSession[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(items));
}

export async function getTodaySession(): Promise<CashSession | null> {
  const items = await loadAll();
  const key = todayKey();
  return items.find(i => i.dateKey === key) ?? null;
}

export async function openSession(startingBalance: number) {
  const items = await loadAll();
  const key = todayKey();
  const existing = items.find(i => i.dateKey === key);
  if (existing && !existing.closedAt) {
    // Already open; update starting if needed
    existing.startingBalance = startingBalance;
    await saveAll(items);
    return;
  }
  if (existing && existing.closedAt) {
    // Reopen by only clearing closure marker; preserve expected/count data
    existing.closedAt = null;
    // Do NOT clear expectedCash or countedCash; preserve previous closure data
    if (typeof startingBalance === 'number') {
      existing.startingBalance = startingBalance;
    }
    await saveAll(items);
    return;
  }
  const s: CashSession = {
    dateKey: key,
    startingBalance,
    closedAt: null,
    expectedCash: null,
    countedCash: null,
  };
  items.push(s);
  await saveAll(items);
}

export async function closeSession(paramsOrId: { expectedCash: number; countedCash: number } | string) {
  const items = await loadAll();
  const key = todayKey();
  const s = items.find(i => i.dateKey === key);
  if (!s) throw new Error('No hay turno abierto');
  
  // If called with simple sessionId string (for simple day closure)
  if (typeof paramsOrId === 'string') {
    s.closedAt = new Date().toISOString();
    // Keep existing expectedCash and countedCash from last arqueo
    await saveAll(items);
    return;
  }
  
  // If called with full parameters (for traditional closure with cash count)
  s.closedAt = new Date().toISOString();
  s.expectedCash = paramsOrId.expectedCash;
  s.countedCash = paramsOrId.countedCash;
  await saveAll(items);
}

export async function reopenSession() {
  const items = await loadAll();
  const key = todayKey();
  const s = items.find(i => i.dateKey === key);
  if (!s) throw new Error('No hay sesión para hoy');
  // Preserve all data (starting balance, expectedCash, countedCash); just mark as open
  s.closedAt = null;
  // DO NOT clear expectedCash or countedCash here to preserve previous closure details
  await saveAll(items);
}