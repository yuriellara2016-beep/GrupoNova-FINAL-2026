import { Product, Sale, SaleItem, Expense, CashSession, InventoryEntry, TransferRequest } from '../types';
import { generateId } from './id';
import { Platform, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Add helpers to use the active business date without touching UI
async function getActiveBusinessDate(): Promise<string | null> {
  try {
    // Primary source: localDb settings
    const raw = await AsyncStorage.getItem('db_settings');
    if (raw) {
      const st = JSON.parse(raw);
      if (st && st.isDayStarted && typeof st.businessDate === 'string' && st.businessDate.length >= 10) {
        return st.businessDate;
      }
    }
  } catch (_) {}
  try {
    // Fallback source: business day store
    const raw2 = await AsyncStorage.getItem('pos_business_day_v1');
    if (raw2) {
      const store = JSON.parse(raw2);
      const cur = store?.current;
      if (cur && cur.status === 'open' && typeof cur.businessDate === 'string' && cur.businessDate.length >= 10) {
        return cur.businessDate;
      }
    }
  } catch (_) {}
  try {
    // Fallback source: simple working date set from login flow
    const wd = await AsyncStorage.getItem('working_date');
    if (wd && wd.length >= 10) {
      return wd.slice(0, 10);
    }
  } catch (_) {}
  return null;
}

function buildBusinessTimestamp(bizDate: string | null): string {
  const nowIso = new Date().toISOString();
  if (!bizDate) return nowIso;
  const timePart = nowIso.slice(11, 19); // HH:MM:SS from current time
  return `${bizDate}T${timePart}Z`;
}

// Database mode flags
let _db: any = null;
let _useSqlite = true; // default optimistic
const ASYNC_KEY = 'pos_db_v1';

// In-memory fallback structure
type FallbackDB = {
  products: Product[];
  sales: any[]; // store sales as raw objects
  saleItems: any[];
  expenses: any[];
  sessions: any[];
  inventoryEntries: any[];
  transferRequests?: TransferRequest[];
};
let fallbackData: FallbackDB | null = null;

function isWeb() {
  return Platform.OS === 'web';
}

// Add a local SQLite variable loaded dynamically on native only
let SQLite: any = null;

function tryOpenSqlite() {
  if (isWeb()) throw new Error('expo-sqlite is not supported on web.');
  // Lazy-load expo-sqlite only on native to avoid Snack/web fetching errors
  if (!SQLite) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      SQLite = require('expo-sqlite');
    } catch (e) {
      throw new Error('expo-sqlite not available');
    }
  }
  if (!SQLite || typeof SQLite.openDatabase !== 'function') throw new Error('expo-sqlite not available');
  _db = SQLite.openDatabase('pos.db');
  _useSqlite = true;
  return _db;
}

async function loadFallback() {
  try {
    const raw = await AsyncStorage.getItem(ASYNC_KEY);
    if (raw) {
      fallbackData = JSON.parse(raw);
      // Ensure arrays exist
      fallbackData.products = fallbackData.products || [];
      fallbackData.sales = fallbackData.sales || [];
      fallbackData.saleItems = fallbackData.saleItems || [];
      fallbackData.expenses = fallbackData.expenses || [];
      fallbackData.sessions = fallbackData.sessions || [];
      fallbackData.inventoryEntries = fallbackData.inventoryEntries || [];
      fallbackData.transferRequests = fallbackData.transferRequests || [];
    } else {
      fallbackData = { products: [], sales: [], saleItems: [], expenses: [], sessions: [], inventoryEntries: [], transferRequests: [] };
      await AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(fallbackData));
    }
  } catch (e) {
    fallbackData = { products: [], sales: [], saleItems: [], expenses: [], sessions: [], inventoryEntries: [], transferRequests: [] };
    try { await AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(fallbackData)); } catch (_) {}
  }
}

async function persistFallback() {
  if (!fallbackData) return;
  await AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(fallbackData));
}

// Ensure fallback DB is ready before accessing it
async function ensureFallbackReady() {
  if (!_useSqlite && !fallbackData) {
    await loadFallback();
  }
}

// Lazy DB initialization: try SQLite, otherwise fallback to AsyncStorage-backed JS DB
export async function initDb() {
  // If already initialized, return
  if (_db || fallbackData) return;
  try {
    tryOpenSqlite();
    // Run migrations for sqlite
    await migrateSqlite();
    _useSqlite = true;
    return;
  } catch (e) {
    console.warn('SQLite unavailable, switching to fallback AsyncStorage DB:', e?.message ?? e);
    _useSqlite = false;
    await loadFallback();
    return;
  }
}

// SQLite helper
function executeSql(sql: string, params: any[] = []): Promise<any> {
  if (!_useSqlite) throw new Error('SQLite not in use');
  return new Promise((resolve, reject) => {
    if (!_db) {
      tryOpenSqlite();
    }
    _db.transaction((tx: any) => {
      tx.executeSql(
        sql,
        params,
        (_: any, result: any) => resolve(result),
        (_: any, err: any) => {
          reject(err);
          return false;
        }
      );
    }, (txErr: any) => {
      reject(txErr);
    });
  });
}

// Migrations for SQLite-only
async function migrateSqlite() {
  // Create tables if they don't exist (base schema)
  await executeSql(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    sku TEXT,
    costPrice REAL,
    sellPrice REAL,
    quantity REAL,
    chargeExtra10Percent INTEGER DEFAULT 0
  );`);

  // sales
  await executeSql(`CREATE TABLE IF NOT EXISTS sales (
    id TEXT PRIMARY KEY,
    createdAt TEXT,
    paymentMethod TEXT,
    subtotal REAL,
    total REAL,
    commission REAL,
    cashAmount REAL,
    transferAmount REAL,
    operationNumber TEXT,
    customerName TEXT,
    customerPhone TEXT,
    storeId TEXT,
    userId TEXT
  );`);

  // sale_items
  await executeSql(`CREATE TABLE IF NOT EXISTS sale_items (
    id TEXT PRIMARY KEY,
    saleId TEXT,
    productId TEXT,
    quantity REAL,
    unitCost REAL,
    unitPrice REAL,
    extra10PercentAmount REAL
  );`);

  // expenses
  await executeSql(`CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    createdAt TEXT,
    type TEXT,
    amount REAL,
    note TEXT,
    storeId TEXT,
    userId TEXT
  );`);

  // cash_sessions
  await executeSql(`CREATE TABLE IF NOT EXISTS cash_sessions (
    id TEXT PRIMARY KEY,
    openedAt TEXT,
    closedAt TEXT,
    startingBalance REAL,
    endingBalance REAL,
    note TEXT,
    storeId TEXT
  );`);

  // inventory_entries
  await executeSql(`CREATE TABLE IF NOT EXISTS inventory_entries (
    id TEXT PRIMARY KEY,
    createdAt TEXT,
    type TEXT,
    productId TEXT,
    quantity REAL,
    unitCost REAL,
    paymentMethod TEXT,
    note TEXT,
    storeId TEXT,
    targetStoreId TEXT
  );`);

  // NEW: store_product_stock table for per-store inventory
  await executeSql(`CREATE TABLE IF NOT EXISTS store_product_stock (
    storeId TEXT NOT NULL,
    productId TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    PRIMARY KEY (storeId, productId)
  );`);

  // NEW: user_initial_load_history table to track one-time product initialization per user
  await executeSql(`CREATE TABLE IF NOT EXISTS user_initial_load_history (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    businessDate TEXT NOT NULL,
    productsLoaded INTEGER DEFAULT 0,
    totalImporte REAL DEFAULT 0,
    classifiedCodes TEXT,
    createdAt TEXT
  );`);

  // Create indexes for performance on Android
  try {
    await executeSql(`CREATE INDEX IF NOT EXISTS idx_store_product_stock_store ON store_product_stock(storeId);`);
    await executeSql(`CREATE INDEX IF NOT EXISTS idx_store_product_stock_product ON store_product_stock(productId);`);
    await executeSql(`CREATE INDEX IF NOT EXISTS idx_sales_store ON sales(storeId);`);
    await executeSql(`CREATE INDEX IF NOT EXISTS idx_expenses_store ON expenses(storeId);`);
    await executeSql(`CREATE INDEX IF NOT EXISTS idx_inventory_entries_store ON inventory_entries(storeId);`);
  } catch (e) {
    // Indexes might already exist, ignore errors
  }

  // Ensure columns exist for backward compatibility
  const pr = await executeSql(`PRAGMA table_info(products);`);
  const cols: string[] = (pr.rows && pr.rows._array) ? pr.rows._array.map((c: any) => c.name) : [];
  if (!cols.includes('costPrice')) {
    await executeSql(`ALTER TABLE products ADD COLUMN costPrice REAL DEFAULT 0;`);
  }
  if (!cols.includes('sellPrice')) {
    await executeSql(`ALTER TABLE products ADD COLUMN sellPrice REAL DEFAULT 0;`);
  }
  if (!cols.includes('quantity')) {
    await executeSql(`ALTER TABLE products ADD COLUMN quantity REAL DEFAULT 0;`);
  }
  if (!cols.includes('chargeExtra10Percent')) {
    await executeSql(`ALTER TABLE products ADD COLUMN chargeExtra10Percent INTEGER DEFAULT 0;`);
  }
  
  // Add cashAmount and transferAmount to sales table if missing
  const salesCols = await executeSql(`PRAGMA table_info(sales);`);
  const salesColNames: string[] = (salesCols.rows && salesCols.rows._array) ? salesCols.rows._array.map((c: any) => c.name) : [];
  if (!salesColNames.includes('cashAmount')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN cashAmount REAL;`);
  }
  if (!salesColNames.includes('transferAmount')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN transferAmount REAL;`);
  }
  if (!salesColNames.includes('operationNumber')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN operationNumber TEXT;`);
  }
  if (!salesColNames.includes('customerName')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN customerName TEXT;`);
  }
  if (!salesColNames.includes('customerPhone')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN customerPhone TEXT;`);
  }
  if (!salesColNames.includes('storeId')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN storeId TEXT;`);
  }
  if (!salesColNames.includes('userId')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN userId TEXT;`);
  }
  if (!salesColNames.includes('status')) {
    await executeSql(`ALTER TABLE sales ADD COLUMN status TEXT DEFAULT 'active';`);
  }

  // Add userId to expenses table if missing
  const expensesCols = await executeSql(`PRAGMA table_info(expenses);`);
  const expensesColNames: string[] = (expensesCols.rows && expensesCols.rows._array) ? expensesCols.rows._array.map((c: any) => c.name) : [];
  if (!expensesColNames.includes('userId')) {
    await executeSql(`ALTER TABLE expenses ADD COLUMN userId TEXT;`);
  }
  
  // MIGRATION: Move existing products.quantity to store_product_stock for default store
  // Check if migration is needed (store_product_stock is empty but products have quantity)
  const stockCount = await executeSql(`SELECT COUNT(*) as cnt FROM store_product_stock;`);
  const hasStock = (stockCount.rows._array[0]?.cnt ?? 0) > 0;
  
  if (!hasStock) {
    // Migrate: copy all products with quantity > 0 to default store
    const DEFAULT_STORE_ID = 'store_default';
    const productsWithStock = await executeSql(`SELECT id, quantity FROM products WHERE quantity > 0;`);
    const rows = productsWithStock.rows._array || [];
    
    for (const row of rows) {
      try {
        await executeSql(`INSERT OR REPLACE INTO store_product_stock (storeId, productId, quantity) VALUES (?, ?, ?);`, [
          DEFAULT_STORE_ID,
          row.id,
          row.quantity || 0,
        ]);
      } catch (e) {
        // ignore duplicate errors
      }
    }
  }
}

