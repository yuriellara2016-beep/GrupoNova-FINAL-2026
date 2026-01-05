import AsyncStorage from '@react-native-async-storage/async-storage';

const DAY_STATE_KEY = 'day_state';
const DAY_LEDGER_KEY = 'day_ledger'; // Nuevo: registro de ventas/gastos por fecha
const DAY_SNAPSHOTS_KEY = 'day_snapshots'; // Nuevo: snapshots históricos de días cerrados

export type DayState = {
  isOpen: boolean;
  openedDate: string | null; // ISO string YYYY-MM-DD
  openedAt: string | null; // Full ISO timestamp
  closedAt: string | null; // Full ISO timestamp when day is closed
  openedBy?: string | null; // Nuevo: user ID que abrió el día
  closedBy?: string | null; // Nuevo: user ID que cerró el día
};

// Nuevo: Ledger diario (registro de ventas y gastos por fecha)
export type DayLedger = {
  [date: string]: {
    saleIds: string[];
    expenseIds: string[];
  };
};

// Nuevo: Snapshot de cierre de día (auditoría)
export type DaySnapshot = {
  date: string;
  openedAt: string;
  closedAt: string;
  openedBy: string | null;
  closedBy: string | null;
  totalSales: number;
  totalExpenses: number;
  saleCount: number;
  expenseCount: number;
  cashBalance?: number; // Opcional: saldo de caja si está disponible
};

export async function getDayState(): Promise<DayState> {
  try {
    const raw = await AsyncStorage.getItem(DAY_STATE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to read day state:', e);
  }
  return { isOpen: false, openedDate: null, openedAt: null, closedAt: null, openedBy: null, closedBy: null };
}

export async function setDayState(state: DayState): Promise<void> {
  try {
    await AsyncStorage.setItem(DAY_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save day state:', e);
  }
}

export async function openDay(date: string, userId?: string): Promise<void> {
  const now = new Date().toISOString();
  await setDayState({
    isOpen: true,
    openedDate: date,
    openedAt: now,
    closedAt: null,
    openedBy: userId || null,
    closedBy: null,
  });
  
  // Nuevo: Inicializar ledger para la fecha si no existe
  await initializeLedgerForDate(date);
}

export async function closeDay(userId?: string): Promise<DaySnapshot | null> {
  const current = await getDayState();
  if (!current.isOpen || !current.openedDate) {
    console.warn('Cannot close day: day is not open');
    return null;
  }

  const now = new Date().toISOString();
  
  // Nuevo: Capturar snapshot antes de cerrar
  const snapshot = await createDaySnapshot(current.openedDate, current.openedBy, userId, current.openedAt, now);
  
  // Guardar snapshot en histórico
  if (snapshot) {
    await saveDaySnapshot(snapshot);
  }

  await setDayState({
    ...current,
    isOpen: false,
    closedAt: now,
    closedBy: userId || null,
  });

  return snapshot;
}

export async function isDayOpen(): Promise<boolean> {
  const state = await getDayState();
  return state.isOpen;
}

// Nuevo: Obtener fecha de negocio actual (fecha del día abierto)
export async function getCurrentBusinessDate(): Promise<string | null> {
  const state = await getDayState();
  return state.openedDate;
}

// Nuevo: Inicializar ledger para una fecha específica
async function initializeLedgerForDate(date: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DAY_LEDGER_KEY);
    const ledger: DayLedger = raw ? JSON.parse(raw) : {};
    
    if (!ledger[date]) {
      ledger[date] = { saleIds: [], expenseIds: [] };
      await AsyncStorage.setItem(DAY_LEDGER_KEY, JSON.stringify(ledger));
    }
  } catch (e) {
    console.warn('Failed to initialize ledger for date:', e);
  }
}

// Nuevo: Registrar venta en el ledger del día actual
export async function appendSaleToDay(saleId: string): Promise<void> {
  try {
    const date = await getCurrentBusinessDate();
    if (!date) {
      console.warn('No business date active, cannot append sale');
      return;
    }

    const raw = await AsyncStorage.getItem(DAY_LEDGER_KEY);
    const ledger: DayLedger = raw ? JSON.parse(raw) : {};

    if (!ledger[date]) {
      ledger[date] = { saleIds: [], expenseIds: [] };
    }

    if (!ledger[date].saleIds.includes(saleId)) {
      ledger[date].saleIds.push(saleId);
      await AsyncStorage.setItem(DAY_LEDGER_KEY, JSON.stringify(ledger));
    }
  } catch (e) {
    console.warn('Failed to append sale to day ledger:', e);
  }
}

