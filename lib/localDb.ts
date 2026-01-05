import AsyncStorage from '@react-native-async-storage/async-storage';

// Types
export interface User {
  _id: string;
  email: string;
  password: string;
  name: string;
  role: 'admin' | 'seller';
  storeId?: string;
}

export interface Product {
  _id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
}

export interface Sale {
  _id: string;
  sellerId: string;
  sellerName: string;
  storeId?: string;
  products: Array<{ productId: string; productName: string; quantity: number; price: number }>;
  total: number;
  paymentMethod: 'cash' | 'card' | 'transfer';
  businessDate: string;
  isClosed: boolean;
  createdAt: number;
}

export interface AppSettings {
  businessDate: string | null;
  isDayStarted: boolean;
  isClosed?: boolean;
  closedDate?: string | null;
  // NEW (non-breaking): cierre por tienda y por fecha de trabajo
  closedByStoreByDate?: Record<string, Record<string, boolean>>;
}

export interface Backup {
  _id: string;
  data: string;
  createdBy: string;
  createdAt: number;
}

// Storage keys
const KEYS = {
  USERS: 'db_users',
  PRODUCTS: 'db_products',
  SALES: 'db_sales',
  SETTINGS: 'db_settings',
  BACKUPS: 'db_backups',
  INITIALIZED: 'db_initialized',
};

// Helper functions
async function getFromStorage<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const value = await AsyncStorage.getItem(key);
    return value ? JSON.parse(value) : defaultValue;
  } catch {
    return defaultValue;
  }
}

async function saveToStorage<T>(key: string, value: T): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// --- Day close helpers (store-scoped) ---
const APP_SETTINGS_KEY = 'app:settings';
const APP_USER_KEY = 'app:currentUser';
const STORE_PREF_KEY = 'pos_current_store_v1';

