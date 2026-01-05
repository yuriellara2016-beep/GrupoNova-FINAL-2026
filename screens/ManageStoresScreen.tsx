import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthSafe } from '../hooks/useAuth';
import { theme } from '../lib/theme';
import { getStores, createStore, updateStore, deleteStore, toggleStoreActive } from '../lib/stores';
import { Store } from '../types';

export default function ManageStoresScreen() {
  const { user } = useAuthSafe();
  const [stores, setStores] = useState<Store[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [message, setMessage] = useState('');
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    loadStores();
  }, []);

  const loadStores = async () => {
    const data = await getStores();
    setStores(data);
  };

  const showMessage = (msg: string, duration = 3000) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), duration);
  };

  const handleCreateStore = async () => {
    if (!newStoreName.trim()) {
      showMessage('❌ Por favor ingresa un nombre para el área');
      return;
    }

    const created = await createStore(newStoreName.trim());
    if (created) {
      setShowCreateModal(false);
      setNewStoreName('');
      await loadStores();
      showMessage(`✅ Área "${newStoreName}" creada correctamente`);
    } else {
      showMessage('❌ No se pudo crear el área');
    }
  };

  const handleToggleActive = async (store: Store) => {
    const ok = await toggleStoreActive(store.id, !store.active);
    if (ok) {
      await loadStores();
      showMessage(`✅ Área ${store.active ? 'desactivada' : 'activada'}`);
    } else {
      showMessage('❌ No se pudo cambiar el estado');
    }
  };

  const handleDeleteStore = async (store: Store) => {
    showMessage(`⚠️ Eliminando "${store.name}"...`, 1500);
    setTimeout(async () => {
      const ok = await deleteStore(store.id);
      if (ok) {
        await loadStores();
        showMessage('✅ Área eliminada');
      } else {
        showMessage('❌ No se pudo eliminar el área');
      }
    }, 1500);
  };

  const openEditModal = (store: Store) => {
    setEditingStore(store);
    setEditName(store.name);
  };

  const handleSaveEdit = async () => {
    if (!editingStore) return;
    if (!editName.trim()) {
      showMessage('❌ El nombre no puede estar vacío');
      return;
    }
    const ok = await updateStore(editingStore.id, { name: editName.trim() });
    if (ok) {
      await loadStores();
      setEditingStore(null);
      setEditName('');
      showMessage('✅ Área actualizada');
    } else {
      showMessage('❌ No se pudo actualizar');
    }
  };

  // Only admins can access this screen
  if (user?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.errorContainer}>
          <Ionicons name="lock-closed" size={48} color={theme.colors.error} />
          <Text style={styles.errorText}>Solo administradores pueden gestionar áreas</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gestión de Áreas / PDV</Text>

        {message && (
          <View style={[styles.messageBanner, message.startsWith('✅') ? styles.successBanner : message.startsWith('⚠️') ? styles.warningBanner : styles.errorBanner]}>
            <Text style={styles.messageText}>{message}</Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.addButton}
          onPress={() => setShowCreateModal(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle" size={24} color="#fff" />
          <Text style={styles.addButtonText}>Crear Área</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <Text style={styles.infoText}>
          Las áreas representan puntos de venta, sucursales o almacenes independientes.
          Cada área tiene su propio inventario y los usuarios asignados solo verán datos de su área.
        </Text>

        {stores.map((store) => (
          <View key={store.id} style={[styles.storeCard, !store.active && styles.storeCardInactive]}>
            <View style={[styles.storeIcon, !store.active && { backgroundColor: theme.colors.outline }]}>
              <Ionicons name="business" size={28} color="#fff" />
            </View>
            <View style={styles.storeInfo}>
              <Text style={[styles.storeName, !store.active && styles.storeNameInactive]}>{store.name}</Text>
              {!store.active && <Text style={styles.inactiveBadge}>Desactivada</Text>}
            </View>
            <View style={styles.actions}>
              <TouchableOpacity style={styles.iconBtn} onPress={() => openEditModal(store)}>
                <Ionicons name="pencil-outline" size={24} color={theme.colors.primary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => handleToggleActive(store)}>
                <Ionicons name={store.active ? 'pause-circle' : 'play-circle'} size={24} color={store.active ? '#F59E0B' : '#10B981'} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => handleDeleteStore(store)}>
                <Ionicons name="trash-outline" size={24} color="#EF4444" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Create Store Modal */}
      <Modal
        visible={showCreateModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Crear Nueva Área</Text>

            <Text style={styles.label}>Nombre del Área</Text>
            <TextInput
              style={styles.input}
              value={newStoreName}
              onChangeText={setNewStoreName}
              placeholder="Ej: Sucursal Centro, Almacén Norte"
              placeholderTextColor={theme.colors.outline}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowCreateModal(false);
                  setNewStoreName('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleCreateStore}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmButtonText}>Crear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Store Modal */}
      <Modal
        visible={!!editingStore}
        transparent
        animationType="slide"
        onRequestClose={() => setEditingStore(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Editar Área</Text>

            <Text style={styles.label}>Nombre del Área</Text>
            <TextInput
              style={styles.input}
              value={editName}
              onChangeText={setEditName}
              placeholder="Nombre"
              placeholderTextColor={theme.colors.outline}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setEditingStore(null);
                  setEditName('');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={handleSaveEdit}
                activeOpacity={0.7}
              >
                <Text style={styles.confirmButtonText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outline,
    gap: theme.spacing.md,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.text,
  },
  messageBanner: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  successBanner: {
    backgroundColor: '#D1FAE5',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  warningBanner: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  errorBanner: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  messageText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    gap: theme.spacing.sm,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: theme.spacing.lg,
  },
  infoText: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.lg,
    lineHeight: 20,
  },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.lg,
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
    ...theme.shadows.medium,
  },
  storeCardInactive: {
    opacity: 0.7,
  },
  storeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeInfo: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  storeName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  storeNameInactive: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  inactiveBadge: {
    marginTop: 2,
    alignSelf: 'flex-start',
    backgroundColor: '#9CA3AF',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    fontSize: 10,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    padding: 6,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.md,
  },
  errorText: {
    fontSize: 16,
    color: theme.colors.error,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: theme.spacing.lg,
  },
  modalContent: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.xl,
    width: '100%',
    maxWidth: 400,
    gap: theme.spacing.md,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.outline,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    fontSize: 16,
    color: theme.colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  modalButton: {
    flex: 1,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.outline,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
  },
  confirmButton: {
    backgroundColor: theme.colors.primary,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});