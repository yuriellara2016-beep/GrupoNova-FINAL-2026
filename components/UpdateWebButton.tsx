import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { triggerWebDeploy } from '../lib/webUpdate';
import { theme } from '../lib/theme';

export type UpdateWebButtonProps = {
  hookUrl: string;
  label?: string;
  payload?: Record<string, any>;
};

export default function UpdateWebButton({ hookUrl, label = 'Actualizar Web', payload }: UpdateWebButtonProps) {
  const [loading, setLoading] = React.useState(false);

  async function onPress() {
    setLoading(true);
    const res = await triggerWebDeploy(hookUrl, payload);
    setLoading(false);
    if (res.ok) {
      Alert.alert('Despliegue iniciado', 'Tu sitio web se está actualizando. Esto puede tardar 1-3 minutos.');
    } else {
      Alert.alert('Error al actualizar', res.error || 'Inténtalo de nuevo');
    }
  }

  return (
    <TouchableOpacity onPress={onPress} style={styles.button} disabled={loading}>
      {loading ? (
        <ActivityIndicator color={theme.colors.onPrimary} />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.md,
    alignSelf: 'flex-start',
  },
  label: {
    color: theme.colors.onPrimary,
    fontWeight: '700',
  },
});