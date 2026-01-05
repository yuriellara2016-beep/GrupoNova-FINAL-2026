import React, { createContext, useContext, useState, useEffect } from 'react';
import { Store, User } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthSafe } from '../hooks/useAuth';

const STORE_KEY = 'pos_current_store_v1';

type StoreContextValue = {
  currentStoreId: string | null;
  setCurrentStoreId: (id: string | null) => void;
  currentStore: Store | null;
  // convenience boolean for the current user
  isAdmin: boolean;
  // stores list for UI and helper to update it locally
  stores: Store[];
  setStores: (s: Store[]) => void;
  isAdminForUser: (user?: User | null) => boolean;
};

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentStoreId, setCurrentStoreIdState] = useState<string | null>(null);
  const auth = useAuthSafe();
  const [stores, setStores] = useState<Store[]>(auth.stores || []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) setCurrentStoreIdState(raw === 'null' ? null : raw);
      } catch (e) {}
    })();
  }, []);

  // Keep local stores in sync with auth stores when auth updates
  useEffect(() => {
    setStores(auth.stores || []);
  }, [auth.stores]);

  const setCurrentStoreId = async (id: string | null) => {
    setCurrentStoreIdState(id);
    try { await AsyncStorage.setItem(STORE_KEY, id === null ? 'null' : id); } catch (e) {}
  };

  const isAdminForUser = (user?: User | null) => {
    if (!user) return false;
    return user.role === 'admin' || !user.storeId;
  };

  const isAdmin = !!(auth.user && (auth.user.role === 'admin' || !auth.user.storeId));
  
  // Determine current store: use currentStoreId if set, otherwise use user's assigned store
  const effectiveStoreId = currentStoreId || auth.user?.storeId || null;
  const currentStore = effectiveStoreId ? stores.find(s => s.id === effectiveStoreId) || null : null;

  // Use React.createElement instead of JSX so this file can keep the .ts extension
  // This avoids the need to rename to .tsx in environments where JSX in .ts files causes a syntax error.
  return React.createElement(StoreContext.Provider, { value: { currentStoreId: effectiveStoreId, setCurrentStoreId, currentStore, isAdmin, stores, setStores, isAdminForUser } }, children);
};

export function useStore(): StoreContextValue {
  // Provide a safe, non-throwing fallback (like useAuthSafe) so UI never crashes if provider order is inconsistent.
  const auth = useAuthSafe();
  const ctx = useContext(StoreContext);
  if (ctx) return ctx;

  const isAdminForUser = (user?: User | null) => {
    if (!user) return false;
    return user.role === 'admin' || !user.storeId;
  };
  const isAdmin = !!(auth.user && (auth.user.role === 'admin' || !auth.user.storeId));
  const fallbackStores = auth.stores || [];
  const fallbackStoreId = auth.user?.storeId || null;
  const fallbackCurrentStore = fallbackStoreId ? fallbackStores.find(s => s.id === fallbackStoreId) || null : null;

  // No-ops for setters when provider isn't mounted yet
  const noopSetCurrentStoreId = (_: string | null) => {};
  const noopSetStores = (_: Store[]) => {};

  return {
    currentStoreId: fallbackStoreId,
    setCurrentStoreId: noopSetCurrentStoreId,
    currentStore: fallbackCurrentStore,
    isAdmin,
    stores: fallbackStores,
    setStores: noopSetStores,
    isAdminForUser,
  };
}