// -----------------------
// Exported DB functions
// -----------------------

// Products
export async function createProduct(p: Omit<Product, 'id'>) {
  const id = generateId('prod');
  if (_useSqlite) {
    await executeSql(`INSERT INTO products (id, name, sku, costPrice, sellPrice, quantity, chargeExtra10Percent) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
      id,
      p.name,
      p.sku ?? null,
      p.costPrice ?? 0,
      p.sellPrice ?? 0,
      p.quantity ?? 0,
      p.chargeExtra10Percent ? 1 : 0,
    ]);
    return id;
  }

  // fallback
  await ensureFallbackReady();
  const prod: Product = { id, name: p.name, sku: p.sku ?? null, costPrice: p.costPrice ?? 0, sellPrice: p.sellPrice ?? 0, quantity: p.quantity ?? 0, chargeExtra10Percent: !!p.chargeExtra10Percent };
  fallbackData!.products.push(prod);
  await persistFallback();
  return id;
}

export async function updateProductFlag(productId: string, enabled: boolean) {
  if (_useSqlite) {
    await executeSql(`UPDATE products SET chargeExtra10Percent = ? WHERE id = ?;`, [enabled ? 1 : 0, productId]);
    return;
  }
  await ensureFallbackReady();
  const p = fallbackData!.products.find(x => x.id === productId);
  if (p) {
    p.chargeExtra10Percent = !!enabled;
    await persistFallback();
  }
}

export async function updateProductFull(productId: string, fields: Partial<Product>) {
  if (_useSqlite) {
    const setters: string[] = [];
    const params: any[] = [];
    if (fields.name !== undefined) { setters.push('name = ?'); params.push(fields.name); }
    if (fields.sku !== undefined) { setters.push('sku = ?'); params.push(fields.sku); }
    if (fields.costPrice !== undefined) { setters.push('costPrice = ?'); params.push(fields.costPrice); }
    if (fields.sellPrice !== undefined) { setters.push('sellPrice = ?'); params.push(fields.sellPrice); }
    if (fields.quantity !== undefined) { setters.push('quantity = ?'); params.push(fields.quantity); }
    if (fields.chargeExtra10Percent !== undefined) { setters.push('chargeExtra10Percent = ?'); params.push(fields.chargeExtra10Percent ? 1 : 0); }
    if (setters.length === 0) return;
    params.push(productId);
    const sql = `UPDATE products SET ${setters.join(', ')} WHERE id = ?;`;
    await executeSql(sql, params);
    return;
  }

  await ensureFallbackReady();
  const p = fallbackData!.products.find(x => x.id === productId);
  if (p) {
    Object.assign(p, fields);
    await persistFallback();
  }
}

export async function updateProductQuantity(productId: string, newQty: number) {
  if (_useSqlite) {
    await executeSql(`UPDATE products SET quantity = ? WHERE id = ?;`, [newQty, productId]);
    return;
  }
  await ensureFallbackReady();
  const p = fallbackData!.products.find(x => x.id === productId);
  if (p) { p.quantity = newQty; await persistFallback(); }
}

export async function getProducts(): Promise<Product[]> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM products;`);
    const rows: any[] = res.rows._array || [];
    return rows.map(r => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      costPrice: (r.costPrice === null || r.costPrice === undefined) ? 0 : Number(r.costPrice),
      sellPrice: (r.sellPrice === null || r.sellPrice === undefined) ? 0 : Number(r.sellPrice),
      quantity: (r.quantity === null || r.quantity === undefined) ? 0 : Number(r.quantity),
      chargeExtra10Percent: !!r.chargeExtra10Percent,
    }));
  }
  // fallback
  await ensureFallbackReady();
  return (fallbackData?.products || []).map(p => ({ ...p }));
}

export async function getProductById(productId: string): Promise<Product | null> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM products WHERE id = ? LIMIT 1;`, [productId]);
    const row = res.rows._array[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      costPrice: (row.costPrice === null || row.costPrice === undefined) ? 0 : Number(row.costPrice),
      sellPrice: (row.sellPrice === null || row.sellPrice === undefined) ? 0 : Number(row.sellPrice),
      quantity: (row.quantity === null || row.quantity === undefined) ? 0 : Number(row.quantity),
      chargeExtra10Percent: !!row.chargeExtra10Percent,
    };
  }
  await ensureFallbackReady();
  const p = fallbackData!.products.find(x => x.id === productId);
  return p ? { ...p } : null;
}

// NUEVO: buscar producto por SKU (case-insensitive)
export async function findProductBySku(sku: string): Promise<Product | null> {
  const skuTrim = (sku || '').trim();
  if (!skuTrim) return null;
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM products WHERE LOWER(sku) = LOWER(?) LIMIT 1;`, [skuTrim]);
    const row = res.rows._array[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      costPrice: (row.costPrice === null || row.costPrice === undefined) ? 0 : Number(row.costPrice),
      sellPrice: (row.sellPrice === null || row.sellPrice === undefined) ? 0 : Number(row.sellPrice),
      quantity: (row.quantity === null || row.quantity === undefined) ? 0 : Number(row.quantity),
      chargeExtra10Percent: !!row.chargeExtra10Percent,
    };
  }
  await ensureFallbackReady();
  const p = (fallbackData!.products || []).find(x => (x.sku || '').toLowerCase() === skuTrim.toLowerCase());
  return p ? { ...p } : null;
}

export async function deleteProduct(productId: string) {
  if (_useSqlite) {
    await executeSql(`DELETE FROM products WHERE id = ?;`, [productId]);
    return;
  }
  await ensureFallbackReady();
  fallbackData!.products = fallbackData!.products.filter(x => x.id !== productId);
  await persistFallback();
}

