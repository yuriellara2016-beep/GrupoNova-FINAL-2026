import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Store, User } from '../types';
import { useAuthSafe } from '../hooks/useAuth';

const STORE_KEY = 'pos_current_store_v1';

type StoreContextValue = {
  currentStoreId: string | null;
  setCurrentStoreId: (id: string | null) => void;
  currentStore: Store | null;
  isAdmin: boolean;
  stores: Store[];
  setStores: (s: Store[]) => void;
  isAdminForUser: (user?: User | null) => boolean;
};

const StoreContext = createContext<StoreContextValue | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuthSafe();

  // Device-level preference (only meaningful for admins)
  const [storedPreferenceId, setStoredPreferenceId] = useState<string | null>(null);
  const [storePreferenceLoaded, setStorePreferenceLoaded] = useState(false);
  const [hasStoredStorePreference, setHasStoredStorePreference] = useState(false);

  // Stores list comes from the real Auth provider (hooks/useAuth)
  const [stores, setStores] = useState<Store[]>(auth.stores || []);

  useEffect(() => {
    setStores(auth.stores || []);
  }, [auth.stores]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        setHasStoredStorePreference(raw !== null);
        if (raw !== null) {
          setStoredPreferenceId(raw === 'null' ? null : raw);
        }
      } catch {
        // ignore
      } finally {
        setStorePreferenceLoaded(true);
      }
    })();
  }, []);

  const isAdminForUser = (user?: User | null) => {
    if (!user) return false;
    return user.role === 'admin' || !user.storeId;
  };

  const isAdmin = !!(auth.user && (auth.user.role === 'admin' || !auth.user.storeId));

  const setCurrentStoreId = async (id: string | null) => {
    // IMPORTANT: For sellers, the store comes from user.storeId.
    // We must NOT persist/override the device preference (admin might also use same phone).
    if (auth.user?.storeId) {
      return;
    }

    setStoredPreferenceId(id);
    try {
      await AsyncStorage.setItem(STORE_KEY, id === null ? 'null' : id);
    } catch {
      // ignore
    }
  };

  // Auto-pick a store for admins on first run so UI doesn't show "Sin asignar".
  useEffect(() => {
    if (!storePreferenceLoaded) return;
    if (!isAdmin) return;
    if (auth.user?.storeId) return; // sellers already have an assigned store
    if (hasStoredStorePreference) return; // respect explicit preference (even null)
    if (storedPreferenceId) return;

    const firstActiveStore = (stores || []).find((s) => s.active) || (stores || [])[0];
    if (firstActiveStore) {
      setStoredPreferenceId(firstActiveStore.id);
      AsyncStorage.setItem(STORE_KEY, firstActiveStore.id).catch(() => {});
    }
  }, [storePreferenceLoaded, isAdmin, auth.user?.storeId, hasStoredStorePreference, storedPreferenceId, stores]);

  // Safety: if stored preference points to a deleted store, pick a valid one.
  useEffect(() => {
    if (!storePreferenceLoaded) return;
    if (!isAdmin) return;
    if (!storedPreferenceId) return;
    if ((stores || []).some((s) => s.id === storedPreferenceId)) return;

    const firstActiveStore = (stores || []).find((s) => s.active) || (stores || [])[0];
    if (firstActiveStore) {
      setStoredPreferenceId(firstActiveStore.id);
      AsyncStorage.setItem(STORE_KEY, firstActiveStore.id).catch(() => {});
    }
  }, [storePreferenceLoaded, isAdmin, storedPreferenceId, stores]);

  // Determine current store:
  // - Sellers: ALWAYS user.storeId
  // - Admins: storedPreferenceId
  const effectiveStoreId = auth.user?.storeId ?? storedPreferenceId ?? null;
  const currentStore = effectiveStoreId ? stores.find((s) => s.id === effectiveStoreId) || null : null;

  return React.createElement(StoreContext.Provider, {
    value: {
      currentStoreId: effectiveStoreId,
      setCurrentStoreId,
      currentStore,
      isAdmin,
      stores,
      setStores,
      isAdminForUser,
    },
    children,
  });
};

export function useStore(): StoreContextValue {
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
  const fallbackCurrentStore = fallbackStoreId ? fallbackStores.find((s) => s.id === fallbackStoreId) || null : null;

  return {
    currentStoreId: fallbackStoreId,
    setCurrentStoreId: () => {},
    currentStore: fallbackCurrentStore,
    isAdmin,
    stores: fallbackStores,
    setStores: () => {},
    isAdminForUser,
  };
}