async function getAppBusinessDateFallback(): Promise<string | null> {
  // Prefer the main app settings (hooks/useAuth). Fallback to localDb settings for legacy flows.
  try {
    const raw = await AsyncStorage.getItem(APP_SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const bd = typeof parsed?.businessDate === 'string' ? parsed.businessDate : null;
      const normalized = bd && bd.length >= 10 ? bd.slice(0, 10) : null;
      if (normalized) return normalized;
    }
  } catch {
    // ignore
  }

  // Legacy fallback: localDb settings key
  try {
    const raw = await AsyncStorage.getItem(KEYS.SETTINGS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const bd = typeof parsed?.businessDate === 'string' ? parsed.businessDate : null;
    return bd && bd.length >= 10 ? bd.slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function getEffectiveStoreIdFallback(): Promise<string | null> {
  // For admins: use store preference. For sellers: use user.storeId.
  try {
    const rawPref = await AsyncStorage.getItem(STORE_PREF_KEY);
    if (rawPref && rawPref !== 'null') return rawPref;
  } catch {}

  try {
    const rawUser = await AsyncStorage.getItem(APP_USER_KEY);
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    const storeId = typeof parsed?.storeId === 'string' ? parsed.storeId : null;
    return storeId || null;
  } catch {
    return null;
  }
}

function getTodayIsoDateKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type DayScope = {
  storeId?: string | null;
  businessDate?: string | null;
};

async function resolveDayScope(scope?: DayScope): Promise<{ storeKey: string; dateKey: string }> {
  const storeId = scope?.storeId ?? (await getEffectiveStoreIdFallback());
  const storeKey = storeId || 'global';

  const fallbackDate = scope?.businessDate ?? (await getAppBusinessDateFallback()) ?? getTodayIsoDateKey();
  const dateKey = (fallbackDate || getTodayIsoDateKey()).slice(0, 10);

  return { storeKey, dateKey };
}

// Initialize database with seed data
export async function initializeDatabase(): Promise<void> {
  const initialized = await AsyncStorage.getItem(KEYS.INITIALIZED);
  if (initialized) return;

  // Seed users
  const users: User[] = [
    {
      _id: 'user_admin',
      email: 'admin@pos.com',
      password: '123',
      name: 'Administrador',
      role: 'admin',
    },
    {
      _id: 'user_seller1',
      email: 'vendedor1@pos.com',
      password: 'vend123',
      name: 'Vendedor 1',
      role: 'seller',
      storeId: 'store_1',
    },
    {
      _id: 'user_seller2',
      email: 'vendedor2@pos.com',
      password: 'vend123',
      name: 'Vendedor 2',
      role: 'seller',
      storeId: 'store_2',
    },
  ];

  // Seed products
  const products: Product[] = [
    { _id: 'prod_1', name: 'Producto A', price: 10.0, stock: 100, category: 'Categoría 1' },
    { _id: 'prod_2', name: 'Producto B', price: 20.0, stock: 50, category: 'Categoría 1' },
    { _id: 'prod_3', name: 'Producto C', price: 15.5, stock: 75, category: 'Categoría 2' },
    { _id: 'prod_4', name: 'Producto D', price: 30.0, stock: 30, category: 'Categoría 2' },
    { _id: 'prod_5', name: 'Producto E', price: 25.0, stock: 60, category: 'Categoría 3' },
  ];

  // Initial settings
  const settings: AppSettings = {
    businessDate: null,
    isDayStarted: false,
  };

  await saveToStorage(KEYS.USERS, users);
  await saveToStorage(KEYS.PRODUCTS, products);
  await saveToStorage(KEYS.SALES, []);
  await saveToStorage(KEYS.SETTINGS, settings);
  await saveToStorage(KEYS.BACKUPS, []);
  await AsyncStorage.setItem(KEYS.INITIALIZED, 'true');
}

// Users API
export async function loginUser(email: string, password: string): Promise<User | null> {
  const users = await getFromStorage<User[]>(KEYS.USERS, []);
  const user = users.find((u) => u.email === email && u.password === password);
  return user || null;
}

export async function createUser(userData: Omit<User, '_id'>): Promise<User> {
  const users = await getFromStorage<User[]>(KEYS.USERS, []);
  const newUser: User = { ...userData, _id: generateId() };
  users.push(newUser);
  await saveToStorage(KEYS.USERS, users);
  return newUser;
}

// Products API
export async function getAllProducts(): Promise<Product[]> {
  return await getFromStorage<Product[]>(KEYS.PRODUCTS, []);
}

export async function updateProductStock(productId: string, quantity: number): Promise<void> {
  const products = await getFromStorage<Product[]>(KEYS.PRODUCTS, []);
  const product = products.find((p) => p._id === productId);
  if (product) {
    product.stock += quantity;
    await saveToStorage(KEYS.PRODUCTS, products);
  }
}

// Sales API
export async function createSale(saleData: Omit<Sale, '_id' | 'createdAt'>): Promise<Sale> {
  const sales = await getFromStorage<Sale[]>(KEYS.SALES, []);
  const newSale: Sale = {
    ...saleData,
    _id: generateId(),
    createdAt: Date.now(),
  };
  sales.push(newSale);
  await saveToStorage(KEYS.SALES, sales);

  // Update product stock
  for (const item of saleData.products) {
    await updateProductStock(item.productId, -item.quantity);
  }

  return newSale;
}

export async function getSalesBySeller(sellerId: string): Promise<Sale[]> {
  const sales = await getFromStorage<Sale[]>(KEYS.SALES, []);
  return sales.filter((s) => s.sellerId === sellerId);
}

export async function getAllSales(): Promise<Sale[]> {
  return await getFromStorage<Sale[]>(KEYS.SALES, []);
}

// Settings API
export async function isDayStarted(): Promise<boolean> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });
  return settings.isDayStarted;
}

export async function getBusinessDate(): Promise<string | null> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });
  return settings.businessDate;
}

export async function startDay(date: string): Promise<void> {
  // IMPORTANT: Do not overwrite the whole settings object.
  // We must preserve closedByStoreByDate so previously closed dates remain locked.
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });

  const next: AppSettings = {
    ...settings,
    businessDate: date,
    isDayStarted: true,
  };

  await saveToStorage(KEYS.SETTINGS, next);

  // Emit status change so UI summaries refresh immediately
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('dayStatusChanged', { started: true, date, closed: false });
  } catch (_) {}
}

export async function closeDay(): Promise<void> {
  const sales = await getFromStorage<Sale[]>(KEYS.SALES, []);
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });

  // Mark all sales of current business date as closed
  if (settings.businessDate) {
    const updatedSales = sales.map((sale) =>
      sale.businessDate === settings.businessDate ? { ...sale, isClosed: true } : sale
    );
    await saveToStorage(KEYS.SALES, updatedSales);
  }

  // IMPORTANT: Preserve the per-store/per-date closure map.
  // Also ensure the current businessDate is marked closed in the map.
  const { storeKey, dateKey } = await resolveDayScope({ businessDate: settings.businessDate });

  const nextClosedByStoreByDate: Record<string, Record<string, boolean>> = {
    ...(settings.closedByStoreByDate || {}),
    [storeKey]: {
      ...((settings.closedByStoreByDate || {})[storeKey] || {}),
      [dateKey]: true,
    },
  };

  const updatedSettings: AppSettings = {
    ...settings,
    businessDate: null,
    isDayStarted: false,
    isClosed: true, // legacy
    closedDate: settings.businessDate, // legacy
    closedByStoreByDate: nextClosedByStoreByDate,
  };

  await saveToStorage(KEYS.SETTINGS, updatedSettings);

  // Emit status change so UI summaries refresh immediately
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('dayStatusChanged', {
      started: false,
      date: null,
      closed: true,
      lastClosed: settings.businessDate,
      storeId: storeKey,
      businessDate: dateKey,
    });
    DeviceEventEmitter.emit('dayClosed', { storeId: storeKey, businessDate: dateKey });
  } catch (_) {}
}

