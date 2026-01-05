import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { theme } from '../lib/theme';
import { useAuthSafe } from '../hooks/useAuth';
import {
  getArqueoHistory,
  getInventoryHistory,
  ArqueoRecord,
  InventoryRecord,
} from '../lib/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AuditEntry = {
  date: string;
  arqueo?: ArqueoRecord;
  inventory?: InventoryRecord;
  isClosed: boolean;
  closedAt?: string;
  userId?: string;
};

export default function AuditoriaScreen() {
  const { user } = useAuthSafe();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadAuditData();
  }, []);

  async function loadAuditData() {
    try {
      setLoading(true);

      // 1. Leer arqueoHistory
      const arqueoHistory = await getArqueoHistory();

      // 2. Leer inventoryHistory
      const inventoryHistory = await getInventoryHistory();

      // 3. Leer todos los closedDay:* records
      const allKeys = await AsyncStorage.getAllKeys();
      const closedDayKeys = allKeys.filter((k: string) => k.startsWith('closedDay:'));
      const closedDayPromises = closedDayKeys.map(async (key: string) => {
        const raw = await AsyncStorage.getItem(key);
        if (!raw) return null;
        try {
          const data = JSON.parse(raw);
          return { date: key.replace('closedDay:', ''), ...data };
        } catch {
          return null;
        }
      });
      const closedDays = (await Promise.all(closedDayPromises)).filter((d) => d !== null) as Array<{
        date: string;
        closedAt: string;
        arqueo?: ArqueoRecord;
        inventory?: InventoryRecord;
      }>;

      // 4. Combinar toda la información por fecha
      const dateMap = new Map<string, AuditEntry>();

      // Agregar arqueos
      arqueoHistory.forEach((arq) => {
        if (!dateMap.has(arq.date)) {
          dateMap.set(arq.date, {
            date: arq.date,
            isClosed: false,
          });
        }
        const entry = dateMap.get(arq.date)!;
        entry.arqueo = arq;
      });

      // Agregar inventarios
      inventoryHistory.forEach((inv) => {
        if (!dateMap.has(inv.date)) {
          dateMap.set(inv.date, {
            date: inv.date,
            isClosed: false,
          });
        }
        const entry = dateMap.get(inv.date)!;
        entry.inventory = inv;
      });

      // Marcar días cerrados
      closedDays.forEach((cd) => {
        if (!dateMap.has(cd.date)) {
          dateMap.set(cd.date, {
            date: cd.date,
            isClosed: true,
            closedAt: cd.closedAt,
          });
        }
        const entry = dateMap.get(cd.date)!;
        entry.isClosed = true;
        entry.closedAt = cd.closedAt;
        // Sobrescribir con data del closedDay si tiene
        if (cd.arqueo) entry.arqueo = cd.arqueo;
        if (cd.inventory) entry.inventory = cd.inventory;
      });

      // Convertir a array y ordenar por fecha descendente
      const sortedEntries = Array.from(dateMap.values()).sort((a, b) =>
        b.date.localeCompare(a.date)
      );

      setEntries(sortedEntries);
    } catch (err) {
      Alert.alert('Error', 'No se pudo cargar el historial de auditoría');
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(date: string) {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

  function formatDate(dateStr: string): string {
    try {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    } catch {
      return dateStr;
    }
  }

  function formatCurrency(num: number): string {
    return `$${num.toFixed(2)}`;
  }

  function renderArqueoSummary(arq: ArqueoRecord) {
    const diffColor =
      arq.status === 'SOBRANTE'
        ? theme.colors.tertiary
        : arq.status === 'FALTANTE'
        ? theme.colors.error
        : theme.colors.outline;

    return (
      <View style={styles.summaryRow}>
        <MaterialCommunityIcons name="cash-multiple" size={18} color={theme.colors.primary} />
        <Text style={styles.summaryLabel}>Efectivo:</Text>
        <Text style={[styles.summaryValue, { color: diffColor, fontWeight: '700' }]}>
          {arq.status === 'CUADRA' ? 'CUADRA ✓' : `${arq.status} ${formatCurrency(Math.abs(arq.difference))}`}
        </Text>
      </View>
    );
  }

  function renderInventorySummary(inv: InventoryRecord) {
    const totalDiff = inv.items.reduce((sum, item) => sum + Math.abs(item.difference), 0);
    const itemsWithDiff = inv.items.filter((item) => item.difference !== 0);

    if (itemsWithDiff.length === 0) {
      return (
        <View style={styles.summaryRow}>
          <MaterialCommunityIcons name="package-variant" size={18} color={theme.colors.primary} />
          <Text style={styles.summaryLabel}>Inventario:</Text>
          <Text style={[styles.summaryValue, { color: theme.colors.tertiary, fontWeight: '700' }]}>
            CUADRA ✓
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.summaryRow}>
        <MaterialCommunityIcons name="package-variant" size={18} color={theme.colors.primary} />
        <Text style={styles.summaryLabel}>Inventario:</Text>
        <Text style={[styles.summaryValue, { color: theme.colors.error, fontWeight: '700' }]}>
          {itemsWithDiff.length} productos con diferencias
        </Text>
      </View>
    );
  }

  function renderExpandedInventory(inv: InventoryRecord) {
    const itemsWithDiff = inv.items.filter((item) => item.difference !== 0);

    if (itemsWithDiff.length === 0) {
      return null;
    }

    return (
      <View style={styles.expandedSection}>
        <Text style={styles.expandedTitle}>Diferencias de Inventario:</Text>
        {itemsWithDiff.map((item, idx) => {
          const diffColor = item.difference < 0 ? theme.colors.error : theme.colors.tertiary;
          const diffLabel = item.difference < 0 ? 'Falta' : 'Sobra';

          return (
            <View key={idx} style={styles.inventoryItem}>
              <View style={styles.inventoryItemHeader}>
                <Text style={styles.inventoryItemName}>{item.name}</Text>
                <Text style={[styles.inventoryItemDiff, { color: diffColor }]}>
                  {diffLabel}: {Math.abs(item.difference)}
                </Text>
              </View>
              <Text style={styles.inventoryItemDetail}>
                Esperado: {item.expected} | Contado: {item.counted}
              </Text>
            </View>
          );
        })}
      </View>
    );
  }

  function renderExpandedArqueo(arq: ArqueoRecord) {
    return (
      <View style={styles.expandedSection}>
        <Text style={styles.expandedTitle}>Detalle del Arqueo:</Text>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Efectivo esperado:</Text>
          <Text style={styles.detailValue}>{formatCurrency(arq.expectedCash)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Efectivo contado:</Text>
          <Text style={styles.detailValue}>{formatCurrency(arq.countedCash)}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Diferencia:</Text>
          <Text
            style={[
              styles.detailValue,
              {
                color:
                  arq.status === 'SOBRANTE'
                    ? theme.colors.tertiary
                    : arq.status === 'FALTANTE'
                    ? theme.colors.error
                    : theme.colors.outline,
                fontWeight: '700',
              },
            ]}
          >
            {formatCurrency(arq.difference)}
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="file-document-multiple" size={28} color={theme.colors.primary} />
          <Text style={styles.headerTitle}>Auditoría</Text>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Cargando historial...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (entries.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <MaterialCommunityIcons name="file-document-multiple" size={28} color={theme.colors.primary} />
          <Text style={styles.headerTitle}>Auditoría</Text>
        </View>
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="file-search" size={64} color={theme.colors.outline} />
          <Text style={styles.emptyText}>No hay registros de auditoría</Text>
          <Text style={styles.emptySubtext}>
            Los arqueos e inventarios físicos aparecerán aquí
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <MaterialCommunityIcons name="file-document-multiple" size={28} color={theme.colors.primary} />
        <Text style={styles.headerTitle}>Auditoría</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={loadAuditData}>
          <Ionicons name="refresh" size={22} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        {entries.map((entry) => {
          const isExpanded = expandedDates.has(entry.date);

          return (
            <View key={entry.date} style={styles.card}>
              <TouchableOpacity
                style={styles.cardHeader}
                onPress={() => toggleExpand(entry.date)}
                activeOpacity={0.7}
              >
                <View style={styles.cardHeaderLeft}>
                  <Text style={styles.cardDate}>{formatDate(entry.date)}</Text>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: entry.isClosed
                          ? `${theme.colors.error}20`
                          : `${theme.colors.primary}20`,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        {
                          color: entry.isClosed ? theme.colors.error : theme.colors.primary,
                        },
                      ]}
                    >
                      {entry.isClosed ? '🔒 Cerrado' : '📝 En proceso'}
                    </Text>
                  </View>
                </View>
                <Ionicons
                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color={theme.colors.outline}
                />
              </TouchableOpacity>

              <View style={styles.cardBody}>
                {entry.arqueo && renderArqueoSummary(entry.arqueo)}
                {entry.inventory && renderInventorySummary(entry.inventory)}

                {!entry.arqueo && !entry.inventory && (
                  <Text style={styles.noDataText}>Sin datos de arqueo o inventario</Text>
                )}
              </View>

              {isExpanded && (
                <View style={styles.expandedContainer}>
                  {entry.arqueo && renderExpandedArqueo(entry.arqueo)}
                  {entry.inventory && renderExpandedInventory(entry.inventory)}
                  {entry.closedAt && (
                    <View style={styles.expandedSection}>
                      <Text style={styles.expandedTitle}>Información de Cierre:</Text>
                      <Text style={styles.detailLabel}>
                        Cerrado el: {new Date(entry.closedAt).toLocaleString('es-ES')}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outline,
    gap: theme.spacing.sm,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
    flex: 1,
  },
  refreshButton: {
    padding: theme.spacing.sm,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  loadingText: {
    fontSize: 16,
    color: theme.colors.outline,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 14,
    color: theme.colors.outline,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    ...theme.shadows.medium,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outline,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    flex: 1,
  },
  cardDate: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
  },
  statusBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  summaryLabel: {
    fontSize: 14,
    color: theme.colors.outline,
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  noDataText: {
    fontSize: 14,
    color: theme.colors.outline,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  expandedContainer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.outline,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    backgroundColor: `${theme.colors.surfaceVariant}50`,
  },
  expandedSection: {
    gap: theme.spacing.sm,
  },
  expandedTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: 13,
    color: theme.colors.outline,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  inventoryItem: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.borderRadius.sm,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.error,
    gap: 4,
  },
  inventoryItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inventoryItemName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    flex: 1,
  },
  inventoryItemDiff: {
    fontSize: 13,
    fontWeight: '700',
  },
  inventoryItemDetail: {
    fontSize: 12,
    color: theme.colors.outline,
  },
});