// Sales
export async function createSale(sale: Omit<Sale, 'id' | 'createdAt'>, items: Omit<SaleItem, 'id'>[]) {
  const id = generateId('sale');
  const bizDate = await getActiveBusinessDate();
  const now = buildBusinessTimestamp(bizDate);
  const storeId = sale.storeId || 'store_default'; // Use default store if not specified
  
  if (_useSqlite) {
    // Perform the entire sale operation atomically in a single transaction
    return new Promise((resolve, reject) => {
      try {
        if (!_db) { tryOpenSqlite(); }
        const pendingExpenseIds: string[] = [];
        _db.transaction((tx: any) => {
          // Insert sale header
          tx.executeSql(`INSERT INTO sales (id, createdAt, paymentMethod, subtotal, total, commission, cashAmount, transferAmount, operationNumber, customerName, customerPhone, storeId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
            id,
            now,
            sale.paymentMethod,
            sale.subtotal,
            sale.total,
            sale.commission ?? 0,
            sale.cashAmount ?? 0,
            sale.transferAmount ?? 0,
            sale.operationNumber ?? null,
            sale.customerName ?? null,
            sale.customerPhone ?? null,
            storeId,
            sale.userId ?? null,
          ]);

          // Insert each item and reduce stock PER STORE
          for (const it of items) {
            const itemId = generateId('sitem');
            tx.executeSql(`INSERT INTO sale_items (id, saleId, productId, quantity, unitCost, unitPrice, extra10PercentAmount) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
              itemId,
              id,
              it.productId,
              it.quantity,
              it.unitCost,
              it.unitPrice,
              it.extra10PercentAmount ?? 0,
            ]);
            
            // Reduce per-store stock (not global products.quantity)
            tx.executeSql(`
              INSERT INTO store_product_stock (storeId, productId, quantity)
              VALUES (?, ?, ?)
              ON CONFLICT(storeId, productId) DO UPDATE SET quantity = MAX(0, quantity - ?)
            `, [storeId, it.productId, -it.quantity, it.quantity]);
            
            // Also update legacy products.quantity for backward compatibility (optional, can be removed later)
            tx.executeSql(`UPDATE products SET quantity = MAX(0, COALESCE(quantity, 0) - ?) WHERE id = ?;`, [it.quantity, it.productId]);
            
            // Register inventory movement as 'sale' (outbound)
            const invId = generateId('inv');
            tx.executeSql(`INSERT INTO inventory_entries (id, createdAt, type, productId, quantity, unitCost, paymentMethod, note, storeId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
              invId,
              now,
              'sale',
              it.productId,
              it.quantity,
              it.unitCost,
              null,
              `Venta ${id}`,
              storeId,
            ]);
          }

          // Commission expense (if any) recorded within same transaction
          if ((sale as any).commission && (sale as any).commission > 0) {
            const expId = generateId('exp');
            pendingExpenseIds.push(expId);
            tx.executeSql(`INSERT INTO expenses (id, createdAt, type, amount, note, storeId, userId) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
              expId,
              now,
              'other',
              (sale as any).commission,
              `Comisión bancaria 1.5% - Venta ${id}`,
              storeId,
              sale.userId ?? null,
            ]);
          }
        }, (err: any) => {
          reject(err);
        }, async () => {
          // Emit event and update day ledger after successful transaction
          try {
            const { appendSaleToDay, appendExpenseToDay } = require('./dayManager');
            await appendSaleToDay(id);
            for (const eId of pendingExpenseIds) {
              await appendExpenseToDay(eId);
            }
          } catch (_) {}
          DeviceEventEmitter.emit('saleCreated', { saleId: id });
          resolve(id);
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  // fallback flow
  await ensureFallbackReady();
  fallbackData!.sales.push({ id, createdAt: now, paymentMethod: sale.paymentMethod, subtotal: sale.subtotal, total: sale.total, commission: sale.commission ?? 0, cashAmount: sale.cashAmount ?? 0, transferAmount: sale.transferAmount ?? 0, operationNumber: sale.operationNumber ?? null, customerName: sale.customerName ?? null, customerPhone: sale.customerPhone ?? null, storeId, userId: sale.userId ?? null });
  for (const it of items) {
    const itemId = generateId('sitem');
    fallbackData!.saleItems.push({ id: itemId, saleId: id, productId: it.productId, quantity: it.quantity, unitCost: it.unitCost, unitPrice: it.unitPrice, extra10PercentAmount: it.extra10PercentAmount ?? 0 });
    
    // Reduce per-store stock
    if (!(fallbackData as any).storeStock) (fallbackData as any).storeStock = {};
    const key = `${storeId}_${it.productId}`;
    const currentStock = (fallbackData as any).storeStock[key] ?? 0;
    (fallbackData as any).storeStock[key] = Math.max(0, currentStock - it.quantity);
    
    // Legacy: also reduce global inventory (optional, can remove later)
    const p = fallbackData!.products.find(x => x.id === it.productId);
    if (p) p.quantity = Math.max(0, (p.quantity || 0) - it.quantity);
    
    // Register inventory movement as 'sale' (outbound)
    fallbackData!.inventoryEntries = fallbackData!.inventoryEntries || [];
    fallbackData!.inventoryEntries.push({ id: generateId('inv'), createdAt: now, type: 'sale', productId: it.productId, quantity: it.quantity, unitCost: it.unitCost, paymentMethod: null, note: `Venta ${id}`, storeId });
  }
  // commission
  let createdCommissionExpenseId: string | null = null;
  if ((sale as any).commission && (sale as any).commission > 0) {
    createdCommissionExpenseId = generateId('exp');
    fallbackData!.expenses.push({ id: createdCommissionExpenseId, createdAt: now, type: 'other', amount: (sale as any).commission, note: `Comisión bancaria 1.5% - Venta ${id}`, storeId, userId: sale.userId ?? null });
  }
  await persistFallback();
  // Append to day ledger
  try {
    const { appendSaleToDay, appendExpenseToDay } = require('./dayManager');
    await appendSaleToDay(id);
    if (createdCommissionExpenseId) await appendExpenseToDay(createdCommissionExpenseId);
  } catch (_) {}
  // Emit event after successful fallback save
  DeviceEventEmitter.emit('saleCreated', { saleId: id });
  return id;
}

export async function getSales(filter?: { storeId?: string | null; userId?: string | null }) {
  // If filter.storeId is provided, return only sales for that store. If storeId is null, return all (admin).
  // If filter.userId is provided, return only sales for that user (seller).
  if (_useSqlite) {
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (filter?.storeId) {
      conditions.push('storeId = ?');
      params.push(filter.storeId);
    }
    if (filter?.userId) {
      conditions.push('userId = ?');
      params.push(filter.userId);
    }
    
    let sql = 'SELECT * FROM sales';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY createdAt DESC;';
    
    const res = await executeSql(sql, params);
    return res.rows._array;
  }
  await ensureFallbackReady();
  let rows = [...(fallbackData!.sales || [])];
  if (filter?.storeId) rows = rows.filter(r => r.storeId === filter.storeId);
  if (filter?.userId) rows = rows.filter(r => r.userId === filter.userId);
  return rows.sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function getSaleItemsBySaleId(saleId: string) {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM sale_items WHERE saleId = ?;`, [saleId]);
    return res.rows._array;
  }
  await ensureFallbackReady();
  return (fallbackData!.saleItems || []).filter(x => x.saleId === saleId);
}

export async function getAllSaleItems() {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM sale_items;`);
    return res.rows._array;
  }
  await ensureFallbackReady();
  return fallbackData!.saleItems || [];
}

// Expenses
export async function createExpense(exp: Omit<Expense, 'id' | 'createdAt'>) {
  await initDb();
  const id = generateId('exp');
  const bizDate = await getActiveBusinessDate();
  const now = buildBusinessTimestamp(bizDate);
  if (_useSqlite) {
    await executeSql(`INSERT INTO expenses (id, createdAt, type, amount, note, storeId, userId) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
      id,
      now,
      exp.type,
      exp.amount,
      exp.note ?? null,
      exp.storeId ?? null,
      exp.userId ?? null,
    ]);
    // Update day ledger automatically
    try {
      const { appendExpenseToDay } = require('./dayManager');
      await appendExpenseToDay(id);
    } catch (_) {}
    // Emit event so any subscriber (e.g., Cash screen) refreshes
    DeviceEventEmitter.emit('expenseCreated', { expenseId: id });
    return id;
  }
  await ensureFallbackReady();
  fallbackData!.expenses.push({ id, createdAt: now, type: exp.type, amount: exp.amount, note: exp.note ?? null, storeId: exp.storeId ?? null, userId: exp.userId ?? null });
  await persistFallback();
  // Update day ledger automatically
  try {
    const { appendExpenseToDay } = require('./dayManager');
    await appendExpenseToDay(id);
  } catch (_) {}
  // Emit event so any subscriber (e.g., Cash screen) refreshes
  DeviceEventEmitter.emit('expenseCreated', { expenseId: id });
  return id;
}
 
export async function getExpenses(filter?: { storeId?: string | null; userId?: string | null }) {
  await initDb();
  if (_useSqlite) {
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (filter?.storeId) {
      conditions.push('storeId = ?');
      params.push(filter.storeId);
    }
    if (filter?.userId) {
      conditions.push('userId = ?');
      params.push(filter.userId);
    }
    
    let sql = 'SELECT * FROM expenses';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY createdAt DESC;';
    
    const res = await executeSql(sql, params);
    return res.rows._array;
  }
  await ensureFallbackReady();
  let rows = fallbackData!.expenses || [];
  if (filter?.storeId) rows = rows.filter(r => r.storeId === filter.storeId);
  if (filter?.userId) rows = rows.filter(r => r.userId === filter.userId);
  return rows;
}

// Cash sessions
export async function createCashSession(session: Omit<CashSession, 'id' | 'openedAt'>) {
  const id = generateId('cash');
  const bizDate = await getActiveBusinessDate();
  const now = buildBusinessTimestamp(bizDate);
  if (_useSqlite) {
    await executeSql(`INSERT INTO cash_sessions (id, openedAt, closedAt, startingBalance, endingBalance, note, storeId) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
      id,
      now,
      session.closedAt ?? null,
      session.startingBalance,
      session.endingBalance ?? null,
      session.note ?? null,
      session.storeId ?? null,
    ]);
    return id;
  }
  await ensureFallbackReady();
  fallbackData!.sessions.push({ id, openedAt: now, closedAt: session.closedAt ?? null, startingBalance: session.startingBalance, endingBalance: session.endingBalance ?? null, note: session.note ?? null, storeId: session.storeId ?? null });
  await persistFallback();
  return id;
}

export async function updateCashSession(sessionId: string, fields: Partial<CashSession>) {
  if (_useSqlite) {
    const setters: string[] = [];
    const params: any[] = [];
    if (fields.closedAt !== undefined) { setters.push('closedAt = ?'); params.push(fields.closedAt); }
    if (fields.endingBalance !== undefined) { setters.push('endingBalance = ?'); params.push(fields.endingBalance); }
    if (fields.note !== undefined) { setters.push('note = ?'); params.push(fields.note); }
    if (setters.length === 0) return;
    params.push(sessionId);
    const sql = `UPDATE cash_sessions SET ${setters.join(', ')} WHERE id = ?;`;
    await executeSql(sql, params);
    return;
  }
  await ensureFallbackReady();
  const s = fallbackData!.sessions.find(x => x.id === sessionId);
  if (s) { Object.assign(s, fields); await persistFallback(); }
}

export async function getCashSessions() {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM cash_sessions ORDER BY openedAt DESC;`);
    const rows: any[] = res.rows._array || [];
    // Normalize values to avoid UI mismatches when reopening (handle '', 'null', undefined)
    return rows.map(r => ({
      id: r.id,
      openedAt: r.openedAt,
      closedAt: (r.closedAt === null || r.closedAt === undefined || r.closedAt === '' || r.closedAt === 'null') ? null : r.closedAt,
      startingBalance: (r.startingBalance === null || r.startingBalance === undefined) ? 0 : Number(r.startingBalance),
      endingBalance: (r.endingBalance === null || r.endingBalance === undefined || r.endingBalance === '' || r.endingBalance === 'null') ? null : Number(r.endingBalance),
      note: r.note ?? null,
    }));
  }
  await ensureFallbackReady();
  const sessions = fallbackData?.sessions || [];
  return [...sessions].sort((a,b) => (b.openedAt || '').localeCompare(a.openedAt || ''));
}

// Add: reopen a cash session without losing day data
export async function reopenCashSession(sessionId: string) {
  if (_useSqlite) {
    // Preserve endingBalance and note; just mark as open by clearing closedAt
    await executeSql(`UPDATE cash_sessions SET closedAt = NULL WHERE id = ?;`, [sessionId]);
    // Emit event so UI can refresh immediately without tab focus changes
    DeviceEventEmitter.emit('cashSessionReopened', { sessionId });
    return;
  }
  await ensureFallbackReady();
  const s = (fallbackData!.sessions || []).find((x:any) => x.id === sessionId);
  if (s) {
    s.closedAt = null;
    // Keep s.endingBalance intact to preserve previous counted snapshot
    await persistFallback();
    // Emit event so UI can refresh immediately without tab focus changes
    DeviceEventEmitter.emit('cashSessionReopened', { sessionId });
  }
}

// Inventory Entries
export async function createInventoryEntry(entry: Omit<InventoryEntry, 'id' | 'createdAt'>) {
  const id = generateId('inv');
  const bizDate = await getActiveBusinessDate();
  const now = buildBusinessTimestamp(bizDate);
  const storeId = entry.storeId || 'store_default';
  const targetStoreId = entry.targetStoreId || null;
  
  if (_useSqlite) {
    await executeSql(`INSERT INTO inventory_entries (id, createdAt, type, productId, quantity, unitCost, paymentMethod, note, storeId, targetStoreId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
      id,
      now,
      entry.type,
      entry.productId,
      entry.quantity,
      entry.unitCost,
      entry.paymentMethod ?? null,
      entry.note ?? null,
      storeId,
      targetStoreId,
    ]);

    // Adjust PER-STORE stock based on entry type
    if (entry.type === 'purchase' || entry.type === 'transfer_in' || entry.type === 'adjustment') {
      // Inbound: increase stock in destination store. Prefer targetStoreId when provided; fallback to storeId.
      const effectiveStoreId = targetStoreId || storeId;
      await adjustProductStockInStore(entry.productId, effectiveStoreId, entry.quantity);
      
      // Update costPrice if this is a purchase
      if (entry.type === 'purchase') {
        await executeSql(`UPDATE products SET costPrice = ? WHERE id = ?;`, [entry.unitCost, entry.productId]);
      }
    } else if (entry.type === 'transfer_out') {
      // Outbound: decrease stock from source store
      await adjustProductStockInStore(entry.productId, storeId, -entry.quantity);
    }
    // 'sale' type is handled in createSale, not here

    // Legacy: also update global products.quantity for backward compatibility (optional)
    // Use the same effective store used for the adjustment to reflect correct per-store stock in the global quantity snapshot.
    const legacyStoreId = (entry.type === 'purchase' || entry.type === 'transfer_in' || entry.type === 'adjustment') ? (targetStoreId || storeId) : storeId;
    const current = await getProductStockInStore(entry.productId, legacyStoreId);
    await updateProductQuantity(entry.productId, current);

    return id;
  }

  // fallback
  await ensureFallbackReady();
  fallbackData!.inventoryEntries = fallbackData!.inventoryEntries || [];
  fallbackData!.inventoryEntries.push({ id, createdAt: now, type: entry.type, productId: entry.productId, quantity: entry.quantity, unitCost: entry.unitCost, paymentMethod: entry.paymentMethod ?? null, note: entry.note ?? null, storeId, targetStoreId });
  
  // Adjust per-store stock
  if (!(fallbackData as any).storeStock) (fallbackData as any).storeStock = {};
  
  if (entry.type === 'purchase' || entry.type === 'transfer_in' || entry.type === 'adjustment') {
    // Prefer targetStoreId when provided; fallback to storeId.
    const effectiveStoreId = targetStoreId || storeId;
    const key = `${effectiveStoreId}_${entry.productId}`;
    const currentStock = (fallbackData as any).storeStock[key] ?? 0;
    (fallbackData as any).storeStock[key] = currentStock + entry.quantity;
    
    if (entry.type === 'purchase') {
      const p = fallbackData!.products.find(x => x.id === entry.productId);
      if (p) p.costPrice = entry.unitCost;
    }
  } else if (entry.type === 'transfer_out') {
    const key = `${storeId}_${entry.productId}`;
    const currentStock = (fallbackData as any).storeStock[key] ?? 0;
    (fallbackData as any).storeStock[key] = Math.max(0, currentStock - entry.quantity);
  }
  
  // Legacy: update global product.quantity for compatibility
  const p = fallbackData!.products.find(x => x.id === entry.productId);
  if (p) {
    if (entry.type === 'purchase' || entry.type === 'transfer_in' || entry.type === 'adjustment') {
      p.quantity = (p.quantity || 0) + entry.quantity;
    } else if (entry.type === 'transfer_out') {
      p.quantity = Math.max(0, (p.quantity || 0) - entry.quantity);
    }
  }
  
  await persistFallback();
  return id;
}

