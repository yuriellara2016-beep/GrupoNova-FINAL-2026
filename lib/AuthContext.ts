// AuthContext.ts - Manages business date, day/turn status across the app
import React, { createContext, useState, useCallback, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getBusinessDate, isDayClosed, getLastClosedDate } from './localDb';

// Context type definition
interface AuthContextType {
  businessDate: string | null;
  setBusinessDate: (date: string) => Promise<void>;
  isClosed: boolean;
  closedDate: string | null;
  refreshDayStatus: () => Promise<void>;
}

// Create context
const AuthContext = createContext<AuthContextType | undefined>(undefined);

// AuthProvider component
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [businessDate, setBusinessDateState] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [closedDate, setClosedDate] = useState<string | null>(null);

  const refreshDayStatus = useCallback(async () => {
    try {
      const date = await getBusinessDate();
      setBusinessDateState(date);
      
      const closed = await isDayClosed();
      setIsClosed(closed);
      
      if (closed) {
        const lastClosed = await getLastClosedDate();
        setClosedDate(lastClosed);
      } else {
        setClosedDate(null);
      }
    } catch (e) {
      console.warn('Error refreshing day status:', e);
    }
  }, []);

  const setBusinessDate = useCallback(
    async (date: string) => {
      try {
        setBusinessDateState(date);
        await AsyncStorage.setItem('working_date', date);
        
        const settings = {
          businessDate: date,
          isDayStarted: true,
          isClosed: false,
          closedDate: null,
        };
        await AsyncStorage.setItem('db_settings', JSON.stringify(settings));
        await refreshDayStatus();
      } catch (e) {
        console.warn('Error setting business date:', e);
        throw e;
      }
    },
    [refreshDayStatus]
  );

  useEffect(() => {
    refreshDayStatus();
  }, [refreshDayStatus]);

  const contextValue: AuthContextType = {
    businessDate,
    setBusinessDate,
    isClosed,
    closedDate,
    refreshDayStatus,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

// useAuthSafe hook with fallback
export function useAuthSafe(): AuthContextType {
  const context = useContext(AuthContext);
  
  if (!context) {
    return {
      businessDate: null,
      setBusinessDate: async () => {
        console.warn('AuthContext not available');
      },
      isClosed: false,
      closedDate: null,
      refreshDayStatus: async () => {
        console.warn('AuthContext not available');
      },
    };
  }
  
  return context;
}