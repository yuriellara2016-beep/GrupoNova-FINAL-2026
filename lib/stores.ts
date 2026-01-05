import AsyncStorage from '@react-native-async-storage/async-storage';
import { Store } from '../types';
import { generateId } from './id';

const STORES_KEY = 'app:stores';

// Default stores for initial setup
const DEFAULT_STORES: Store[] = [
  { id: 'store-1', name: 'Tienda Principal', active: true, createdAt: new Date().toISOString() },
];

// Get all stores
export async function getStores(): Promise<Store[]> {
  try {
    const raw = await AsyncStorage.getItem(STORES_KEY);
    if (!raw) {
      await AsyncStorage.setItem(STORES_KEY, JSON.stringify(DEFAULT_STORES));
      return DEFAULT_STORES;
    }
    const stores: Store[] = JSON.parse(raw);
    return stores.map(s => ({
      id: s.id,
      name: s.name,
      active: typeof s.active === 'boolean' ? s.active : true,
      createdAt: s.createdAt || new Date().toISOString(),
    }));
  } catch (error) {
    console.error('Error loading stores:', error);
    return DEFAULT_STORES;
  }
}

// Create a new store
export async function createStore(name: string): Promise<Store | null> {
  try {
    const stores = await getStores();
    const newStore: Store = {
      id: generateId('store'),
      name: name.trim(),
      active: true,
      createdAt: new Date().toISOString(),
    };
    const updated = [...stores, newStore];
    await AsyncStorage.setItem(STORES_KEY, JSON.stringify(updated));
    return newStore;
  } catch (error) {
    console.error('Error creating store:', error);
    return null;
  }
}

// Update store
export async function updateStore(storeId: string, fields: Partial<Store>): Promise<boolean> {
  try {
    const stores = await getStores();
    const updated = stores.map(s => s.id === storeId ? { ...s, ...fields } : s);
    await AsyncStorage.setItem(STORES_KEY, JSON.stringify(updated));
    return true;
  } catch (error) {
    console.error('Error updating store:', error);
    return false;
  }
}

// Delete store
export async function deleteStore(storeId: string): Promise<boolean> {
  try {
    const stores = await getStores();
    const updated = stores.filter(s => s.id !== storeId);
    await AsyncStorage.setItem(STORES_KEY, JSON.stringify(updated));
    return true;
  } catch (error) {
    console.error('Error deleting store:', error);
    return false;
  }
}

// Toggle store active status
export async function toggleStoreActive(storeId: string, active: boolean): Promise<boolean> {
  try {
    const stores = await getStores();
    const updated = stores.map(s => s.id === storeId ? { ...s, active } : s);
    await AsyncStorage.setItem(STORES_KEY, JSON.stringify(updated));
    return true;
  } catch (error) {
    console.error('Error toggling store active:', error);
    return false;
  }
}