export async function getInventoryEntries() {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM inventory_entries ORDER BY createdAt DESC;`);
    return res.rows._array;
  }
  await ensureFallbackReady();
  fallbackData!.inventoryEntries = fallbackData!.inventoryEntries || [];
  return [...(fallbackData!.inventoryEntries || [])].sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// NEW: Get inventory history for a specific product
export async function getProductHistory(productId: string): Promise<any[]> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT * FROM inventory_entries WHERE productId = ? ORDER BY createdAt DESC;`, [productId]);
    return res.rows._array || [];
  }
  await ensureFallbackReady();
  fallbackData!.inventoryEntries = fallbackData!.inventoryEntries || [];
  return [...(fallbackData!.inventoryEntries || [])]
    .filter(entry => entry.productId === productId)
    .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Product Sales Report (aggregated by product)
export async function getProductSalesReport() {
  const products = await getProducts();
  const saleItems = await getAllSaleItems();
  
  const productMap = new Map(products.map(p => [p.id, p]));
  
  // Aggregate sales by productId
  const reportMap = new Map<string, {
    productId: string;
    productName: string;
    totalQuantity: number;
    totalRevenue: number;
    totalCost: number;
    profit: number;
  }>();
  
  for (const item of saleItems) {
    const product = productMap.get(item.productId);
    if (!product) continue;
    
    const revenue = (item.unitPrice * item.quantity) + (item.extra10PercentAmount || 0);
    const cost = (item.unitCost || 0) * item.quantity;
    
    const existing = reportMap.get(item.productId);
    if (existing) {
      existing.totalQuantity += item.quantity;
      existing.totalRevenue += revenue;
      existing.totalCost += cost;
      existing.profit = existing.totalRevenue - existing.totalCost;
    } else {
      reportMap.set(item.productId, {
        productId: item.productId,
        productName: product.name,
        totalQuantity: item.quantity,
        totalRevenue: revenue,
        totalCost: cost,
        profit: revenue - cost,
      });
    }
  }
  
  return Array.from(reportMap.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
}

// Inventory Movements Report (aggregated by product and type)
export async function getInventoryMovementsReport() {
  const products = await getProducts();
  const entries = await getInventoryEntries();
  
  const productMap = new Map(products.map(p => [p.id, p]));
  
  // Group movements by product
  const reportMap = new Map<string, {
    productId: string;
    productName: string;
    purchases: number; // inbound
    transfersIn: number; // inbound
    adjustments: number; // inbound
    sales: number; // outbound
    transfersOut: number; // outbound
    netChange: number;
    currentStock: number;
  }>();
  
  for (const entry of entries) {
    const product = productMap.get(entry.productId);
    if (!product) continue;
    
    let existing = reportMap.get(entry.productId);
    if (!existing) {
      existing = {
        productId: entry.productId,
        productName: product.name,
        purchases: 0,
        transfersIn: 0,
        adjustments: 0,
        sales: 0,
        transfersOut: 0,
        netChange: 0,
        currentStock: product.quantity || 0,
      };
      reportMap.set(entry.productId, existing);
    }
    
    const qty = entry.quantity || 0;
    
    if (entry.type === 'purchase') {
      existing.purchases += qty;
      existing.netChange += qty;
    } else if (entry.type === 'transfer_in') {
      existing.transfersIn += qty;
      existing.netChange += qty;
    } else if (entry.type === 'adjustment') {
      existing.adjustments += qty;
      existing.netChange += qty;
    } else if (entry.type === 'sale') {
      existing.sales += qty;
      existing.netChange -= qty;
    } else if (entry.type === 'transfer_out') {
      existing.transfersOut += qty;
      existing.netChange -= qty;
    }
  }
  
  return Array.from(reportMap.values()).sort((a, b) => a.productName.localeCompare(b.productName));
}

// Export/Import DB as JSON
export async function exportDatabaseAsJSON() {
  // Ensure DB is initialized so we know which mode to use and migrations are ready
  try { await initDb(); } catch (_) {}
  if (_useSqlite) {
    const products = await getProducts();
    const sales = await getSales();
    const saleItemsRes = await executeSql(`SELECT * FROM sale_items;`);
    const saleItems = saleItemsRes.rows._array;
    const expenses = await getExpenses();
    const sessions = await getCashSessions();
    const inventoryEntriesRes = await executeSql(`SELECT * FROM inventory_entries;`);
    const inventoryEntries = inventoryEntriesRes.rows._array;
    const storeStockRes = await executeSql(`SELECT storeId, productId, quantity FROM store_product_stock;`);
    const storeStock = storeStockRes.rows._array;
    // Also include users, stores, and current session from AsyncStorage (hooks/useAuth)
    try {
      const usersRaw = await AsyncStorage.getItem('app:users');
      const storesRaw = await AsyncStorage.getItem('app:stores');
      const currentUserRaw = await AsyncStorage.getItem('app:currentUser');
      return JSON.stringify({ products, sales, saleItems, expenses, sessions, inventoryEntries, storeStock, users: usersRaw ? JSON.parse(usersRaw) : [], stores: storesRaw ? JSON.parse(storesRaw) : [], currentUser: currentUserRaw ? JSON.parse(currentUserRaw) : null }, null, 2);
    } catch (_) {
      return JSON.stringify({ products, sales, saleItems, expenses, sessions, inventoryEntries, storeStock }, null, 2);
    }
  }
  return JSON.stringify(fallbackData, null, 2);
}

export async function importDatabaseFromJSON(jsonString: string) {
  // Ensure DB is initialized so tables/migrations exist and mode is selected correctly
  try { await initDb(); } catch (_) {}
  const data = JSON.parse(jsonString);

  const normalizeArray = <T,>(value: any): T[] => {
    if (Array.isArray(value)) return value as T[];
    if (!value) return [];
    // Older backups might store collections as an object keyed by id.
    // JSON cannot represent Symbol.iterator, so treating objects as Object.values is safe.
    if (typeof value === 'object') {
      try {
        return Object.values(value) as T[];
      } catch {
        return [];
      }
    }
    return [];
  };

  const normalizeStoreStock = (value: any): Array<{ storeId: string; productId: string; quantity: number }> => {
    // Preferred (current) format: [{ storeId, productId, quantity }]
    if (Array.isArray(value)) {
      return value
        .map((x) => ({
          storeId: String((x as any)?.storeId ?? ''),
          productId: String((x as any)?.productId ?? ''),
          quantity: Number((x as any)?.quantity ?? 0),
        }))
        .filter((x) => !!x.storeId && !!x.productId);
    }

    // Legacy format: { "storeId_prod_xxx": 12, ... }
    if (value && typeof value === 'object') {
      const out: Array<{ storeId: string; productId: string; quantity: number }> = [];
      for (const [key, qty] of Object.entries(value)) {
        // Our legacy key builder was `${storeId}_${productId}` and productId starts with `prod_`.
        const boundary = key.lastIndexOf('_prod_');
        if (boundary > 0) {
          const storeId = key.slice(0, boundary);
          const productId = key.slice(boundary + 1);
          out.push({ storeId, productId, quantity: Number(qty ?? 0) });
          continue;
        }

        // Another possible legacy format: values are objects already.
        if (qty && typeof qty === 'object') {
          const maybe = qty as any;
          if (maybe.storeId && maybe.productId) {
            out.push({
              storeId: String(maybe.storeId),
              productId: String(maybe.productId),
              quantity: Number(maybe.quantity ?? 0),
            });
          }
        }
      }
      return out.filter((x) => !!x.storeId && !!x.productId);
    }

    return [];
  };

  if (_useSqlite) {
    // import using SQL
    const products = normalizeArray<any>(data.products);
    if (products.length > 0) {
      for (const p of products) {
        try {
          const productId = p?.id ?? p?._id;
          if (!productId) continue;
          await executeSql(`INSERT OR REPLACE INTO products (id, name, sku, costPrice, sellPrice, quantity, chargeExtra10Percent) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
            productId,
            p.name,
            p.sku ?? null,
            p.costPrice,
            p.sellPrice,
            p.quantity,
            p.chargeExtra10Percent ? 1 : 0,
          ]);
        } catch (e) {}
      }
    }

    const sales = normalizeArray<any>(data.sales);
    if (sales.length > 0) {
      for (const s of sales) {
        try {
          const saleId = s?.id ?? s?._id;
          if (!saleId) continue;
          await executeSql(`INSERT OR REPLACE INTO sales (id, createdAt, paymentMethod, subtotal, total, commission, cashAmount, transferAmount, operationNumber, customerName, customerPhone, storeId, userId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
            saleId,
            s.createdAt,
            s.paymentMethod,
            s.subtotal,
            s.total,
            s.commission ?? 0,
            s.cashAmount ?? 0,
            s.transferAmount ?? 0,
            s.operationNumber ?? null,
            s.customerName ?? null,
            s.customerPhone ?? null,
            s.storeId ?? null,
            s.userId ?? null,
          ]);
        } catch (e) {}
      }
    }

    const items = normalizeArray<any>(data.saleItems ?? data.sale_items);
    for (const it of items) {
      try {
        const itemId = it?.id ?? it?._id;
        const saleId = it?.saleId ?? it?.sale_id;
        const productId = it?.productId ?? it?.product_id;
        if (!itemId || !saleId || !productId) continue;
        await executeSql(`INSERT OR REPLACE INTO sale_items (id, saleId, productId, quantity, unitCost, unitPrice, extra10PercentAmount) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
          itemId,
          saleId,
          productId,
          it.quantity,
          it.unitCost,
          it.unitPrice,
          it.extra10PercentAmount ?? 0,
        ]);
      } catch (e) {}
    }

    const expenses = normalizeArray<any>(data.expenses);
    if (expenses.length > 0) {
      for (const ex of expenses) {
        try {
          const expenseId = ex?.id ?? ex?._id;
          if (!expenseId) continue;
          await executeSql(`INSERT OR REPLACE INTO expenses (id, createdAt, type, amount, note, storeId, userId) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
            expenseId,
            ex.createdAt,
            ex.type,
            ex.amount,
            ex.note ?? null,
            ex.storeId ?? null,
            ex.userId ?? null,
          ]);
        } catch (e) {}
      }
    }

    const sessions = normalizeArray<any>(data.sessions);
    if (sessions.length > 0) {
      for (const s of sessions) {
        try {
          const sessionId = s?.id ?? s?._id;
          if (!sessionId) continue;
          await executeSql(`INSERT OR REPLACE INTO cash_sessions (id, openedAt, closedAt, startingBalance, endingBalance, note, storeId) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
            sessionId,
            s.openedAt,
            s.closedAt ?? null,
            s.startingBalance,
            s.endingBalance ?? null,
            s.note ?? null,
            s.storeId ?? null,
          ]);
        } catch (e) {}
      }
    }

    const inventoryEntries = normalizeArray<any>(data.inventoryEntries);
    if (inventoryEntries.length > 0) {
      for (const inv of inventoryEntries) {
        try {
          const invId = inv?.id ?? inv?._id;
          if (!invId) continue;
          await executeSql(`INSERT OR REPLACE INTO inventory_entries (id, createdAt, type, productId, quantity, unitCost, paymentMethod, note, storeId, targetStoreId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
            invId,
            inv.createdAt,
            inv.type,
            inv.productId ?? inv.product_id,
            inv.quantity,
            inv.unitCost,
            inv.paymentMethod ?? null,
            inv.note ?? null,
            inv.storeId ?? null,
            inv.targetStoreId ?? null,
          ]);
        } catch (e) {}
      }
    }

    const storeStock = normalizeStoreStock(data.storeStock);
    for (const ss of storeStock) {
      try {
        const storeId = (ss as any)?.storeId ?? (ss as any)?.store_id;
        const productId = (ss as any)?.productId ?? (ss as any)?.product_id;
        if (!storeId || !productId) continue;
        await executeSql(`INSERT OR REPLACE INTO store_product_stock (storeId, productId, quantity) VALUES (?, ?, ?);`, [String(storeId), String(productId), Number((ss as any)?.quantity ?? 0)]);
      } catch (e) {}
    }

    // Restore users, stores, and session if present
    try {
      if (data.users) await AsyncStorage.setItem('app:users', JSON.stringify(data.users));
      if (data.stores) await AsyncStorage.setItem('app:stores', JSON.stringify(data.stores));
      if (data.currentUser) await AsyncStorage.setItem('app:currentUser', JSON.stringify(data.currentUser));
    } catch (_) {}
    return;
  }

  // fallback: merge arrays (replace by id)
  const ensuredFallbackData: FallbackDB = fallbackData ?? {
    products: [],
    sales: [],
    saleItems: [],
    expenses: [],
    sessions: [],
    inventoryEntries: [],
  };
  fallbackData = ensuredFallbackData;

  const fallbackProducts = normalizeArray<any>(data.products);
  if (fallbackProducts.length > 0) {
    const map = new Map((ensuredFallbackData.products || []).map((p: any) => [p.id, p]));
    for (const p of fallbackProducts) {
      const id = p?.id ?? p?._id;
      if (!id) continue;
      map.set(id, { ...p, id });
    }
    ensuredFallbackData.products = Array.from(map.values());
  }

  const fallbackSales = normalizeArray<any>(data.sales);
  if (fallbackSales.length > 0) {
    const map = new Map((ensuredFallbackData.sales || []).map((s: any) => [s.id, s]));
    for (const s of fallbackSales) {
      const id = s?.id ?? s?._id;
      if (!id) continue;
      map.set(id, { ...s, id });
    }
    ensuredFallbackData.sales = Array.from(map.values());
  }

  const fallbackItems = normalizeArray<any>(data.saleItems ?? data.sale_items);
  if (fallbackItems.length > 0) {
    const map = new Map((ensuredFallbackData.saleItems || []).map((it: any) => [it.id, it]));
    for (const it of fallbackItems) {
      const id = it?.id ?? it?._id;
      if (!id) continue;
      map.set(id, { ...it, id });
    }
    ensuredFallbackData.saleItems = Array.from(map.values());
  }

  const fallbackExpenses = normalizeArray<any>(data.expenses);
  if (fallbackExpenses.length > 0) {
    const map = new Map((ensuredFallbackData.expenses || []).map((e: any) => [e.id, e]));
    for (const e of fallbackExpenses) {
      const id = e?.id ?? e?._id;
      if (!id) continue;
      map.set(id, { ...e, id });
    }
    ensuredFallbackData.expenses = Array.from(map.values());
  }

  const fallbackSessions = normalizeArray<any>(data.sessions);
  if (fallbackSessions.length > 0) {
    const map = new Map((ensuredFallbackData.sessions || []).map((s: any) => [s.id, s]));
    for (const s of fallbackSessions) {
      const id = s?.id ?? s?._id;
      if (!id) continue;
      map.set(id, { ...s, id });
    }
    ensuredFallbackData.sessions = Array.from(map.values());
  }

  const fallbackInventoryEntries = normalizeArray<any>(data.inventoryEntries);
  if (fallbackInventoryEntries.length > 0) {
    const map = new Map((ensuredFallbackData.inventoryEntries || []).map((e: any) => [e.id, e]));
    for (const e of fallbackInventoryEntries) {
      const id = e?.id ?? e?._id;
      if (!id) continue;
      map.set(id, { ...e, id });
    }
    ensuredFallbackData.inventoryEntries = Array.from(map.values());
  }

  // Merge per-store stock (fallbackData.storeStock)
  const normalizedFallbackStoreStock = normalizeStoreStock(data.storeStock);
  if (normalizedFallbackStoreStock.length > 0) {
    (ensuredFallbackData as any).storeStock = (ensuredFallbackData as any).storeStock || {};
    for (const ss of normalizedFallbackStoreStock) {
      const key = `${ss.storeId}_${ss.productId}`;
      (ensuredFallbackData as any).storeStock[key] = ss.quantity ?? 0;
    }
  }

  await persistFallback();

  // Restore users, stores, and session if present
  try {
    if (data.users) await AsyncStorage.setItem('app:users', JSON.stringify(data.users));
    if (data.stores) await AsyncStorage.setItem('app:stores', JSON.stringify(data.stores));
    if (data.currentUser) await AsyncStorage.setItem('app:currentUser', JSON.stringify(data.currentUser));
  } catch (_) {}
}

