import React from 'react';
import { Platform, KeyboardAvoidingView, ScrollView, View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { theme } from '../lib/theme';

export type ScreenContainerProps = {
  children: React.ReactNode;
  /**
   * If true, wrap children in a ScrollView so overflowing content remains reachable.
   * Defaults to false to avoid interfering with screens that already manage their own scroll.
   */
  scrollEnabled?: boolean;
  /** Optional: extra padding inside the container */
  contentPadding?: number;
};

export default function ScreenContainer({ children, scrollEnabled = false, contentPadding = 0 }: ScreenContainerProps) {
  const content = (
    <View style={[styles.content, { padding: contentPadding }]}> 
      {children}
    </View>
  );

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {scrollEnabled ? (
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            alwaysBounceVertical={false}
          >
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: theme.colors.surface,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    minHeight: '100%',
    backgroundColor: theme.colors.surface,
  },
  content: {
    flexGrow: 1,
  },
});