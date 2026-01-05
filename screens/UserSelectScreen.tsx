import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuthSafe, type User } from '../hooks/useAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// Tema fijo
const T = {
  colors: {
    primary: '#2E7D32',
    onPrimary: '#FFFFFF',
    background: '#FFFFFF',
    surface: '#F7F7F7',
    surfaceVariant: '#EAEAEA',
    outline: '#D0D0D0',
    text: '#1F2937',
    textSecondary: '#6B7280',
    error: '#D32F2F',
    success: '#2E7D32',
    warning: '#FF9800',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  borderRadius: { sm: 8, md: 12, lg: 16 },
  shadows: {
    medium: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
  },
};

export default function UserSelectScreen() {
  const { 
    users, 
    loginAs, 
    createUser, 
    setBusinessDate: setAppBusinessDate,
    // Añadir estos estados al hook useAuthSafe si no existen
    isClosed = false,
    closedDate = null,
    refreshDayStatus = async () => {}
  } = useAuthSafe();
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'seller'>('seller');
  const [newUserPassword, setNewUserPassword] = useState('');
  
  const [adminPromptVisible, setAdminPromptVisible] = useState(false);
  const [adminCandidate, setAdminCandidate] = useState<User | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  
  const [adminGateForCreateVisible, setAdminGateForCreateVisible] = useState(false);
  const [adminGatePassword, setAdminGatePassword] = useState('');
  const [adminGateError, setAdminGateError] = useState('');
  
  const [showDateModal, setShowDateModal] = useState(false);
  const [workingDate, setWorkingDate] = useState('');
  
  const [reopenTurnVisible, setReopenTurnVisible] = useState(false);
  const [reopenTurnPassword, setReopenTurnPassword] = useState('');
  const [reopenTurnError, setReopenTurnError] = useState('');

  const adminPasswordRef = useRef<TextInput | null>(null);
  const adminGatePasswordRef = useRef<TextInput | null>(null);
  const reopenTurnPasswordRef = useRef<TextInput | null>(null);

  React.useEffect(() => {
    refreshDayStatus();
  }, [refreshDayStatus]);

  const handleSelectUser = async (user: User) => {
    try {
      if (!user.active) {
        Alert.alert('Usuario desactivado', 'Contacta a un administrador para reactivar este usuario.');
        return;
      }
      setAdminCandidate(user);
      setAdminPassword('');
      setAdminError('');
      setAdminPromptVisible(true);
    } catch (e) {
      Alert.alert('Error', 'No se pudo iniciar sesión, intenta de nuevo.');
    }
  };

  const handleConfirmAdmin = async () => {
    if (!adminCandidate) return;
    
    // Validación simple de contraseña
    const expectedPassword = adminCandidate.password || 
      (adminCandidate.role === 'admin' ? '12345' : `${adminCandidate.name}123*`);
    
    if (adminPassword !== expectedPassword) {
      setAdminError('Contraseña incorrecta');
      return;
    }
    
    setAdminPromptVisible(false);
    const today = new Date().toISOString().split('T')[0];
    setWorkingDate(today);
    setShowDateModal(true);
  };

  const handleConfirmDate = async () => {
    if (!adminCandidate) return;
    
    try {
      await setAppBusinessDate(workingDate);
      await AsyncStorage.setItem('working_date', workingDate);
      await AsyncStorage.setItem('business_date', workingDate);
    } catch (e) {
      console.warn('Failed to persist working_date:', e);
    }
    
    try {
      await loginAs(adminCandidate);
      setShowDateModal(false);
      setAdminCandidate(null);
      setAdminPassword('');
      setAdminError('');
    } catch (e) {
      Alert.alert('Error', 'No se pudo iniciar sesión');
    }
  };

  const handleCreateUser = async () => {
    if (!newUserName.trim()) {
      Alert.alert('Error', 'Por favor ingresa un nombre');
      return;
    }

    const created = await createUser(newUserName.trim(), newUserRole, newUserPassword.trim() || undefined);
    if (created) {
      setShowCreateModal(false);
      setNewUserName('');
      setNewUserRole('seller');
      setNewUserPassword('');
      Alert.alert('Éxito', 'Usuario creado correctamente');
    } else {
      Alert.alert('Error', 'No se pudo crear el usuario');
    }
  };

  const openCreateUserFlow = () => {
    setAdminGatePassword('');
    setAdminGateError('');
    setAdminGateForCreateVisible(true);
  };

  const handleConfirmAdminForCreate = () => {
    const anyAdminMatches = users.some(u => 
      u.role === 'admin' && 
      (u.password || (u.role === 'admin' ? '12345' : `${u.name}123*`)) === adminGatePassword
    );
    
    if (!anyAdminMatches) {
      setAdminGateError('Contraseña de administrador incorrecta');
      return;
    }
    
    setAdminGateForCreateVisible(false);
    setShowCreateModal(true);
  };

  // Función para reabrir turno
  const handleReopenTurn = async () => {
    const anyAdminMatches = users.some(u => 
      u.role === 'admin' && 
      (u.password || '12345') === reopenTurnPassword
    );
    
    if (!anyAdminMatches) {
      setReopenTurnError('Contraseña de administrador incorrecta');
      return;
    }
    
    if (!closedDate) {
      setReopenTurnError('No hay fecha de cierre registrada');
      return;
    }
    
    try {
      await setAppBusinessDate(closedDate);
      await AsyncStorage.setItem('working_date', closedDate);
      await AsyncStorage.setItem('business_date', closedDate);
      
      // Actualizar estado
      await refreshDayStatus();
      
      setReopenTurnVisible(false);
      Alert.alert('Éxito', `Turno reabierto para la fecha ${closedDate}`);
    } catch (e: any) {
      setReopenTurnError(e?.message || 'No se pudo reabrir el turno');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.companyName}>Grupo Nova S.R.L</Text>
        <Text style={styles.subtitle}>Selecciona tu usuario para continuar</Text>
      </View>

      {isClosed && closedDate && (
        <View style={{ paddingHorizontal: T.spacing.lg, paddingTop: T.spacing.md }}>
          <View style={styles.closedTurnBanner}>
            <Text style={styles.closedTurnTitle}>Turno cerrado</Text>
            <Text style={styles.closedTurnText}>
              El último turno fue cerrado el {closedDate}. Si necesitas continuar operando en esa misma fecha,
              un administrador puede reabrir el turno.
            </Text>
            <TouchableOpacity
              style={styles.reopenButton}
              onPress={() => {
                setReopenTurnPassword('');
                setReopenTurnError('');
                setReopenTurnVisible(true);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.reopenButtonText}>Reabrir turno (Admin)</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer}>
        {users.map((user) => (
          <TouchableOpacity
            key={user.id}
            style={styles.userCard}
            onPress={() => handleSelectUser(user)}
            activeOpacity={0.7}
          >
            <View style={[styles.userIcon, !user.active && { backgroundColor: T.colors.outline }]}>
              <Ionicons
                name={user.role === 'admin' ? 'shield-checkmark' : 'person'}
                size={32}
                color="#fff"
              />
            </View>
            <View style={styles.userInfo}>
              <Text style={[styles.userName, !user.active && styles.userNameInactive]}>{user.name}</Text>
              <View style={[styles.roleBadge, user.role === 'admin' ? styles.adminBadge : styles.sellerBadge]}>
                <Text style={styles.roleText}>
                  {user.role === 'admin' ? 'Administrador' : 'Vendedor'}
                </Text>
              </View>
              {!user.active && (
                <Text style={styles.inactiveBadge}>Desactivado</Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={24} color={T.colors.outline} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={openCreateUserFlow}
          activeOpacity={0.7}
        >
          <Ionicons name="add-circle" size={24} color="#fff" />
          <Text style={styles.createButtonText}>Crear Nuevo Usuario</Text>
        </TouchableOpacity>
      </View>

      {/* Modal para crear usuario */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Crear Nuevo Usuario</Text>
            <Text style={styles.label}>Nombre</Text>
            <TextInput style={styles.input} value={newUserName} onChangeText={setNewUserName} placeholder="Ej: María González" />
            <Text style={styles.label}>Rol</Text>
            <View style={styles.roleSelector}>
              <TouchableOpacity style={[styles.roleOption, newUserRole === 'seller' && styles.roleOptionActive]} onPress={() => setNewUserRole('seller')}>
                <Ionicons name="person" size={20} color={newUserRole === 'seller' ? '#fff' : T.colors.outline} />
                <Text style={[styles.roleOptionText, newUserRole === 'seller' && styles.roleOptionTextActive]}>Vendedor</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.roleOption, newUserRole === 'admin' && styles.roleOptionActive]} onPress={() => setNewUserRole('admin')}>
                <Ionicons name="shield-checkmark" size={20} color={newUserRole === 'admin' ? '#fff' : T.colors.outline} />
                <Text style={[styles.roleOptionText, newUserRole === 'admin' && styles.roleOptionTextActive]}>Administrador</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.label}>Contraseña (opcional)</Text>
            <TextInput style={styles.input} value={newUserPassword} onChangeText={setNewUserPassword} secureTextEntry placeholder="Dejar vacío para contraseña por defecto" />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleCreateUser}>
                <Text style={styles.confirmButtonText}>Crear</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para contraseña de usuario */}
      <Modal visible={adminPromptVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Contraseña de Usuario</Text>
            <Text style={styles.label}>Ingresa la contraseña para continuar</Text>
            <TextInput ref={adminPasswordRef} autoFocus style={styles.input} value={adminPassword} onChangeText={setAdminPassword} secureTextEntry placeholder="•••••" />
            {adminError ? <Text style={{ color: T.colors.error, fontSize: 12 }}>{adminError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setAdminPromptVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleConfirmAdmin}>
                <Text style={styles.confirmButtonText}>Ingresar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para fecha de trabajo */}
      <Modal visible={showDateModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Fecha de Trabajo</Text>
            <Text style={styles.label}>Selecciona la fecha con la que trabajarás hoy</Text>
            <TextInput style={styles.input} value={workingDate} onChangeText={setWorkingDate} placeholder="YYYY-MM-DD" />
            <Text style={[styles.label, { fontSize: 12, color: T.colors.textSecondary }]}>Formato: AAAA-MM-DD (Ej: {new Date().toISOString().split('T')[0]})</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => { setShowDateModal(false); setAdminPromptVisible(true); }}>
                <Text style={styles.cancelButtonText}>Volver</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleConfirmDate}>
                <Text style={styles.confirmButtonText}>Continuar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para permiso de administrador */}
      <Modal visible={adminGateForCreateVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Permiso de Administrador</Text>
            <Text style={styles.label}>Ingresa la contraseña de un administrador para crear usuarios</Text>
            <TextInput ref={adminGatePasswordRef} autoFocus style={styles.input} value={adminGatePassword} onChangeText={setAdminGatePassword} secureTextEntry placeholder="•••••" />
            {adminGateError ? <Text style={{ color: T.colors.error, fontSize: 12 }}>{adminGateError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setAdminGateForCreateVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleConfirmAdminForCreate}>
                <Text style={styles.confirmButtonText}>Continuar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal para reabrir turno */}
      <Modal visible={reopenTurnVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Reabrir Turno</Text>
            <Text style={styles.label}>Ingresa la contraseña de un administrador para reabrir el turno del {closedDate || ''}</Text>
            <TextInput ref={reopenTurnPasswordRef} autoFocus style={styles.input} value={reopenTurnPassword} onChangeText={setReopenTurnPassword} secureTextEntry placeholder="•••••" />
            {reopenTurnError ? <Text style={{ color: T.colors.error, fontSize: 12 }}>{reopenTurnError}</Text> : null}
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setReopenTurnVisible(false)}>
                <Text style={styles.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalButton, styles.confirmButton]} onPress={handleReopenTurn}>
                <Text style={styles.confirmButtonText}>Reabrir</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// Mantener los mismos estilos...
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.colors.background },
  header: { padding: T.spacing.xl, backgroundColor: T.colors.primary, alignItems: 'center' },
  companyName: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: T.spacing.xs },
  subtitle: { fontSize: 14, color: 'rgba(255, 255, 255, 0.9)' },
  content: { flex: 1 },
  contentContainer: { padding: T.spacing.lg, gap: T.spacing.md },
  userCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.colors.surface, padding: T.spacing.lg, borderRadius: T.borderRadius.lg, gap: T.spacing.md, ...T.shadows.medium },
  userIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: T.colors.primary, alignItems: 'center', justifyContent: 'center' },
  userInfo: { flex: 1, gap: T.spacing.xs },
  userName: { fontSize: 18, fontWeight: '600', color: T.colors.text },
  userNameInactive: { textDecorationLine: 'line-through', color: T.colors.textSecondary },
  roleBadge: { alignSelf: 'flex-start', paddingHorizontal: T.spacing.sm, paddingVertical: 4, borderRadius: T.borderRadius.sm },
  adminBadge: { backgroundColor: '#FF9800' },
  sellerBadge: { backgroundColor: '#4CAF50' },
  roleText: { fontSize: 12, fontWeight: '600', color: '#fff' },
  inactiveBadge: { marginTop: 2, alignSelf: 'flex-start', backgroundColor: '#9CA3AF', color: '#fff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, fontSize: 10, fontWeight: '700' },
  footer: { padding: T.spacing.lg, backgroundColor: T.colors.surface, borderTopWidth: 1, borderTopColor: T.colors.outline },
  createButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: T.colors.primary, padding: T.spacing.md, borderRadius: T.borderRadius.md, gap: T.spacing.sm },
  createButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)', justifyContent: 'center', alignItems: 'center', padding: T.spacing.lg },
  modalContent: { backgroundColor: T.colors.surface, borderRadius: T.borderRadius.lg, padding: T.spacing.xl, width: '100%', maxWidth: 400, gap: T.spacing.md },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: T.colors.text, marginBottom: T.spacing.sm },
  label: { fontSize: 14, fontWeight: '600', color: T.colors.text, marginBottom: T.spacing.xs },
  input: { backgroundColor: T.colors.background, borderWidth: 1, borderColor: T.colors.outline, borderRadius: T.borderRadius.md, padding: T.spacing.md, fontSize: 16, color: T.colors.text },
  roleSelector: { flexDirection: 'row', gap: T.spacing.sm },
  roleOption: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: T.spacing.md, borderRadius: T.borderRadius.md, borderWidth: 2, borderColor: T.colors.outline, gap: T.spacing.xs },
  roleOptionActive: { backgroundColor: T.colors.primary, borderColor: T.colors.primary },
  roleOptionText: { fontSize: 14, fontWeight: '600', color: T.colors.outline },
  roleOptionTextActive: { color: '#fff' },
  modalActions: { flexDirection: 'row', gap: T.spacing.sm, marginTop: T.spacing.md },
  modalButton: { flex: 1, padding: T.spacing.md, borderRadius: T.borderRadius.md, alignItems: 'center' },
  cancelButton: { backgroundColor: T.colors.background, borderWidth: 1, borderColor: T.colors.outline },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: T.colors.text },
  confirmButton: { backgroundColor: T.colors.primary },
  confirmButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  closedTurnBanner: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', borderWidth: 1, borderRadius: T.borderRadius.lg, padding: T.spacing.md },
  closedTurnTitle: { fontWeight: '800', color: '#9A3412', marginBottom: 4 },
  closedTurnText: { color: '#9A3412', fontSize: 13, lineHeight: 18 },
  reopenButton: { marginTop: T.spacing.sm, backgroundColor: '#FB923C', paddingVertical: 10, borderRadius: T.borderRadius.md, alignItems: 'center' },
  reopenButtonText: { color: '#fff', fontWeight: '800' },
});