// -----------------------
// Reset database to empty state (products, sales, items, expenses, sessions, inventory)
// -----------------------
export async function resetDatabase() {
  try {
    await initDb();
  } catch (_) {}

  if (_useSqlite) {
    // Clear all rows from tables atomically
    try {
      await executeSql('DELETE FROM sale_items;');
      await executeSql('DELETE FROM sales;');
      await executeSql('DELETE FROM expenses;');
      await executeSql('DELETE FROM cash_sessions;');
      await executeSql('DELETE FROM inventory_entries;');
      await executeSql('DELETE FROM products;');
      // Optionally reclaim space
      try { await executeSql('VACUUM;'); } catch (_) {}
    } catch (e) {
      console.warn('SQLite reset error:', e?.message ?? e);
      throw e;
    }
    return;
  }

  // Fallback: reset in-memory + AsyncStorage store
  fallbackData = { products: [], sales: [], saleItems: [], expenses: [], sessions: [], inventoryEntries: [] };
  try {
    await AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(fallbackData));
  } catch (e) {
    console.warn('Fallback reset error:', e?.message ?? e);
  }
}

// NEW: Helper functions for per-store stock management

// Get stock for a product in a specific store
export async function getProductStockInStore(productId: string, storeId: string): Promise<number> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT quantity FROM store_product_stock WHERE storeId = ? AND productId = ?;`, [storeId, productId]);
    return res.rows._array[0]?.quantity ?? 0;
  }
  
  // Fallback: AsyncStorage
  await ensureFallbackReady();
  const key = `${storeId}_${productId}`;
  const stockData = (fallbackData as any).storeStock || {};
  return stockData[key] ?? 0;
}

// Set stock for a product in a specific store
export async function setProductStockInStore(productId: string, storeId: string, quantity: number) {
  if (_useSqlite) {
    await executeSql(`INSERT OR REPLACE INTO store_product_stock (storeId, productId, quantity) VALUES (?, ?, ?);`, [storeId, productId, Math.max(0, quantity)]);
    return;
  }
  
  // Fallback
  await ensureFallbackReady();
  if (!(fallbackData as any).storeStock) (fallbackData as any).storeStock = {};
  const key = `${storeId}_${productId}`;
  (fallbackData as any).storeStock[key] = Math.max(0, quantity);
  await persistFallback();
}

// Adjust stock for a product in a store (delta can be positive or negative)
export async function adjustProductStockInStore(productId: string, storeId: string, delta: number) {
  const current = await getProductStockInStore(productId, storeId);
  const newQty = Math.max(0, current + delta);
  await setProductStockInStore(productId, storeId, newQty);
  
  // Trigger automatic transfer suggestions if stock is low
  try {
    const product = await getProductById(productId);
    if (product) {
      const minStock = product.minStock || 5;
      if (newQty < minStock && delta < 0) {
        // Stock dropped below minimum, generate suggestions for this product
        await generateTransferSuggestionsForProduct(productId);
      }
    }
  } catch (error) {
    console.warn('Auto-suggestion trigger error:', error);
    // Don't fail the stock adjustment if suggestion generation fails
  }
  
  return newQty;
}

// Get all stock entries for a store (for inventory screens)
export async function getStoreStock(storeId: string): Promise<Array<{ productId: string; quantity: number }>> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT productId, quantity FROM store_product_stock WHERE storeId = ?;`, [storeId]);
    return res.rows._array || [];
  }
  
  // Fallback
  await ensureFallbackReady();
  const stockData = (fallbackData as any).storeStock || {};
  const result: Array<{ productId: string; quantity: number }> = [];
  for (const key in stockData) {
    if (key.startsWith(`${storeId}_`)) {
      const productId = key.substring(storeId.length + 1);
      result.push({ productId, quantity: stockData[key] });
    }
  }
  return result;
}

