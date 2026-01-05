import AsyncStorage from '@react-native-async-storage/async-storage';

export type ClassifiedProduct = {
  id: string;
  code: string;
  description: string;
  unit: string;
  createdAt: string;
};

/**
 * Load all classified products from AsyncStorage
 */
export async function getClassifiedProducts(): Promise<ClassifiedProduct[]> {
  try {
    const stored = await AsyncStorage.getItem('classified_products');
    if (stored) {
      return JSON.parse(stored);
    }
    return [];
  } catch (err) {
    console.warn('Error loading classified products:', err);
    return [];
  }
}

/** Save full list back to storage */
export async function setClassifiedProducts(list: ClassifiedProduct[]): Promise<void> {
  try {
    await AsyncStorage.setItem('classified_products', JSON.stringify(list));
  } catch (err) {
    console.warn('Error saving classified products:', err);
  }
}

/** Upsert many products by code (id preserved if incoming has it) */
export async function upsertManyClassifiedProducts(items: Array<Pick<ClassifiedProduct, 'code' | 'description' | 'unit'> & Partial<Pick<ClassifiedProduct, 'id' | 'createdAt'>>>): Promise<void> {
  const existing = await getClassifiedProducts();
  const map = new Map(existing.map(p => [p.code.toUpperCase(), p]));
  const now = new Date().toISOString();
  for (const it of items) {
    const code = it.code.trim().toUpperCase();
    if (!code) continue;
    const prev = map.get(code);
    if (prev) {
      map.set(code, { ...prev, description: it.description.trim(), unit: it.unit, createdAt: prev.createdAt });
    } else {
      map.set(code, {
        id: it.id || `prod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        code,
        description: it.description.trim(),
        unit: it.unit,
        createdAt: it.createdAt || now,
      });
    }
  }
  await setClassifiedProducts(Array.from(map.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

/**
 * Search for a product by code (exact match, case-insensitive)
 * Returns the first matching product or undefined
 */
export async function findProductByCode(code: string): Promise<ClassifiedProduct | undefined> {
  try {
    const products = await getClassifiedProducts();
    return products.find(p => p.code.toUpperCase() === code.toUpperCase());
  } catch (err) {
    console.warn('Error finding product by code:', err);
    return undefined;
  }
}

/**
 * Search for products that match a query (code or description)
 * Used for autocomplete/suggestions
 */
export async function searchProducts(query: string): Promise<ClassifiedProduct[]> {
  try {
    if (!query.trim()) return [];
    
    const products = await getClassifiedProducts();
    const q = query.toUpperCase();
    
    return products.filter(p =>
      p.code.toUpperCase().includes(q) ||
      p.description.toUpperCase().includes(q)
    );
  } catch (err) {
    console.warn('Error searching products:', err);
    return [];
  }
}

/**
 * Get all unique measurement units from classified products
 */
export async function getAvailableUnits(): Promise<string[]> {
  try {
    const products = await getClassifiedProducts();
    const units = new Set(products.map(p => p.unit));
    return Array.from(units).sort();
  } catch (err) {
    console.warn('Error getting units:', err);
    return [];
  }
}

// -------------------- Convex Sync (via HTTP) --------------------
// We expose simple helpers to pull/push the classifier to the backend without
// introducing new dependencies. These hit convex/http.ts endpoints if present.

const CONVEX_BASE = typeof process !== 'undefined' && (process as any).env?.CONVEX_SITE_URL
  ? (process as any).env.CONVEX_SITE_URL
  : '';

/** Pull latest classified products from Convex and merge locally */
export async function pullClassifiedFromConvex(): Promise<{ pulled: number } | null> {
  try {
    if (!CONVEX_BASE) return null; // backend URL not configured
    const res = await fetch(`${CONVEX_BASE}/classified/sync`, { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json();
    const items = Array.isArray(data) ? data : [];
    if (items.length > 0) {
      await upsertManyClassifiedProducts(items.map((it: any) => ({
        id: it._id || it.id,
        code: String(it.code || ''),
        description: String(it.description || ''),
        unit: String(it.unit || 'Unidad'),
        createdAt: new Date(it._creationTime || Date.now()).toISOString(),
      })));
    }
    return { pulled: items.length };
  } catch (err) {
    console.warn('Convex pull failed:', err);
    return null;
  }
}

/** Push local classifier to Convex (idempotent by code) */
export async function pushClassifiedToConvex(): Promise<{ pushed: number } | null> {
  try {
    if (!CONVEX_BASE) return null;
    const items = await getClassifiedProducts();
    const res = await fetch(`${CONVEX_BASE}/classified/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) return null;
    const out = await res.json();
    return { pushed: Number(out?.pushed || 0) };
  } catch (err) {
    console.warn('Convex push failed:', err);
    return null;
  }
}

// -------------------- Usage Counters for Reports --------------------
// We keep a lightweight counter of how many times a classified product code
// is used in inventory entries to power reports, without altering DB internals.

const USAGE_KEY = 'classified_usage_counts';

export type UsageCounts = Record<string, number>; // code -> count

export async function getUsageCounts(): Promise<UsageCounts> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function incrementUsageCount(code: string, amount = 1): Promise<void> {
  const counts = await getUsageCounts();
  const key = code.trim().toUpperCase();
  if (!key) return;
  counts[key] = (counts[key] || 0) + amount;
  await AsyncStorage.setItem(USAGE_KEY, JSON.stringify(counts));
}