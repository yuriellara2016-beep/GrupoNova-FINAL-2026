import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getProductHistory } from '../lib/db';
import { Product } from '../types';
import { THEME, SPACING } from '../lib/theme';
import { dateToDisplay } from '../lib/date';
import { Ionicons } from '@expo/vector-icons';

interface ProductHistoryModalProps {
  visible: boolean;
  product: Product | null;
  onClose: () => void;
}

export default function ProductHistoryModal({ visible, product, onClose }: ProductHistoryModalProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && product) {
      loadHistory();
    }
  }, [visible, product]);

  async function loadHistory() {
    if (!product) return;
    setLoading(true);
    try {
      const entries = await getProductHistory(product.id);
      setHistory(entries);
    } catch (error) {
      console.error('Error loading product history:', error);
    } finally {
      setLoading(false);
    }
  }

  const formatType = (type: string) => {
    switch(type) {
      case 'purchase': return '🛒 Compra';
      case 'transfer_in': return '📦 Transferencia Recibida';
      case 'transfer_out': return '📤 Transferencia Enviada';
      case 'adjustment': return '⚖️ Ajuste';
      case 'sale': return '💰 Venta';
      default: return type;
    }
  };

  const getQuantityColor = (type: string) => {
    if (type === 'purchase' || type === 'transfer_in' || type === 'adjustment') {
      return THEME.colors.success || '#10B981';
    }
    return THEME.colors.error || '#EF4444';
  };

  const getQuantityPrefix = (type: string) => {
    if (type === 'purchase' || type === 'transfer_in') {
      return '+';
    }
    if (type === 'sale' || type === 'transfer_out') {
      return '-';
    }
    return '';
  };

  if (!product) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <TouchableOpacity onPress={onClose} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={THEME.colors.text} />
            </TouchableOpacity>
            <View>
              <Text style={styles.title}>📊 Historial del Producto</Text>
              <Text style={styles.subtitle}>{product.name}</Text>
            </View>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={THEME.colors.primary} />
            <Text style={styles.loadingText}>Cargando historial...</Text>
          </View>
        ) : history.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={64} color={THEME.colors.textSecondary} />
            <Text style={styles.emptyText}>No hay movimientos registrados</Text>
            <Text style={styles.emptySubtext}>
              Este producto aún no tiene historial de inventario
            </Text>
          </View>
        ) : (
          <ScrollView style={styles.content}>
            {/* Summary Card */}
            <View style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Total de Movimientos:</Text>
                <Text style={styles.summaryValue}>{history.length}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Stock Actual:</Text>
                <Text style={styles.summaryValue}>{product.quantity} unidades</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Precio de Costo:</Text>
                <Text style={styles.summaryValue}>${product.costPrice.toFixed(2)}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Precio de Venta:</Text>
                <Text style={styles.summaryValue}>${product.sellPrice.toFixed(2)}</Text>
              </View>
            </View>

            {/* History Timeline */}
            <Text style={styles.sectionTitle}>Historial de Movimientos</Text>
            {history.map((entry, index) => {
              const isInbound = entry.type === 'purchase' || entry.type === 'transfer_in';
              const isAdjustment = entry.type === 'adjustment';
              const quantityColor = getQuantityColor(entry.type);
              const quantityPrefix = getQuantityPrefix(entry.type);

              return (
                <View key={entry.id || index} style={styles.entryCard}>
                  {/* Timeline dot */}
                  <View style={styles.timelineDot} />
                  {index < history.length - 1 && <View style={styles.timelineLine} />}
                  
                  <View style={styles.entryContent}>
                    <View style={styles.entryHeader}>
                      <Text style={styles.entryType}>{formatType(entry.type)}</Text>
                      <Text style={styles.entryDate}>
                        {dateToDisplay(new Date(entry.createdAt))}
                      </Text>
                    </View>

                    <View style={styles.entryDetails}>
                      <View style={styles.entryRow}>
                        <Text style={styles.entryLabel}>Cantidad:</Text>
                        <Text style={[styles.entryQuantity, { color: quantityColor }]}>
                          {quantityPrefix}{Math.abs(entry.quantity)}
                        </Text>
                      </View>

                      {entry.unitCost > 0 && (
                        <View style={styles.entryRow}>
                          <Text style={styles.entryLabel}>Costo Unitario:</Text>
                          <Text style={styles.entryValue}>${entry.unitCost.toFixed(2)}</Text>
                        </View>
                      )}

                      {entry.unitCost > 0 && entry.quantity > 0 && (
                        <View style={styles.entryRow}>
                          <Text style={styles.entryLabel}>Total:</Text>
                          <Text style={styles.entryValue}>
                            ${(entry.unitCost * Math.abs(entry.quantity)).toFixed(2)}
                          </Text>
                        </View>
                      )}

                      {entry.note && (
                        <View style={styles.noteContainer}>
                          <Text style={styles.noteLabel}>📝 Nota:</Text>
                          <Text style={styles.noteText}>{entry.note}</Text>
                        </View>
                      )}

                      {entry.storeId && (
                        <View style={styles.storeTag}>
                          <Ionicons name="location" size={12} color={THEME.colors.primary} />
                          <Text style={styles.storeTagText}>{entry.storeId}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}

        <View style={styles.footer}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.outline,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    marginRight: SPACING.medium,
    padding: SPACING.small,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: THEME.colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.large,
  },
  loadingText: {
    marginTop: SPACING.medium,
    fontSize: 16,
    color: THEME.colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
    marginTop: SPACING.medium,
  },
  emptySubtext: {
    fontSize: 14,
    color: THEME.colors.textSecondary,
    marginTop: SPACING.small,
    textAlign: 'center',
  },
  content: {
    flex: 1,
    padding: SPACING.medium,
  },
  summaryCard: {
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.large,
    ...THEME.shadow,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  summaryLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
  },
  summaryValue: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: SPACING.medium,
  },
  entryCard: {
    position: 'relative',
    backgroundColor: THEME.colors.surface,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    marginBottom: SPACING.medium,
    marginLeft: 20,
    ...THEME.shadow,
  },
  timelineDot: {
    position: 'absolute',
    left: -28,
    top: 16,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: THEME.colors.primary,
    borderWidth: 2,
    borderColor: THEME.colors.background,
  },
  timelineLine: {
    position: 'absolute',
    left: -23,
    top: 28,
    width: 2,
    height: '100%',
    backgroundColor: THEME.colors.outline,
  },
  entryContent: {
    flex: 1,
  },
  entryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.small,
  },
  entryType: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.text,
  },
  entryDate: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
  },
  entryDetails: {
    gap: SPACING.tiny,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  entryLabel: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
  },
  entryQuantity: {
    fontSize: 15,
    fontWeight: '700',
  },
  entryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: THEME.colors.text,
  },
  noteContainer: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    marginTop: SPACING.small,
  },
  noteLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: THEME.colors.textSecondary,
    marginBottom: 4,
  },
  noteText: {
    fontSize: 12,
    color: THEME.colors.text,
    fontStyle: 'italic',
  },
  storeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: THEME.colors.surfaceVariant,
    paddingHorizontal: SPACING.small,
    paddingVertical: 4,
    borderRadius: THEME.radii.sm,
    marginTop: SPACING.small,
    gap: 4,
  },
  storeTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: THEME.colors.primary,
  },
  footer: {
    padding: SPACING.medium,
    backgroundColor: THEME.colors.surface,
    borderTopWidth: 1,
    borderTopColor: THEME.colors.outline,
  },
  closeButton: {
    backgroundColor: THEME.colors.primary,
    padding: SPACING.medium,
    borderRadius: THEME.radii.md,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: THEME.colors.onPrimary,
  },
});