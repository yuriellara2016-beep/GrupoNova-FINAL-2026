import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthSafe, User } from '../hooks/useAuth';
import { theme } from '../lib/theme';
import DayStatusBanner from '../components/DayStatusBanner';

type TabType = 'users' | 'stores';

// Obtener dimensiones de la pantalla
const { height: screenHeight } = Dimensions.get('window');

// Lista de tiendas por defecto
const DEFAULT_STORES = [
  {
    id: 'store_almacen_central',
    name: 'Almacen Central',
    address: 'Ubicación principal - Almacén central',
    code: 'AC',
    active: true,
  },
  {
    id: 'store_almacen_cardenas',
    name: 'Almacen Cardenas',
    address: 'Ubicación secundaria - Almacén Cárdenas',
    code: 'ACD',
    active: true,
  },
  {
    id: 'store_pv_bocacamarioca',
    name: 'PV Bocacamarioca',
    address: 'Punto de venta Bocacamarioca',
    code: 'PVB',
    active: true,
  },
  {
    id: 'store_mercado_preferida',
    name: 'Mercado La Preferida',
    address: 'Mercado La Preferida',
    code: 'MLP',
    active: true,
  },
  {
    id: 'store_pv_pergola',
    name: 'PV La Pergola',
    address: 'Punto de venta La Pergola',
    code: 'PVP',
    active: true,
  },
  {
    id: 'store_pv_rancho',
    name: 'PV El Rancho',
    address: 'Punto de venta El Rancho',
    code: 'PVR',
    active: true,
  },
];

