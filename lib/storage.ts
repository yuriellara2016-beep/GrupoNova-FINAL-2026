import AsyncStorage from '@react-native-async-storage/async-storage';

export type ArqueoRecord = {
  date: string; // YYYY-MM-DD
  expectedCash: number;
  countedCash: number;
  difference: number; // counted - expected
  status: 'SOBRANTE' | 'FALTANTE' | 'CUADRA';
  savedAt: string; // ISO timestamp
};

export type InventoryItemDiff = {
  id: string;
  name: string;
  expected: number;
  counted: number;
  difference: number; // counted - expected
};

export type InventoryRecord = {
  date: string; // YYYY-MM-DD
  items: InventoryItemDiff[];
  savedAt: string; // ISO timestamp
};

const keyForArqueo = (date: string) => `arqueo:${date}`;
const keyForArqueoHistory = 'arqueoHistory:list';
const keyForInventory = (date: string) => `inventory:${date}`;
const keyForInventoryHistory = 'inventoryHistory:list';
const keyForClosedDay = (date: string) => `closedDay:${date}`;
const keyForProducts = 'products';

export function getTodayKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export async function ensureSampleProducts(): Promise<void> {
  const existing = await AsyncStorage.getItem(keyForProducts);
  if (existing) return;
  const sample = [
    { id: 'p1', name: 'Producto A', stock: 20 },
    { id: 'p2', name: 'Producto B', stock: 35 },
    { id: 'p3', name: 'Producto C', stock: 12 },
  ];
  await AsyncStorage.setItem(keyForProducts, JSON.stringify(sample));
}

export async function getProducts(): Promise<Array<{ id: string; name: string; stock: number }>> {
  const raw = await AsyncStorage.getItem(keyForProducts);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveArqueo(rec: Omit<ArqueoRecord, 'savedAt'>): Promise<ArqueoRecord> {
  const payload: ArqueoRecord = { ...rec, savedAt: new Date().toISOString() };
  await AsyncStorage.setItem(keyForArqueo(rec.date), JSON.stringify(payload));
  try {
    // Also append to history so multiple arqueos per día quedan registrados para revisión
    const raw = await AsyncStorage.getItem(keyForArqueoHistory);
    const list: ArqueoRecord[] = raw ? JSON.parse(raw) : [];
    list.push(payload);
    await AsyncStorage.setItem(keyForArqueoHistory, JSON.stringify(list));
  } catch (_) {}
  return payload;
}

export async function getArqueo(date: string): Promise<ArqueoRecord | null> {
  const raw = await AsyncStorage.getItem(keyForArqueo(date));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getArqueoHistory(): Promise<ArqueoRecord[]> {
  const raw = await AsyncStorage.getItem(keyForArqueoHistory);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as ArqueoRecord[];
    // Return sorted by savedAt desc
    return list.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch {
    return [];
  }
}

export async function saveInventory(rec: Omit<InventoryRecord, 'savedAt'>): Promise<InventoryRecord> {
  const payload: InventoryRecord = { ...rec, savedAt: new Date().toISOString() };
  await AsyncStorage.setItem(keyForInventory(rec.date), JSON.stringify(payload));
  // Also append to history for audit trail
  try {
    const raw = await AsyncStorage.getItem(keyForInventoryHistory);
    const list: InventoryRecord[] = raw ? JSON.parse(raw) : [];
    list.push(payload);
    await AsyncStorage.setItem(keyForInventoryHistory, JSON.stringify(list));
  } catch (_) {}
  return payload;
}

export async function getInventory(date: string): Promise<InventoryRecord | null> {
  const raw = await AsyncStorage.getItem(keyForInventory(date));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function getInventoryHistory(): Promise<InventoryRecord[]> {
  const raw = await AsyncStorage.getItem(keyForInventoryHistory);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as InventoryRecord[];
    // Return sorted by savedAt desc
    return list.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  } catch {
    return [];
  }
}

export async function markDayClosed(date: string, meta?: { arqueo?: ArqueoRecord; inventory?: InventoryRecord }): Promise<void> {
  await AsyncStorage.setItem(keyForClosedDay(date), JSON.stringify({ ...meta, closedAt: new Date().toISOString() }));
}

export async function isDayClosed(date: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(keyForClosedDay(date));
  return !!raw;
}

export async function clearAllAppData(): Promise<void> {
  await AsyncStorage.clear();
}

// --- NEW: export/import storage snapshot for backup ---
export async function exportStorageSnapshot(): Promise<{ arqueoHistory: ArqueoRecord[]; inventoryHistory: InventoryRecord[] }> {
  const arqueoHistory = await getArqueoHistory();
  const inventoryHistory = await getInventoryHistory();
  return { arqueoHistory, inventoryHistory };
}

export async function importStorageSnapshot(payload: { arqueoHistory?: ArqueoRecord[]; inventoryHistory?: InventoryRecord[] }): Promise<void> {
  try {
    if (payload?.arqueoHistory) {
      await AsyncStorage.setItem(keyForArqueoHistory, JSON.stringify(payload.arqueoHistory));
    }
    if (payload?.inventoryHistory) {
      await AsyncStorage.setItem(keyForInventoryHistory, JSON.stringify(payload.inventoryHistory));
    }
  } catch (_) {}
}