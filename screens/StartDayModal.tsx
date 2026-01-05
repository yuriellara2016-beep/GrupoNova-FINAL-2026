import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthSafe } from '../lib/AuthContext';
import { COLORS, SPACING, TYPOGRAPHY } from '../lib/theme';

export default function StartDayModal() {
  const { setBusinessDate } = useAuthSafe();
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleStartDay = async () => {
    if (!date) {
      Alert.alert('Error', 'Por favor ingresa una fecha');
      return;
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      Alert.alert('Error', 'Formato de fecha inválido. Usa YYYY-MM-DD');
      return;
    }

    setLoading(true);
    try {
      await setBusinessDate(date);
      Alert.alert('Éxito', `Día iniciado con fecha: ${date}`);
    } catch (error) {
      Alert.alert('Error', 'Error al iniciar el día');
    } finally {
      setLoading(false);
    }
  };

  const handleUseToday = () => {
    const today = new Date().toISOString().split('T')[0];
    setDate(today);
  };

  return (
    <Modal visible={true} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Ionicons name="calendar" size={48} color={COLORS.primary} />
            <Text style={styles.title}>Iniciar Día de Operaciones</Text>
            <Text style={styles.subtitle}>
              Ingresa la fecha para comenzar las operaciones del día
            </Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Fecha (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.input}
              placeholder="2024-01-15"
              value={date}
              onChangeText={setDate}
            />

            <TouchableOpacity style={styles.todayButton} onPress={handleUseToday}>
              <Ionicons name="today" size={20} color={COLORS.primary} />
              <Text style={styles.todayText}>Usar Hoy</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.startButton, loading && styles.buttonDisabled]}
              onPress={handleStartDay}
              disabled={loading}
            >
              <Text style={styles.startButtonText}>
                {loading ? 'Iniciando...' : 'Iniciar Día'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modal: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: SPACING.xl,
    width: '100%',
    maxWidth: 400,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    marginTop: SPACING.md,
    textAlign: 'center',
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    textAlign: 'center',
  },
  form: {
    gap: SPACING.md,
  },
  label: {
    ...TYPOGRAPHY.body,
    color: COLORS.text,
    fontWeight: '600',
  },
  input: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: SPACING.md,
    ...TYPOGRAPHY.body,
    color: COLORS.text,
  },
  todayButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.sm,
    gap: SPACING.xs,
  },
  todayText: {
    ...TYPOGRAPHY.body,
    color: COLORS.primary,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 8,
    padding: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.md,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  startButtonText: {
    ...TYPOGRAPHY.button,
    color: '#fff',
  },
});