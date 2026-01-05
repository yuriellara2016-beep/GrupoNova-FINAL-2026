import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from 'react-native';
import { THEME, SPACING } from '../lib/theme';
import { useAuthSafe } from '../hooks/useAuth';
import { useAuthSafe as useLibAuthSafe } from '../lib/AuthContext';
import { isoToDate, pad } from '../lib/date';
import { Ionicons } from '@expo/vector-icons';

interface DayStatusBannerProps {
  showLogoutButton?: boolean;
}

export default function DayStatusBanner({ showLogoutButton = false }: DayStatusBannerProps) {
  const { user, logout, businessDate: appBusinessDate } = useAuthSafe();
  const { businessDate: libBusinessDate, refreshDayStatus } = useLibAuthSafe();
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    refreshDayStatus().catch(() => {});
  }, [refreshDayStatus]);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = async () => {
    // En web los botones de Alert pueden no ser interactivos; ejecutar directo
    if (Platform.OS === 'web') {
      try { await logout(); } catch { Alert.alert('Error', 'No se pudo cerrar la sesión'); }
      return;
    }
    Alert.alert(
      'Cerrar Sesión',
      `¿Estás seguro de que deseas cerrar sesión, ${user?.name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Sesión',
          onPress: async () => {
            try {
              await logout();
            } catch (e) {
              Alert.alert('Error', 'No se pudo cerrar la sesión');
            }
          },
          style: 'destructive',
        },
      ]
    );
  };

  // Fuente única: usar fecha de trabajo del AuthProvider principal.
  // Fallback a lib/AuthContext solo por compatibilidad (pantallas legacy).
  const sourceBusinessDate = appBusinessDate || libBusinessDate;

  // Display the business date from context; do not fallback to device date (dd-mm-yyyy)
  const displayDate = sourceBusinessDate
    ? (() => {
        const d = isoToDate(sourceBusinessDate);
        return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
      })()
    : '';

  return (
    <View style={styles.banner}>
      <View style={styles.dateTimeContainer}>
        <View style={styles.inlineRow}>
          <Ionicons name="calendar-outline" size={16} color={THEME.colors.text} />
          <Text style={styles.dateLabel}>{displayDate}</Text>
        </View>
        <View style={[styles.inlineRow, { marginTop: 2 }] }>
          <Ionicons name="time-outline" size={16} color={THEME.colors.textSecondary} />
          <Text style={styles.timeLabel}>{currentTime}</Text>
        </View>
      </View>
      {showLogoutButton && (
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutBtnText}>🚪 Cerrar</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.small,
    borderBottomWidth: 2,
    borderBottomColor: THEME.colors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateTimeContainer: {
    flex: 1,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: THEME.colors.text,
    marginLeft: 6,
  },
  timeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginLeft: 6,
  },
  logoutBtn: {
    backgroundColor: THEME.colors.error,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: THEME.radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 90,
  },
  logoutBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});