// Get aggregated stock across all stores for admin view
export async function getProductStockAllStores(productId: string): Promise<Array<{ storeId: string; quantity: number }>> {
  if (_useSqlite) {
    const res = await executeSql(`SELECT storeId, quantity FROM store_product_stock WHERE productId = ?;`, [productId]);
    return res.rows._array || [];
  }
  
  // Fallback
  await ensureFallbackReady();
  const stockData = (fallbackData as any).storeStock || {};
  const result: Array<{ storeId: string; quantity: number }> = [];
  for (const key in stockData) {
    if (key.endsWith(`_${productId}`)) {
      const storeId = key.substring(0, key.length - productId.length - 1);
      result.push({ storeId, quantity: stockData[key] });
    }
  }
  return result;
}

// NEW: Merge stock data function for safe import by sellers
export async function mergeStockData(existingStock: any[], importedStock: any[], storeId: string) {
  try {
    // For each imported stock item
    for (const importedItem of importedStock) {
      // Find existing stock for the same product
      const existingItem = existingStock.find(
        item => item.productId === importedItem.productId
      );
      
      if (existingItem) {
        // If exists, take the higher value
        const newQuantity = Math.max(existingItem.quantity, importedItem.quantity);
        
        if (newQuantity !== existingItem.quantity) {
          // Update only if changed
          await setProductStockInStore(importedItem.productId, storeId, newQuantity);
          
          // Legacy: also update global products.quantity for backward compatibility
          const product = await getProductById(importedItem.productId);
          if (product) {
            await updateProductQuantity(product.id, newQuantity);
          }
          
          console.log(`Stock updated: Product ${importedItem.productId}, quantity: ${newQuantity}`);
        }
      } else {
        // If doesn't exist, insert new stock
        await setProductStockInStore(importedItem.productId, storeId, importedItem.quantity);
        
        // Legacy: also update global products.quantity
        const product = await getProductById(importedItem.productId);
        if (!product) {
          // Create product if it doesn't exist
          await createProduct({
            name: importedItem.productName || `Producto ${importedItem.productId}`,
            sku: null,
            costPrice: importedItem.unitCost || 0,
            sellPrice: 0,
            quantity: importedItem.quantity,
            chargeExtra10Percent: false
          });
        } else {
          await updateProductQuantity(product.id, importedItem.quantity);
        }
        
        console.log(`Stock added: Product ${importedItem.productId}, quantity: ${importedItem.quantity}`);
      }
    }
    
    return { success: true, message: 'Stocks fusionados correctamente' };
  } catch (error) {
    console.error('Error in mergeStockData:', error);
    throw error;
  }
}

// NEW: Get stock for a specific store
export async function getStockForStore(storeId: string) {
  if (_useSqlite) {
    const res = await executeSql(
      `SELECT sps.productId, sps.quantity, p.name as productName, p.sku 
       FROM store_product_stock sps 
       LEFT JOIN products p ON sps.productId = p.id 
       WHERE sps.storeId = ? 
       ORDER BY p.name`,
      [storeId]
    );
    return res.rows._array || [];
  }
  
  // Fallback
  await ensureFallbackReady();
  const stockData = (fallbackData as any).storeStock || {};
  const products = await getProducts();
  const productMap = new Map(products.map(p => [p.id, p]));
  
  const result: any[] = [];
  for (const key in stockData) {
    if (key.startsWith(`${storeId}_`)) {
      const productId = key.substring(storeId.length + 1);
      const product = productMap.get(productId);
      result.push({
        productId,
        quantity: stockData[key],
        productName: product?.name || `Producto ${productId}`,
        sku: product?.sku || null
      });
    }
  }
  
  return result.sort((a, b) => a.productName.localeCompare(b.productName));
}

