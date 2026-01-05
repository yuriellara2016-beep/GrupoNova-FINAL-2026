import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as localDb from './localDb';
import { DeviceEventEmitter } from 'react-native';
import { openDay as openLedgerDay } from './dayManager';

interface User {
  _id: string;
  email: string;
  name: string;
  role: 'admin' | 'seller';
  storeId?: string;
}

interface AuthContextType {
  user: User | null;
  businessDate: string | null;
  isDayStarted: boolean;
  isClosed: boolean;
  closedDate: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  setBusinessDate: (date: string) => Promise<void>;
  refreshDayStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [businessDate, setBusinessDateState] = useState<string | null>(null);
  const [isDayStarted, setIsDayStarted] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [closedDate, setClosedDate] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // Initialize database on mount with timeout protection
    (async () => {
      try {
        console.log('[LibAuthProvider] Starting initialization...');
        
        // Set a safety timeout to ensure initialization completes
        const timeoutId = setTimeout(() => {
          console.warn('Database initialization timeout - forcing completion');
          if (isMounted) {
            setIsInitializing(false);
          }
        }, 8000); // 8 seconds max for DB init

        try {
          await localDb.initializeDatabase();
          console.log('[LibAuthProvider] Database initialized successfully');
        } catch (error) {
          console.error('localDb.initializeDatabase error:', error);
          // Continue even if DB init fails - app will work with empty data
        }

        try {
          if (isMounted) {
            await refreshDayStatus();
            console.log('[LibAuthProvider] Day status refreshed');
          }
        } catch (error) {
          console.error('refreshDayStatus error:', error);
          // Continue even if refresh fails
        }

        clearTimeout(timeoutId);
        console.log('[LibAuthProvider] Initialization complete');
      } catch (error) {
        console.error('AuthProvider initialization error:', error);
      } finally {
        if (isMounted) {
          setIsInitializing(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshDayStatus = async () => {
    const started = await localDb.isDayStarted();
    const date = await localDb.getBusinessDate();
    const closed = await localDb.isDayClosed();
    const lastClosed = await localDb.getLastClosedDate();
    
    setIsDayStarted(started);
    setBusinessDateState(date);
    setIsClosed(closed);
    setClosedDate(lastClosed);

    // Notify listeners that day status might have changed
    try { DeviceEventEmitter.emit('dayStatusChanged', { started, date, closed, lastClosed }); } catch (_) {}
  };

  const login = async (email: string, password: string): Promise<boolean> => {
    const foundUser = await localDb.loginUser(email, password);
    if (foundUser) {
      setUser({
        _id: foundUser._id,
        email: foundUser.email,
        name: foundUser.name,
        role: foundUser.role,
        storeId: foundUser.storeId,
      });
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    setBusinessDateState(null);
    setIsDayStarted(false);
  };

  const setBusinessDate = async (date: string) => {
    await localDb.startDay(date);
    // Reset closed day status when starting a new day
    await localDb.setDayNotClosed();
    // Also open the day in the ledger so close-day snapshot works (IDs will be appended during ops)
    try { await openLedgerDay(date, user?._id); } catch (_) {}
    // Broadcast status change for UI that depends on it
    try { DeviceEventEmitter.emit('dayStatusChanged', { started: true, date, closed: false }); } catch (_) {}
    await refreshDayStatus();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        businessDate,
        isDayStarted,
        isClosed,
        closedDate,
        login,
        logout,
        setBusinessDate,
        refreshDayStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function useAuthSafe() {
  const context = useContext(AuthContext);
  if (context) return context;
  // Fallback that keeps app running but indicates no session
  return {
    user: null,
    businessDate: null,
    isDayStarted: false,
    isClosed: false,
    closedDate: null,
    login: async () => false,
    logout: () => {},
    setBusinessDate: async () => {},
    refreshDayStatus: async () => {},
  };
}