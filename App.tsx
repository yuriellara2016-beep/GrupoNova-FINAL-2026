import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider as AppAuthProvider, useAuthSafe } from './hooks/useAuth';
import { AuthProvider as LibAuthProvider } from './lib/AuthContext';
import SimpleNavigator from './components/SimpleNavigator';
import UserSelectScreen from './screens/UserSelectScreen';

function RootScreen() {
  const { user, loading } = useAuthSafe();

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // No logged-in user yet -> force the user selection/login screen.
  if (!user) {
    return <UserSelectScreen />;
  }

  // Logged in -> show the main app tabs.
  return <SimpleNavigator />;
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.container}>
      <AppAuthProvider>
        <LibAuthProvider>
          <RootScreen />
        </LibAuthProvider>
      </AppAuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});