// NEW: Cancel a sale and reverse all operations
export async function cancelSale(saleId: string): Promise<boolean> {
  try {
    if (_useSqlite) {
      return new Promise((resolve, reject) => {
        try {
          if (!_db) { tryOpenSqlite(); }
          _db.transaction((tx: any) => {
            // Get sale details
            tx.executeSql(`SELECT * FROM sales WHERE id = ? LIMIT 1;`, [saleId], async (_: any, saleRes: any) => {
              const sale = saleRes.rows._array[0];
              if (!sale) {
                reject(new Error('Venta no encontrada'));
                return;
              }
              
              if (sale.status === 'cancelled') {
                reject(new Error('Esta venta ya fue cancelada'));
                return;
              }
              
              // Get sale items
              tx.executeSql(`SELECT * FROM sale_items WHERE saleId = ?;`, [saleId], (_: any, itemsRes: any) => {
                const items = itemsRes.rows._array || [];
                
                // 1. Return products to inventory (restore stock per store)
                const storeId = sale.storeId || 'store_default';
                for (const item of items) {
                  // Restore per-store stock
                  tx.executeSql(`
                    INSERT INTO store_product_stock (storeId, productId, quantity)
                    VALUES (?, ?, ?)
                    ON CONFLICT(storeId, productId) DO UPDATE SET quantity = quantity + ?
                  `, [storeId, item.productId, item.quantity, item.quantity]);
                  
                  // Legacy: also update global products.quantity
                  tx.executeSql(`UPDATE products SET quantity = quantity + ? WHERE id = ?;`, [item.quantity, item.productId]);
                  
                  // Create inventory entry as 'adjustment' (return to stock)
                  const invId = generateId('inv');
                  const now = new Date().toISOString();
                  tx.executeSql(`INSERT INTO inventory_entries (id, createdAt, type, productId, quantity, unitCost, paymentMethod, note, storeId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
                    invId,
                    now,
                    'adjustment',
                    item.productId,
                    item.quantity,
                    item.unitCost,
                    null,
                    `Cancelación de venta ${saleId}`,
                    storeId,
                  ]);
                }
                
                // 2. Remove associated expenses (commission and extra 10%)
                // Commission expense
                if (sale.commission && sale.commission > 0) {
                  tx.executeSql(`DELETE FROM expenses WHERE note LIKE ? AND amount = ?;`, [
                    `%Comisión bancaria%Venta ${saleId}%`,
                    sale.commission,
                  ]);
                }
                
                // Extra 10% expense
                // Find expenses related to this sale
                tx.executeSql(`DELETE FROM expenses WHERE note LIKE ?;`, [
                  `%Cargo 10% por venta%${saleId.substring(0, 8)}%`,
                ]);
                
                // 3. Mark sale as cancelled
                tx.executeSql(`UPDATE sales SET status = 'cancelled' WHERE id = ?;`, [saleId]);
              }, (_, err: any) => {
                reject(err);
                return false;
              });
            }, (_, err: any) => {
              reject(err);
              return false;
            });
          }, (err: any) => {
            reject(err);
          }, () => {
            DeviceEventEmitter.emit('saleCancelled', { saleId });
            resolve(true);
          });
        } catch (e) {
          reject(e);
        }
      });
    }
    
    // Fallback flow
    await ensureFallbackReady();
    const sale = fallbackData!.sales.find((s: any) => s.id === saleId);
    if (!sale) throw new Error('Venta no encontrada');
    if (sale.status === 'cancelled') throw new Error('Esta venta ya fue cancelada');
    
    const items = (fallbackData!.saleItems || []).filter((it: any) => it.saleId === saleId);
    const storeId = sale.storeId || 'store_default';
    
    // 1. Return products to inventory
    if (!(fallbackData as any).storeStock) (fallbackData as any).storeStock = {};
    for (const item of items) {
      // Restore per-store stock
      const key = `${storeId}_${item.productId}`;
      const currentStock = (fallbackData as any).storeStock[key] ?? 0;
      (fallbackData as any).storeStock[key] = currentStock + item.quantity;
      
      // Legacy: also restore global product.quantity
      const p = fallbackData!.products.find((x: any) => x.id === item.productId);
      if (p) p.quantity = (p.quantity || 0) + item.quantity;
      
      // Create inventory entry as 'adjustment'
      fallbackData!.inventoryEntries = fallbackData!.inventoryEntries || [];
      const invId = generateId('inv');
      const now = new Date().toISOString();
      fallbackData!.inventoryEntries.push({
        id: invId,
        createdAt: now,
        type: 'adjustment',
        productId: item.productId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        paymentMethod: null,
        note: `Cancelación de venta ${saleId}`,
        storeId,
      });
    }
    
    // 2. Remove associated expenses
    fallbackData!.expenses = (fallbackData!.expenses || []).filter((exp: any) => {
      const isCommission = exp.note && exp.note.includes(`Comisión bancaria`) && exp.note.includes(`Venta ${saleId}`);
      const isExtra10 = exp.note && exp.note.includes(`Cargo 10% por venta`) && exp.note.includes(saleId.substring(0, 8));
      return !(isCommission || isExtra10);
    });
    
    // 3. Mark sale as cancelled
    sale.status = 'cancelled';
    
    await persistFallback();
    DeviceEventEmitter.emit('saleCancelled', { saleId });
    
    return true;
  } catch (error) {
    console.error('Error cancelling sale:', error);
    throw error;
  }
}

// Re-export getStores from stores.ts for convenience
export async function getStores() {
  try {
    const stores = require('./stores');
    return await stores.getStores();
  } catch (e) {
    console.warn('getStores not available:', e);
    return [];
  }
}

// Reset database but preserve users and stores
export async function resetDatabaseClean(): Promise<void> {
  // Ensure DB mode is initialized before deciding which branch to use
  try { await initDb(); } catch (_) {}

  if (_useSqlite) {
    await executeSql('DELETE FROM products');
    await executeSql('DELETE FROM sales');
    await executeSql('DELETE FROM sale_items');
    await executeSql('DELETE FROM expenses');
    await executeSql('DELETE FROM cash_sessions');
    await executeSql('DELETE FROM inventory_entries');
    await executeSql('DELETE FROM store_product_stock');
    // Ensure transfer_requests table exists before attempting to clear it, and ignore errors if absent
    try { await ensureTransferRequestsTable(); await executeSql('DELETE FROM transfer_requests'); } catch (_) {}
    // Emit event so any subscribers can refresh their views
    try { DeviceEventEmitter.emit('databaseCleaned'); } catch (_) {}
  } else {
    // Fallback AsyncStorage: clear all keys except users and stores (preserve app session keys)
    const keys = await AsyncStorage.getAllKeys();
    const keysToRemove = keys.filter(k => 
      !k.startsWith('user_') && 
      k !== 'users' && 
      k !== 'stores' &&
      k !== 'working_date' &&
      k !== 'app:users' &&
      k !== 'app:stores' &&
      k !== 'app:currentUser'
    );
    if (keysToRemove.length > 0) {
      await AsyncStorage.multiRemove(keysToRemove);
    }
    
    // Also reset the in-memory fallback store so the UI reflects changes immediately
    fallbackData = { products: [], sales: [], saleItems: [], expenses: [], sessions: [], inventoryEntries: [] };
    try {
      await AsyncStorage.setItem(ASYNC_KEY, JSON.stringify(fallbackData));
    } catch (_) {}
    // Emit event so any subscribers can refresh their views
    try { DeviceEventEmitter.emit('databaseCleaned'); } catch (_) {}
  }
}

// -----------------------
// Transfer Requests Management
// -----------------------

// Add: Restore SQLite DB backup by copying into the app's SQLite directory and reinitializing
export async function restoreSqliteDatabaseBackup(fileUri: string): Promise<void> {
  if (Platform.OS === 'web') {
    throw new Error('Importar base de datos SQLite no está soportado en web. Usa un respaldo .json.');
  }
  try {
    const { Directory, File, Paths } = await import('expo-file-system');

    // Ensure SQLite directory exists (Expo stores DBs under documentDirectory/SQLite)
    const sqliteDir = new Directory(Paths.document, 'SQLite');
    sqliteDir.create({ intermediates: true, idempotent: true });

    // Destination: overwrite the app DB
    const dest = new File(sqliteDir, 'pos.db');
    dest.create({ intermediates: true, overwrite: true });

    // Source can be content:// (SAF) or file://. The new API supports reading bytes.
    const src = new File(fileUri);
    const bytes = await src.bytes();
    dest.write(bytes);

    // Force re-open DB: reset connection and run migrations
    try {
      (_db as any) = null;
    } catch {}
    await initDb();
  } catch (e) {
    console.error('restoreSqliteDatabaseBackup error', e);
    throw e;
  }
}

// Create transfer request table in SQLite (add to migrateSqlite)
async function ensureTransferRequestsTable() {
  if (!_useSqlite) return;
  try {
    await executeSql(`CREATE TABLE IF NOT EXISTS transfer_requests (
      id TEXT PRIMARY KEY,
      createdAt TEXT,
      productId TEXT,
      quantity REAL,
      fromStoreId TEXT,
      toStoreId TEXT,
      status TEXT,
      suggestedBy TEXT,
      note TEXT,
      approvedBy TEXT,
      approvedAt TEXT
    );`);
  } catch (e) {
    console.warn('Transfer requests table creation error:', e);
  }
}

// Create a transfer request
export async function createTransferRequest(req: Omit<TransferRequest, 'id' | 'createdAt'>): Promise<string> {
  await initDb();
  await ensureTransferRequestsTable();
  
  const id = generateId('trf');
  const now = new Date().toISOString();
  
  if (_useSqlite) {
    await executeSql(`INSERT INTO transfer_requests (id, createdAt, productId, quantity, fromStoreId, toStoreId, status, suggestedBy, note, approvedBy, approvedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
      id,
      now,
      req.productId,
      req.quantity,
      req.fromStoreId,
      req.toStoreId,
      req.status || 'pending',
      req.suggestedBy || 'system',
      req.note ?? null,
      req.approvedBy ?? null,
      req.approvedAt ?? null,
    ]);
    DeviceEventEmitter.emit('transferRequestCreated', { transferId: id });
    return id;
  }
  
  // Fallback
  await ensureFallbackReady();
  if (!(fallbackData as any).transferRequests) (fallbackData as any).transferRequests = [];
  (fallbackData as any).transferRequests.push({
    id,
    createdAt: now,
    productId: req.productId,
    quantity: req.quantity,
    fromStoreId: req.fromStoreId,
    toStoreId: req.toStoreId,
    status: req.status || 'pending',
    suggestedBy: req.suggestedBy || 'system',
    note: req.note ?? null,
    approvedBy: req.approvedBy ?? null,
    approvedAt: req.approvedAt ?? null,
  });
  await persistFallback();
  DeviceEventEmitter.emit('transferRequestCreated', { transferId: id });
  return id;
}

// Get all transfer requests (optionally filter by status)
export async function getTransferRequests(filter?: { status?: string }): Promise<TransferRequest[]> {
  await initDb();
  await ensureTransferRequestsTable();
  
  if (_useSqlite) {
    let sql = 'SELECT * FROM transfer_requests';
    const params: any[] = [];
    if (filter?.status) {
      sql += ' WHERE status = ?';
      params.push(filter.status);
    }
    sql += ' ORDER BY createdAt DESC;';
    const res = await executeSql(sql, params);
    return res.rows._array || [];
  }
  
  // Fallback
  await ensureFallbackReady();
  let requests = (fallbackData as any).transferRequests || [];
  if (filter?.status) {
    requests = requests.filter((r: any) => r.status === filter.status);
  }
  return requests.sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// Approve transfer request and execute transfer
export async function approveTransferRequest(transferId: string, userId: string): Promise<boolean> {
  await initDb();
  await ensureTransferRequestsTable();
  
  try {
    // Get request
    const requests = await getTransferRequests();
    const request = requests.find(r => r.id === transferId);
    if (!request) throw new Error('Solicitud de transferencia no encontrada');
    if (request.status !== 'pending') throw new Error('Esta solicitud ya fue procesada');
    
    const now = new Date().toISOString();
    
    // Execute transfer: outbound from fromStore, inbound to toStore
    // 1. Decrease stock in fromStore
    await createInventoryEntry({
      type: 'transfer_out',
      productId: request.productId,
      quantity: request.quantity,
      unitCost: 0, // not relevant for transfers
      paymentMethod: null,
      note: `Transferencia autorizada ${transferId}`,
      storeId: request.fromStoreId,
    });
    
    // 2. Increase stock in toStore
    await createInventoryEntry({
      type: 'transfer_in',
      productId: request.productId,
      quantity: request.quantity,
      unitCost: 0,
      paymentMethod: null,
      note: `Transferencia recibida ${transferId}`,
      storeId: request.toStoreId,
      targetStoreId: request.toStoreId,
    });
    
    // 3. Update request status
    if (_useSqlite) {
      await executeSql(`UPDATE transfer_requests SET status = ?, approvedBy = ?, approvedAt = ? WHERE id = ?;`, [
        'approved',
        userId,
        now,
        transferId,
      ]);
    } else {
      await ensureFallbackReady();
      if ((fallbackData as any).transferRequests) {
        const req = (fallbackData as any).transferRequests.find((r: any) => r.id === transferId);
        if (req) {
          req.status = 'approved';
          req.approvedBy = userId;
          req.approvedAt = now;
        }
      }
      await persistFallback();
    }
    
    DeviceEventEmitter.emit('transferRequestApproved', { transferId });
    return true;
  } catch (error) {
    console.error('Error approving transfer:', error);
    throw error;
  }
}

// Reject transfer request
export async function rejectTransferRequest(transferId: string, userId: string): Promise<boolean> {
  await initDb();
  await ensureTransferRequestsTable();
  
  try {
    const now = new Date().toISOString();
    
    if (_useSqlite) {
      await executeSql(`UPDATE transfer_requests SET status = ?, approvedBy = ?, approvedAt = ? WHERE id = ?;`, [
        'rejected',
        userId,
        now,
        transferId,
      ]);
    } else {
      await ensureFallbackReady();
      if ((fallbackData as any).transferRequests) {
        const req = (fallbackData as any).transferRequests.find((r: any) => r.id === transferId);
        if (req) {
          req.status = 'rejected';
          req.approvedBy = userId;
          req.approvedAt = now;
        }
      }
      await persistFallback();
    }
    
    DeviceEventEmitter.emit('transferRequestRejected', { transferId });
    return true;
  } catch (error) {
    console.error('Error rejecting transfer:', error);
    throw error;
  }
}

// Generate automatic transfer suggestions based on stock levels
export async function generateTransferSuggestions(): Promise<number> {
  await initDb();
  await ensureTransferRequestsTable();
  
  const products = await getProducts();
  const stores = await getStores();
  
  if (stores.length < 2) {
    return 0; // No transfers needed with only one store
  }
  
  let suggestionsCount = 0;
  
  for (const product of products) {
    const minStock = product.minStock || 5; // Default minimum stock
    const stockByStore: Array<{ storeId: string; storeName: string; quantity: number }> = [];
    
    // Get stock for each store
    for (const store of stores.filter(s => s.active)) {
      const qty = await getProductStockInStore(product.id, store.id);
      stockByStore.push({ storeId: store.id, storeName: store.name, quantity: qty });
    }
    
    // Find stores with low stock (including 0 = missing product) and stores with surplus
    const lowStockStores = stockByStore.filter(s => s.quantity < minStock); // This includes stores with 0 stock
    const surplusStores = stockByStore.filter(s => s.quantity > minStock * 2); // surplus = more than 2x minimum
    
    // Create transfer requests from surplus to low stock stores (including missing products)
    for (const lowStore of lowStockStores) {
      for (const surplusStore of surplusStores) {
        const needed = minStock - lowStore.quantity; // For missing products (qty=0), needed = minStock
        const available = surplusStore.quantity - minStock;
        const transferQty = Math.min(needed, available);
        
        if (transferQty > 0) {
          // Check if a similar pending request already exists
          const existingRequests = await getTransferRequests({ status: 'pending' });
          const duplicate = existingRequests.find(r => 
            r.productId === product.id &&
            r.fromStoreId === surplusStore.storeId &&
            r.toStoreId === lowStore.storeId
          );
          
          if (!duplicate) {
            await createTransferRequest({
              productId: product.id,
              quantity: transferQty,
              fromStoreId: surplusStore.storeId,
              toStoreId: lowStore.storeId,
              status: 'pending',
              suggestedBy: 'system',
              note: `${product.name}: ${surplusStore.storeName} (${surplusStore.quantity}) → ${lowStore.storeName} (${lowStore.quantity})`,
            });
            suggestionsCount++;
          }
        }
      }
    }
  }
  
  return suggestionsCount;
}

// Helper: Generate transfer suggestions for a single product
async function generateTransferSuggestionsForProduct(productId: string): Promise<number> {
  await initDb();
  await ensureTransferRequestsTable();
  
  const product = await getProductById(productId);
  if (!product) return 0;
  
  const stores = await getStores();
  if (stores.length < 2) return 0;
  
  const minStock = product.minStock || 5;
  const stockByStore: Array<{ storeId: string; storeName: string; quantity: number }> = [];
  
  // Get stock for each store
  for (const store of stores.filter(s => s.active)) {
    const qty = await getProductStockInStore(product.id, store.id);
    stockByStore.push({ storeId: store.id, storeName: store.name, quantity: qty });
  }
  
  // Find stores with low stock and stores with surplus
  const lowStockStores = stockByStore.filter(s => s.quantity < minStock);
  const surplusStores = stockByStore.filter(s => s.quantity > minStock * 2);
  
  let suggestionsCount = 0;
  
  // Create transfer requests from surplus to low stock stores
  for (const lowStore of lowStockStores) {
    for (const surplusStore of surplusStores) {
      const needed = minStock - lowStore.quantity;
      const available = surplusStore.quantity - minStock;
      const transferQty = Math.min(needed, available);
      
      if (transferQty > 0) {
        // Check if a similar pending request already exists
        const existingRequests = await getTransferRequests({ status: 'pending' });
        const duplicate = existingRequests.find(r => 
          r.productId === product.id &&
          r.fromStoreId === surplusStore.storeId &&
          r.toStoreId === lowStore.storeId
        );
        
        if (!duplicate) {
          await createTransferRequest({
            productId: product.id,
            quantity: transferQty,
            fromStoreId: surplusStore.storeId,
            toStoreId: lowStore.storeId,
            status: 'pending',
            suggestedBy: 'system',
            note: `Auto: ${product.name}: ${surplusStore.storeName} (${surplusStore.quantity}) → ${lowStore.storeName} (${lowStore.quantity})`,
          });
          suggestionsCount++;
        }
      }
    }
  }
  
  return suggestionsCount;
}

// -----------------------
// Initial Product Load Tracking (One-time per user per date)
// -----------------------

// Check if user has already done initial product load for a given business date
export async function hasUserCompletedInitialLoad(userId: string, businessDate: string): Promise<boolean> {
  await initDb();
  if (_useSqlite) {
    try {
      const res = await executeSql(`SELECT COUNT(*) as cnt FROM user_initial_load_history WHERE userId = ? AND businessDate = ?;`, [userId, businessDate]);
      return (res.rows._array[0]?.cnt ?? 0) > 0;
    } catch (e) {
      console.warn('Error checking initial load status:', e);
      return false;
    }
  }
  
  // Fallback
  await ensureFallbackReady();
  const history = (fallbackData as any).userInitialLoadHistory || [];
  return history.some((h: any) => h.userId === userId && h.businessDate === businessDate);
}

// Record user's initial product load
export async function recordUserInitialLoad(userId: string, businessDate: string, productsLoaded: number, totalImporte: number, classifiedCodes: string[]): Promise<string> {
  await initDb();
  const id = generateId('init');
  const now = new Date().toISOString();
  const codesJson = JSON.stringify(classifiedCodes);
  
  if (_useSqlite) {
    try {
      await executeSql(`INSERT INTO user_initial_load_history (id, userId, businessDate, productsLoaded, totalImporte, classifiedCodes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?);`, [
        id,
        userId,
        businessDate,
        productsLoaded,
        totalImporte,
        codesJson,
        now,
      ]);
    } catch (e) {
      console.warn('Error recording initial load:', e);
    }
    return id;
  }
  
  // Fallback
  await ensureFallbackReady();
  if (!(fallbackData as any).userInitialLoadHistory) (fallbackData as any).userInitialLoadHistory = [];
  (fallbackData as any).userInitialLoadHistory.push({
    id,
    userId,
    businessDate,
    productsLoaded,
    totalImporte,
    classifiedCodes,
    createdAt: now,
  });
  await persistFallback();
  return id;
}

// Re-export closeDay from localDb for compatibility
export { closeDay } from './localDb';