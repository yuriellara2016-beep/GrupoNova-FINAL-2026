import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetDatabase } from './db';

const APP_USER_KEY = 'app:currentUser';
const APP_USERS_KEY = 'app:users';

// Resets all app data:
// - Clears persisted users and current session
// - Clears Products, Sales, Sale Items, Expenses, Sessions, Inventory entries
// This should be used only in development or by a protected admin-only action.
export async function resetAllData(): Promise<{ ok: boolean; error?: string }> {
  try {
    // Clear auth/session data
    await AsyncStorage.removeItem(APP_USER_KEY);
    // Reset users by removing the key entirely so the app repopulates defaults on next boot
    await AsyncStorage.removeItem(APP_USERS_KEY);

    // Clear business data (products, sales, etc.)
    await resetDatabase();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// Safe reset that validates admin credentials before wiping data.
// This is intended for production "factory reset" flows.
export async function resetAllDataSafe(adminId: string, adminPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const usersRaw = await AsyncStorage.getItem(APP_USERS_KEY);
    const usersList: Array<{ id: string; role: 'admin' | 'seller'; active: boolean; password?: string }> = usersRaw ? JSON.parse(usersRaw) : [];
    const adminUser = usersList.find(u => u.id === adminId);
    if (!adminUser) {
      return { ok: false, error: 'Admin no encontrado' };
    }
    if (adminUser.role !== 'admin' || !adminUser.active) {
      return { ok: false, error: 'Permiso denegado' };
    }
    const storedPassword = adminUser.password || '';
    if (!adminPassword || adminPassword !== storedPassword) {
      return { ok: false, error: 'Contraseña incorrecta' };
    }
    // Perform reset
    const res = await resetAllData();
    return res;
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}