export async function isDayClosed(scope?: DayScope): Promise<boolean> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });

  const { storeKey, dateKey } = await resolveDayScope(scope);

  // Prefer new store+date scoped structure when available
  if (settings.closedByStoreByDate && settings.closedByStoreByDate[storeKey]) {
    return settings.closedByStoreByDate[storeKey]?.[dateKey] === true;
  }

  // Legacy fallback
  return settings.isClosed === true;
}

export async function getLastClosedDate(): Promise<string | null> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });
  return settings.closedDate ?? null;
}

export async function setDayNotClosed(): Promise<void> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });
  settings.isClosed = false;
  await saveToStorage(KEYS.SETTINGS, settings);
}

// Mark the day as closed (store-scoped)
export async function markDayClosed(scope?: DayScope): Promise<void> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });

  const { storeKey, dateKey } = await resolveDayScope(scope);

  const next: AppSettings = {
    ...settings,
    isClosed: true, // legacy
    closedDate: dateKey, // legacy
    closedByStoreByDate: {
      ...(settings.closedByStoreByDate || {}),
      [storeKey]: {
        ...((settings.closedByStoreByDate || {})[storeKey] || {}),
        [dateKey]: true,
      },
    },
  };

  await saveToStorage(KEYS.SETTINGS, next);

  // Emit event so other screens can refresh
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('dayStatusChanged', { closed: true, storeId: storeKey, businessDate: dateKey });
  } catch (_) {}
}

// Mark the day as open (store-scoped)
export async function markDayOpen(scope?: DayScope): Promise<void> {
  const settings = await getFromStorage<AppSettings>(KEYS.SETTINGS, {
    businessDate: null,
    isDayStarted: false,
  });

  const { storeKey, dateKey } = await resolveDayScope(scope);

  const closedByStoreByDate = { ...(settings.closedByStoreByDate || {}) };
  if (closedByStoreByDate[storeKey]) {
    const perDate = { ...(closedByStoreByDate[storeKey] || {}) };
    delete perDate[dateKey];
    closedByStoreByDate[storeKey] = perDate;
  }

  const next: AppSettings = {
    ...settings,
    isClosed: false, // legacy
    closedDate: null, // legacy
    closedByStoreByDate,
  };

  await saveToStorage(KEYS.SETTINGS, next);

  // Emit event so other screens can refresh
  try {
    const { DeviceEventEmitter } = require('react-native');
    DeviceEventEmitter.emit('dayStatusChanged', { closed: false, storeId: storeKey, businessDate: dateKey });
  } catch (_) {}
}

// Backups API
export async function createBackup(data: string, userId: string): Promise<Backup> {
  const backups = await getFromStorage<Backup[]>(KEYS.BACKUPS, []);
  const newBackup: Backup = {
    _id: generateId(),
    data,
    createdBy: userId,
    createdAt: Date.now(),
  };
  backups.push(newBackup);
  await saveToStorage(KEYS.BACKUPS, backups);
  return newBackup;
}

export async function getAllBackups(): Promise<Backup[]> {
  return await getFromStorage<Backup[]>(KEYS.BACKUPS, []);
}

export async function importBackup(backupData: string): Promise<void> {
  try {
    const parsed = JSON.parse(backupData);
    if (parsed.sales) await saveToStorage(KEYS.SALES, parsed.sales);
    if (parsed.products) await saveToStorage(KEYS.PRODUCTS, parsed.products);
    if (parsed.users) await saveToStorage(KEYS.USERS, parsed.users);
  } catch (error) {
    throw new Error('Backup inválido');
  }
}

export async function clearAllData(): Promise<void> {
  await AsyncStorage.multiRemove([
    KEYS.USERS,
    KEYS.PRODUCTS,
    KEYS.SALES,
    KEYS.SETTINGS,
    KEYS.BACKUPS,
    KEYS.INITIALIZED,
  ]);
  await initializeDatabase();
}