export default function ManageUsersScreen() {
  const {
    user: currentUser,
    users,
    stores,
    deleteUser,
    toggleUserActive,
    updateUserPassword,
    updateUserStore,
    createUser,
    createStore,
    updateStore,
    deleteStore,
    toggleStoreActive,
  } = useAuthSafe();

  const [activeTab, setActiveTab] = useState<TabType>('users');
  
  // User modals
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [selectedStoreId, setSelectedStoreId] = useState<string | undefined>(undefined);

  // Store modals
  const [storeModalVisible, setStoreModalVisible] = useState(false);
  const [editingStore, setEditingStore] = useState<any>(null);
  const [storeName, setStoreName] = useState('');
  const [storeAddress, setStoreAddress] = useState('');

  // Create user modal
  const [createUserModalVisible, setCreateUserModalVisible] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'seller'>('seller');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserStoreId, setNewUserStoreId] = useState<string | undefined>(undefined);

  // Estado para controlar la creación de tiendas por defecto
  const [creatingDefaultStores, setCreatingDefaultStores] = useState(false);
  const [showCreateStoresButton, setShowCreateStoresButton] = useState(false);

  // Función para verificar y crear tiendas por defecto al cargar
  useEffect(() => {
    checkAndCreateDefaultStores();
  }, []);

  // Verificar si faltan tiendas por defecto y mostrar opción para crearlas
  const checkAndCreateDefaultStores = async () => {
    try {
      // Verificar si ya existen todas las tiendas por defecto
      const existingStoreNames = stores.map(store => store.name);
      const missingStores = DEFAULT_STORES.filter(store => 
        !existingStoreNames.includes(store.name)
      );

      // Mostrar botón de creación si faltan tiendas
      if (missingStores.length > 0) {
        setShowCreateStoresButton(true);
      } else {
        setShowCreateStoresButton(false);
      }
    } catch (error) {
      console.error('Error al verificar tiendas por defecto:', error);
    }
  };

  // Función para crear todas las tiendas por defecto
  const handleCreateDefaultStores = async () => {
    if (!currentUser?.role === 'admin') {
      Alert.alert('Permiso denegado', 'Solo administradores pueden crear puntos de venta.');
      return;
    }

    setCreatingDefaultStores(true);
    try {
      let createdCount = 0;
      const existingStoreNames = stores.map(store => store.name);

      for (const store of DEFAULT_STORES) {
        // Verificar si la tienda ya existe
        if (!existingStoreNames.includes(store.name)) {
          try {
            const created = await createStore(store.name, store.address);
            if (created) {
              createdCount++;
              console.log(`Tienda creada: ${store.name}`);
            }
          } catch (error) {
            console.log(`Error al crear tienda ${store.name}:`, error);
          }
        }
      }

      if (createdCount > 0) {
        Alert.alert(
          '✅ Tiendas creadas',
          `Se han creado ${createdCount} puntos de venta por defecto.`,
          [
            {
              text: 'OK',
              onPress: () => {
                setShowCreateStoresButton(false);
                // Recargar la lista de tiendas
                // (esto se hará automáticamente cuando el hook useAuthSafe actualice el estado)
              }
            }
          ]
        );
      } else {
        Alert.alert('Información', 'Todos los puntos de venta por defecto ya existen.');
        setShowCreateStoresButton(false);
      }
    } catch (error) {
      Alert.alert('❌ Error', 'No se pudieron crear los puntos de venta por defecto.');
      console.error('Error al crear tiendas por defecto:', error);
    } finally {
      setCreatingDefaultStores(false);
    }
  };

  const handleToggleActive = async (userId: string, currentlyActive: boolean) => {
    const action = currentlyActive ? 'desactivar' : 'activar';
    Alert.alert(
      `¿${action.charAt(0).toUpperCase() + action.slice(1)} usuario?`,
      `Esto ${action}rá el acceso del usuario.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: action.charAt(0).toUpperCase() + action.slice(1),
          style: 'destructive',
          onPress: async () => {
            const success = await toggleUserActive(userId, !currentlyActive);
            if (success) {
              Alert.alert('Éxito', `Usuario ${action}do correctamente`);
            } else {
              Alert.alert('Error', 'No se pudo modificar el usuario');
            }
          },
        },
      ]
    );
  };

  const handleDeleteUser = async (userId: string) => {
    Alert.alert(
      '¿Eliminar usuario?',
      'Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const success = await deleteUser(userId);
            if (success) {
              Alert.alert('Éxito', 'Usuario eliminado correctamente');
            } else {
              Alert.alert('Error', 'No se pudo eliminar el usuario');
            }
          },
        },
      ]
    );
  };

  const openEditUser = (u: User) => {
    setSelectedUser(u);
    setNewPassword('');
    setSelectedStoreId(u.storeId);
    setEditModalVisible(true);
  };

  const handleSaveUserChanges = async () => {
    if (!selectedUser) return;

    if (newPassword.trim()) {
      const success = await updateUserPassword(selectedUser.id, newPassword.trim());
      if (!success) {
        Alert.alert('Error', 'No se pudo cambiar la contraseña');
        return;
      }
    }

    if (selectedStoreId !== selectedUser.storeId) {
      const success = await updateUserStore(selectedUser.id, selectedStoreId);
      if (!success) {
        Alert.alert('Error', 'No se pudo asignar la tienda');
        return;
      }
    }

    Alert.alert('Éxito', 'Cambios guardados correctamente');
    setEditModalVisible(false);
    setSelectedUser(null);
    setNewPassword('');
    setSelectedStoreId(undefined);
  };

  const openCreateUser = () => {
    setNewUserName('');
    setNewUserRole('seller');
    setNewUserPassword('');
    setNewUserStoreId(undefined);
    setCreateUserModalVisible(true);
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim()) {
      Alert.alert('Error', 'Por favor ingresa un nombre');
      return;
    }

    const created = await createUser(
      newUserName.trim(),
      newUserRole,
      newUserPassword.trim() || undefined,
      newUserStoreId
    );

    if (created) {
      setCreateUserModalVisible(false);
      setNewUserName('');
      setNewUserRole('seller');
      setNewUserPassword('');
      setNewUserStoreId(undefined);
      Alert.alert('Éxito', 'Usuario creado correctamente');
    } else {
      Alert.alert('Error', 'No se pudo crear el usuario');
    }
  };

  // Store functions
  const openCreateStore = () => {
    setEditingStore(null);
    setStoreName('');
    setStoreAddress('');
    setStoreModalVisible(true);
  };

  const openEditStore = (store: any) => {
    setEditingStore(store);
    setStoreName(store.name);
    setStoreAddress(store.address || '');
    setStoreModalVisible(true);
  };

  const handleSaveStore = async () => {
    if (!storeName.trim()) {
      Alert.alert('Error', 'Por favor ingresa un nombre');
      return;
    }

    if (editingStore) {
      // Update
      const success = await updateStore(editingStore.id, {
        name: storeName.trim(),
        address: storeAddress.trim() || undefined,
      });
      if (success) {
        Alert.alert('Éxito', 'Punto de venta actualizado');
        setStoreModalVisible(false);
        // Verificar si aún faltan tiendas por defecto
        checkAndCreateDefaultStores();
      } else {
        Alert.alert('Error', 'No se pudo actualizar');
      }
    } else {
      // Create
      const created = await createStore(storeName.trim(), storeAddress.trim() || undefined);
      if (created) {
        Alert.alert('Éxito', 'Punto de venta creado');
        setStoreModalVisible(false);
        // Verificar si aún faltan tiendas por defecto
        checkAndCreateDefaultStores();
      } else {
        Alert.alert('Error', 'No se pudo crear');
      }
    }
  };

  const handleDeleteStore = async (storeId: string) => {
    Alert.alert(
      '¿Eliminar punto de venta?',
      'Esta acción no se puede deshacer. Los usuarios asignados perderán su tienda.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const success = await deleteStore(storeId);
            if (success) {
              Alert.alert('Éxito', 'Punto de venta eliminado');
              // Verificar si aún faltan tiendas por defecto
              checkAndCreateDefaultStores();
            } else {
              Alert.alert('Error', 'No se pudo eliminar');
            }
          },
        },
      ]
    );
  };

  const handleToggleStoreActive = async (storeId: string, currentlyActive: boolean) => {
    const action = currentlyActive ? 'desactivar' : 'activar';
    const success = await toggleStoreActive(storeId, !currentlyActive);
    if (success) {
      Alert.alert('Éxito', `Punto de venta ${action}do`);
    } else {
      Alert.alert('Error', 'No se pudo modificar');
    }
  };

  if (currentUser?.role !== 'admin') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Text style={styles.errorText}>Solo administradores pueden acceder a esta pantalla</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <DayStatusBanner />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Gestión</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'users' && styles.tabActive]}
          onPress={() => setActiveTab('users')}
        >
          <Ionicons name="people" size={20} color={activeTab === 'users' ? theme.colors.primary : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'users' && styles.tabTextActive]}>Usuarios</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'stores' && styles.tabActive]}
          onPress={() => setActiveTab('stores')}
        >
          <Ionicons name="storefront" size={20} color={activeTab === 'stores' ? theme.colors.primary : theme.colors.textSecondary} />
          <Text style={[styles.tabText, activeTab === 'stores' && styles.tabTextActive]}>Puntos de Venta</Text>
        </TouchableOpacity>
      </View>

      {/* Botón para crear tiendas por defecto (solo visible si faltan) */}
      {activeTab === 'stores' && showCreateStoresButton && (
        <View style={styles.defaultStoresBanner}>
          <View style={styles.defaultStoresContent}>
            <Ionicons name="information-circle" size={24} color={theme.colors.primary} />
            <View style={styles.defaultStoresTextContainer}>
              <Text style={styles.defaultStoresTitle}>Puntos de venta por defecto</Text>
              <Text style={styles.defaultStoresDescription}>
                Faltan algunos puntos de venta recomendados para importaciones/exportaciones.
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.defaultStoresButton, creatingDefaultStores && styles.defaultStoresButtonDisabled]}
            onPress={handleCreateDefaultStores}
            disabled={creatingDefaultStores}
          >
            {creatingDefaultStores ? (
              <Text style={styles.defaultStoresButtonText}>Creando...</Text>
            ) : (
              <>
                <Ionicons name="add-circle" size={18} color="#fff" />
                <Text style={styles.defaultStoresButtonText}>Crear puntos de venta</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {activeTab === 'users' ? (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {users.map((u) => {
            const assignedStore = u.storeId ? stores.find(s => s.id === u.storeId) : null;
            return (
              <View key={u.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Ionicons
                      name={u.role === 'admin' ? 'shield-checkmark' : 'person'}
                      size={24}
                      color={u.active ? theme.colors.primary : theme.colors.outline}
                    />
                    <View>
                      <Text style={[styles.cardName, !u.active && styles.cardNameInactive]}>{u.name}</Text>
                      <View style={styles.badgeRow}>
                        <View style={[styles.roleBadge, u.role === 'admin' ? styles.adminBadge : styles.sellerBadge]}>
                          <Text style={styles.roleText}>{u.role === 'admin' ? 'Admin' : 'Vendedor'}</Text>
                        </View>
                        {!u.active && (
                          <View style={styles.inactiveBadge}>
                            <Text style={styles.inactiveText}>Desactivado</Text>
                          </View>
                        )}
                      </View>
                      {assignedStore && (
                        <Text style={styles.storeLabel}>📍 {assignedStore.name}</Text>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => openEditUser(u)}>
                    <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnSecondary]}
                    onPress={() => handleToggleActive(u.id, u.active)}
                  >
                    <Ionicons name={u.active ? 'pause' : 'play'} size={16} color={theme.colors.text} />
                    <Text style={styles.actionBtnText}>{u.active ? 'Desactivar' : 'Activar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnDanger]}
                    onPress={() => handleDeleteUser(u.id)}
                  >
                    <Ionicons name="trash" size={16} color={theme.colors.error} />
                    <Text style={[styles.actionBtnText, { color: theme.colors.error }]}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : (
        <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
          {/* Mostrar tiendas existentes */}
          {stores.map((store) => {
            const assignedUsers = users.filter(u => u.storeId === store.id);
            return (
              <View key={store.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardHeaderLeft}>
                    <Ionicons
                      name="storefront"
                      size={24}
                      color={store.active ? theme.colors.primary : theme.colors.outline}
                    />
                    <View>
                      <Text style={[styles.cardName, !store.active && styles.cardNameInactive]}>{store.name}</Text>
                      {store.address && (
                        <Text style={styles.storeLabel}>📍 {store.address}</Text>
                      )}
                      {assignedUsers.length > 0 && (
                        <Text style={styles.storeLabel}>👥 {assignedUsers.length} usuario(s) asignado(s)</Text>
                      )}
                      {!store.active && (
                        <View style={styles.inactiveBadge}>
                          <Text style={styles.inactiveText}>Desactivado</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity onPress={() => openEditStore(store)}>
                    <Ionicons name="ellipsis-vertical" size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnSecondary]}
                    onPress={() => handleToggleStoreActive(store.id, store.active)}
                  >
                    <Ionicons name={store.active ? 'pause' : 'play'} size={16} color={theme.colors.text} />
                    <Text style={styles.actionBtnText}>{store.active ? 'Desactivar' : 'Activar'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionBtnDanger]}
                    onPress={() => handleDeleteStore(store.id)}
                  >
                    <Ionicons name="trash" size={16} color={theme.colors.error} />
                    <Text style={[styles.actionBtnText, { color: theme.colors.error }]}>Eliminar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Floating action button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={activeTab === 'users' ? openCreateUser : openCreateStore}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Edit User Modal */}
      <Modal
        visible={editModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: screenHeight * 0.8 }]}>
            <ScrollView 
              style={styles.modalScrollView}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.modalTitle}>Editar Usuario: {selectedUser?.name}</Text>

              <Text style={styles.label}>Nueva Contraseña (opcional)</Text>
              <TextInput
                style={styles.input}
                value={newPassword}
                onChangeText={setNewPassword}
                placeholder="Dejar vacío para no cambiar"
                placeholderTextColor={theme.colors.outline}
                secureTextEntry
              />

              <Text style={styles.label}>Punto de Venta Asignado</Text>
              <View style={styles.storeSelectorContainer}>
                <TouchableOpacity
                  style={[styles.storeOption, !selectedStoreId && styles.storeOptionActive]}
                  onPress={() => setSelectedStoreId(undefined)}
                >
                  <Text style={[styles.storeOptionText, !selectedStoreId && styles.storeOptionTextActive]}>Ninguno</Text>
                </TouchableOpacity>
                <ScrollView 
                  style={styles.storeSelectorScroll} 
                  contentContainerStyle={styles.storeSelectorContent}
                  showsVerticalScrollIndicator={true}
                  nestedScrollEnabled={true}
                >
                  {stores.filter(s => s.active).map(store => (
                    <TouchableOpacity
                      key={store.id}
                      style={[styles.storeOption, selectedStoreId === store.id && styles.storeOptionActive]}
                      onPress={() => setSelectedStoreId(store.id)}
                    >
                      <Text style={[styles.storeOptionText, selectedStoreId === store.id && styles.storeOptionTextActive]}>
                        {store.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setEditModalVisible(false);
                    setSelectedUser(null);
                    setNewPassword('');
                    setSelectedStoreId(undefined);
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleSaveUserChanges}>
                  <Text style={styles.confirmButtonText}>Guardar</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Create User Modal */}
      <Modal
        visible={createUserModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateUserModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: screenHeight * 0.8 }]}>
            <ScrollView 
              style={styles.modalScrollView}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={styles.modalTitle}>Crear Nuevo Usuario</Text>

              <Text style={styles.label}>Nombre</Text>
              <TextInput
                style={styles.input}
                value={newUserName}
                onChangeText={setNewUserName}
                placeholder="Ej: María González"
                placeholderTextColor={theme.colors.outline}
              />

              <Text style={styles.label}>Rol</Text>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[styles.roleOption, newUserRole === 'seller' && styles.roleOptionActive]}
                  onPress={() => setNewUserRole('seller')}
                >
                  <Ionicons name="person" size={20} color={newUserRole === 'seller' ? '#fff' : theme.colors.outline} />
                  <Text style={[styles.roleOptionText, newUserRole === 'seller' && styles.roleOptionTextActive]}>Vendedor</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleOption, newUserRole === 'admin' && styles.roleOptionActive]}
                  onPress={() => setNewUserRole('admin')}
                >
                  <Ionicons name="shield-checkmark" size={20} color={newUserRole === 'admin' ? '#fff' : theme.colors.outline} />
                  <Text style={[styles.roleOptionText, newUserRole === 'admin' && styles.roleOptionTextActive]}>Admin</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Contraseña (opcional)</Text>
              <TextInput
                style={styles.input}
                value={newUserPassword}
                onChangeText={setNewUserPassword}
                placeholder={newUserRole === 'admin' ? 'Por defecto: 12345' : 'Por defecto: Nombre123*'}
                placeholderTextColor={theme.colors.outline}
                secureTextEntry
              />

              {newUserRole === 'seller' && (
                <>
                  <Text style={styles.label}>Punto de Venta Asignado</Text>
                  <View style={styles.storeSelectorContainer}>
                    <TouchableOpacity
                      style={[styles.storeOption, !newUserStoreId && styles.storeOptionActive]}
                      onPress={() => setNewUserStoreId(undefined)}
                    >
                      <Text style={[styles.storeOptionText, !newUserStoreId && styles.storeOptionTextActive]}>Ninguno</Text>
                    </TouchableOpacity>
                    <ScrollView 
                      style={styles.storeSelectorScroll} 
                      contentContainerStyle={styles.storeSelectorContent}
                      showsVerticalScrollIndicator={true}
                      nestedScrollEnabled={true}
                    >
                      {stores.filter(s => s.active).map(store => (
                        <TouchableOpacity
                          key={store.id}
                          style={[styles.storeOption, newUserStoreId === store.id && styles.storeOptionActive]}
                          onPress={() => setNewUserStoreId(store.id)}
                        >
                          <Text style={[styles.storeOptionText, newUserStoreId === store.id && styles.storeOptionTextActive]}>
                            {store.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => {
                    setCreateUserModalVisible(false);
                    setNewUserName('');
                    setNewUserRole('seller');
                    setNewUserPassword('');
                    setNewUserStoreId(undefined);
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleCreateUser}>
                  <Text style={styles.confirmButtonText}>Crear</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Store Modal (Create/Edit) */}
      <Modal
        visible={storeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStoreModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingStore ? 'Editar Punto de Venta' : 'Nuevo Punto de Venta'}</Text>

            <Text style={styles.label}>Nombre</Text>
            <TextInput
              style={styles.input}
              value={storeName}
              onChangeText={setStoreName}
              placeholder="Ej: Tienda Centro"
              placeholderTextColor={theme.colors.outline}
            />

            <Text style={styles.label}>Dirección (opcional)</Text>
            <TextInput
              style={styles.input}
              value={storeAddress}
              onChangeText={setStoreAddress}
              placeholder="Ej: Av. Central 123"
              placeholderTextColor={theme.colors.outline}
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setStoreModalVisible(false);
                  setEditingStore(null);
                  setStoreName('');
                  setStoreAddress('');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleSaveStore}>
                <Text style={styles.confirmButtonText}>{editingStore ? 'Guardar' : 'Crear'}</Text>
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
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.outline,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: theme.colors.text,
  },
  tabs: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface,
  },
  tabActive: {
    backgroundColor: theme.colors.primary + '20',
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  tabTextActive: {
    color: theme.colors.primary,
  },
  // Banner para tiendas por defecto
  defaultStoresBanner: {
    marginHorizontal: theme.spacing.lg,
    marginTop: theme.spacing.md,
    backgroundColor: '#E3F2FD',
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    borderWidth: 1,
    borderColor: '#2196F3',
  },
  defaultStoresContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  defaultStoresTextContainer: {
    flex: 1,
  },
  defaultStoresTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1565C0',
    marginBottom: 2,
  },
  defaultStoresDescription: {
    fontSize: 12,
    color: '#1565C0',
    lineHeight: 16,
  },
  defaultStoresButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    backgroundColor: '#2196F3',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
  },
  defaultStoresButtonDisabled: {
    backgroundColor: '#90CAF9',
  },
  defaultStoresButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    ...theme.shadows.medium,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: theme.spacing.xs,
  },
  cardNameInactive: {
    textDecorationLine: 'line-through',
    color: theme.colors.textSecondary,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  roleBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
  },
  adminBadge: {
    backgroundColor: '#FF9800',
  },
  sellerBadge: {
    backgroundColor: '#4CAF50',
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  inactiveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#9CA3AF',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  inactiveText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  storeLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.borderRadius.md,
  },
  actionBtnSecondary: {
    backgroundColor: theme.colors.surfaceVariant,
  },
  actionBtnDanger: {
    backgroundColor: theme.colors.error + '20',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  fab: {
    position: 'absolute',
    bottom: theme.spacing.xl,
    right: theme.spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.shadows.medium,
    elevation: 8,
  },
  errorText: {
    textAlign: 'center',
    color: theme.colors.error,
    marginTop: theme.spacing.xl,
    fontSize: 16,
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
  },
  modalScrollView: {
    width: '100%',
  },
  modalScrollContent: {
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
    minHeight: 50, // Para mejor táctil en Android
  },
  roleSelector: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  roleOption: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.outline,
    gap: theme.spacing.xs,
    minHeight: 50, // Para mejor táctil en Android
  },
  roleOptionActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  roleOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.outline,
  },
  roleOptionTextActive: {
    color: '#fff',
  },
  // Contenedor para el selector de tiendas con scroll
  storeSelectorContainer: {
    height: 180, // Altura fija optimizada para Android
    marginBottom: theme.spacing.sm,
  },
  storeSelectorScroll: {
    flex: 1,
    marginTop: theme.spacing.sm,
  },
  storeSelectorContent: {
    gap: theme.spacing.sm,
    paddingRight: 4, // Espacio para el scrollbar en Android
  },
  storeOption: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 2,
    borderColor: theme.colors.outline,
    alignItems: 'center',
    minHeight: 50, // Para mejor táctil en Android
    justifyContent: 'center',
  },
  storeOptionActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  storeOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
  },
  storeOptionTextActive: {
    color: '#fff',
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
    minHeight: 50, // Para mejor táctil en Android
    justifyContent: 'center',
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