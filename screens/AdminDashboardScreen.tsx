import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthSafe } from '../lib/AuthContext';
import * as localDb from '../lib/localDb';
import { COLORS, SPACING, TYPOGRAPHY } from '../lib/theme';
import { dateToDisplay } from '../lib/date';
import { closeDay as closeLedgerDay } from '../lib/dayManager';

export default function AdminDashboardScreen() {
  const { user, businessDate, logout, refreshDayStatus, isClosed, closedDate } = useAuthSafe();
  const [sales, setSales] = useState<localDb.Sale[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSales();
  }, []);

  const loadSales = async () => {
    const allSales = await localDb.getAllSales();
    setSales(allSales);
  };

  const doCloseFlow = async () => {
    setLoading(true);
    try {
      // Mark day as closed across local settings and day ledger
      await localDb.closeDay();
      try { await closeLedgerDay(user?._id); } catch (_) {}
      await refreshDayStatus();
      Alert.alert('Éxito', 'Día cerrado correctamente');
      logout();
    } catch (error) {
      Alert.alert('Error', 'Error al cerrar el día');
    } finally {
      setLoading(false);
    }
  };

  const handleCloseDay = async () => {
    // On web, Alert buttons can be non-interactive; proceed immediately
    if (Platform.OS === 'web') {
      await doCloseFlow();
      return;
    }
    Alert.alert(
      'Cerrar Día',
      '¿Estás seguro de que deseas cerrar el día? Esto marcará todas las ventas como cerradas y reiniciará la sesión.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar Día',
          style: 'destructive',
          onPress: doCloseFlow,
        },
      ]
    );
  };

  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
  const todaySales = sales.filter((s) => s.businessDate === businessDate);
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0);

  // Filtrar métodos de pago solo por fecha de trabajo (businessDate)
  const salesByPaymentMethod = {
    cash: todaySales.filter((s) => s.paymentMethod === 'cash').reduce((sum, s) => sum + s.total, 0),
    card: todaySales.filter((s) => s.paymentMethod === 'card').reduce((sum, s) => sum + s.total, 0),
    transfer: todaySales.filter((s) => s.paymentMethod === 'transfer').reduce((sum, s) => sum + s.total, 0),
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View>
            <Text style={styles.title}>Dashboard Admin</Text>
            <Text style={styles.subtitle}>{user?.name}</Text>
            <Text style={styles.dateText}>Fecha: {businessDate ? dateToDisplay(new Date(`${businessDate}T00:00:00`)) : 'No iniciado'}</Text>
            {/* Show indicator if day is closed */}
            <Text style={[styles.dateText, { color: COLORS.error, marginTop: SPACING.xs }]}>
              {businessDate ? '✓ Día en curso' : (closedDate ? `📊 Último cierre: ${dateToDisplay(new Date(`${closedDate}T00:00:00`))}` : '')}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.closeDayButton}
            onPress={handleCloseDay}
            disabled={loading}
          >
            <Ionicons name="moon" size={20} color="#fff" />
            <Text style={styles.closeDayText}>Cerrar Día</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{todaySales.length}</Text>
            <Text style={styles.statLabel}>Ventas Hoy</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>${todayTotal.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total Hoy</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{sales.length}</Text>
            <Text style={styles.statLabel}>Total Ventas</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>${totalSales.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Total General</Text>
          </View>
        </View>

        <View style={styles.paymentMethodsRow}>
          <View style={styles.paymentCard}>
            <Ionicons name="cash" size={24} color={COLORS.success} />
            <Text style={styles.paymentLabel}>Efectivo</Text>
            <Text style={styles.paymentValue}>${salesByPaymentMethod.cash.toFixed(2)}</Text>
          </View>
          <View style={styles.paymentCard}>
            <Ionicons name="card" size={24} color={COLORS.primary} />
            <Text style={styles.paymentLabel}>Tarjeta</Text>
            <Text style={styles.paymentValue}>${salesByPaymentMethod.card.toFixed(2)}</Text>
          </View>
          <View style={styles.paymentCard}>
            <Ionicons name="phone-portrait" size={24} color={COLORS.warning} />
            <Text style={styles.paymentLabel}>Transferencia</Text>
            <Text style={styles.paymentValue}>${salesByPaymentMethod.transfer.toFixed(2)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.salesList}>
        <Text style={styles.sectionTitle}>Todas las Ventas</Text>
        <FlatList
          data={sales}
          keyExtractor={(item) => item._id}
          renderItem={({ item }) => (
            <View style={styles.saleCard}>
              <View style={styles.saleHeader}>
                <Text style={styles.sellerName}>{item.sellerName}</Text>
                <Text style={styles.saleTotal}>${item.total.toFixed(2)}</Text>
              </View>
              <View style={styles.saleDetails}>
                <Text style={styles.saleDate}>
                  {dateToDisplay(new Date(item.createdAt))} {new Date(item.createdAt).toLocaleTimeString()}
                </Text>
                <View style={styles.paymentBadge}>
                  <Ionicons
                    name={
                      item.paymentMethod === 'cash'
                        ? 'cash'
                        : item.paymentMethod === 'card'
                        ? 'card'
                        : 'phone-portrait'
                    }
                    size={14}
                    color={COLORS.primary}
                  />
                  <Text style={styles.paymentText}>
                    {item.paymentMethod === 'cash'
                      ? 'Efectivo'
                      : item.paymentMethod === 'card'
                      ? 'Tarjeta'
                      : 'Transferencia'}
                  </Text>
                </View>
              </View>
              {item.isClosed && (
                <View style={styles.closedBadge}>
                  <Text style={styles.closedText}>Cerrado</Text>
                </View>
              )}
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Ionicons name="document-outline" size={48} color={COLORS.textSecondary} />
              <Text style={styles.emptyText}>No hay ventas registradas</Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.md,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  dateText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
    marginTop: SPACING.xs,
  },
  closeDayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.error,
    padding: SPACING.sm,
    borderRadius: 8,
    gap: SPACING.xs,
  },
  closeDayText: {
    ...TYPOGRAPHY.button,
    color: '#fff',
    fontSize: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: SPACING.md,
    marginBottom: SPACING.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.primary,
  },
  statLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  paymentCard: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  paymentLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  paymentValue: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
  salesList: {
    flex: 1,
    padding: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  saleCard: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: 8,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  saleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: SPACING.sm,
  },
  sellerName: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '600',
  },
  saleTotal: {
    ...TYPOGRAPHY.h3,
    color: COLORS.primary,
  },
  saleDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  saleDate: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  paymentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 4,
    gap: 4,
  },
  paymentText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.primary,
  },
  closedBadge: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: COLORS.error,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: 4,
  },
  closedText: {
    ...TYPOGRAPHY.caption,
    color: '#fff',
    fontWeight: '600',
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: SPACING.xl * 2,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.md,
  },
});