// Nuevo: Registrar gasto en el ledger del día actual
export async function appendExpenseToDay(expenseId: string): Promise<void> {
  try {
    const date = await getCurrentBusinessDate();
    if (!date) {
      console.warn('No business date active, cannot append expense');
      return;
    }

    const raw = await AsyncStorage.getItem(DAY_LEDGER_KEY);
    const ledger: DayLedger = raw ? JSON.parse(raw) : {};

    if (!ledger[date]) {
      ledger[date] = { saleIds: [], expenseIds: [] };
    }

    if (!ledger[date].expenseIds.includes(expenseId)) {
      ledger[date].expenseIds.push(expenseId);
      await AsyncStorage.setItem(DAY_LEDGER_KEY, JSON.stringify(ledger));
    }
  } catch (e) {
    console.warn('Failed to append expense to day ledger:', e);
  }
}

// Nuevo: Obtener IDs de ventas y gastos para una fecha
export async function getDayLedger(date: string): Promise<{ saleIds: string[]; expenseIds: string[] }> {
  try {
    const raw = await AsyncStorage.getItem(DAY_LEDGER_KEY);
    if (raw) {
      const ledger: DayLedger = JSON.parse(raw);
      return ledger[date] || { saleIds: [], expenseIds: [] };
    }
  } catch (e) {
    console.warn('Failed to read day ledger:', e);
  }
  return { saleIds: [], expenseIds: [] };
}

// Nuevo: Crear snapshot de cierre de día (calcula totales)
async function createDaySnapshot(
  date: string,
  openedBy: string | null | undefined,
  closedBy: string | null | undefined,
  openedAt: string,
  closedAt: string
): Promise<DaySnapshot | null> {
  try {
    const ledger = await getDayLedger(date);

    // Use the async DB APIs to fetch current data
    const { initDb, getSales, getExpenses } = require('./db');
    try { await initDb(); } catch (_) {}

    const allSales = await getSales();
    const allExpenses = await getExpenses();

    // If ledger has IDs, filter by those. Otherwise, fallback to filtering by createdAt (YYYY-MM-DD prefix)
    const hasLedgerIds = (ledger.saleIds && ledger.saleIds.length > 0) || (ledger.expenseIds && ledger.expenseIds.length > 0);

    const daySales = hasLedgerIds
      ? allSales.filter((s: any) => ledger.saleIds.includes(s.id))
      : allSales.filter((s: any) => ((s.createdAt || '').slice(0, 10) === date) && ((s.status || 'active') !== 'cancelled'));

    const dayExpenses = hasLedgerIds
      ? allExpenses.filter((e: any) => ledger.expenseIds.includes(e.id))
      : allExpenses.filter((e: any) => (e.createdAt || '').slice(0, 10) === date);

    // Calcular totales
    const totalSales = daySales.reduce((sum: number, s: any) => sum + (s.total || 0), 0);
    const totalExpenses = dayExpenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

    return {
      date,
      openedAt,
      closedAt,
      openedBy: openedBy || null,
      closedBy: closedBy || null,
      totalSales,
      totalExpenses,
      saleCount: daySales.length,
      expenseCount: dayExpenses.length,
    };
  } catch (e) {
    console.warn('Failed to create day snapshot:', e);
    return null;
  }
}

// Nuevo: Guardar snapshot de día cerrado
async function saveDaySnapshot(snapshot: DaySnapshot): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(DAY_SNAPSHOTS_KEY);
    const snapshots: Record<string, DaySnapshot> = raw ? JSON.parse(raw) : {};
    snapshots[snapshot.date] = snapshot;
    await AsyncStorage.setItem(DAY_SNAPSHOTS_KEY, JSON.stringify(snapshots));
  } catch (e) {
    console.warn('Failed to save day snapshot:', e);
  }
}

// Nuevo: Obtener snapshot de un día cerrado
export async function getDaySnapshot(date: string): Promise<DaySnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(DAY_SNAPSHOTS_KEY);
    if (raw) {
      const snapshots: Record<string, DaySnapshot> = JSON.parse(raw);
      return snapshots[date] || null;
    }
  } catch (e) {
    console.warn('Failed to read day snapshot:', e);
  }
  return null;
}

// Nuevo: Obtener todos los snapshots históricos
export async function getAllDaySnapshots(): Promise<DaySnapshot[]> {
  try {
    const raw = await AsyncStorage.getItem(DAY_SNAPSHOTS_KEY);
    if (raw) {
      const snapshots: Record<string, DaySnapshot> = JSON.parse(raw);
      return Object.values(snapshots).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  } catch (e) {
    console.warn('Failed to read all day snapshots:', e);
  }
  return [];
}