import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { THEME, SPACING } from '../lib/theme';

export type ClassifiedProductSuggestion = {
  _id: string;
  code: string;
  description: string;
  unit: string;
};

interface ProductSearchDropdownProps {
  value: string;
  onChangeText: (text: string) => void;
  onSelectProduct: (product: ClassifiedProductSuggestion) => void;
  suggestions: ClassifiedProductSuggestion[];
  loading?: boolean;
  placeholder?: string;
}

/**
 * ProductSearchDropdown: A searchable dropdown component for classified products
 * Shows suggestions as user types code or description
 * Allows selecting a product to autocomplete fields
 */
export default function ProductSearchDropdown({
  value,
  onChangeText,
  onSelectProduct,
  suggestions,
  loading = false,
  placeholder = 'Código o Descripción',
}: ProductSearchDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  // Show dropdown when there are suggestions
  useEffect(() => {
    if (value.trim() && suggestions.length > 0) {
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  }, [suggestions, value]);

  const handleSelectProduct = (product: ClassifiedProductSuggestion) => {
    onChangeText(product.code);
    onSelectProduct(product);
    setShowDropdown(false);
  };

  const renderSuggestion = (item: ClassifiedProductSuggestion) => (
    <TouchableOpacity
      style={styles.suggestionItem}
      onPress={() => handleSelectProduct(item)}
    >
      <View style={styles.suggestionContent}>
        <Text style={styles.suggestionCode}>{item.code}</Text>
        <Text style={styles.suggestionDescription} numberOfLines={1}>
          {item.description}
        </Text>
        <Text style={styles.suggestionUnit}>{item.unit}</Text>
      </View>
      <Text style={styles.suggestionArrow}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => {
          if (value.trim() && suggestions.length > 0) {
            setShowDropdown(true);
          }
        }}
        onBlur={() => {
          // Delay close to allow selection click to register
          setTimeout(() => setShowDropdown(false), 200);
        }}
        autoCapitalize="characters"
        editable={!loading}
      />

      {/* Dropdown Menu */}
      {showDropdown && suggestions.length > 0 && (
        <View style={styles.dropdown}>
          <FlatList
            data={suggestions}
            renderItem={({ item }) => renderSuggestion(item)}
            keyExtractor={(item) => item._id}
            scrollEnabled={suggestions.length > 5}
            nestedScrollEnabled={true}
            maxToRenderPerBatch={10}
          />
        </View>
      )}

      {/* Loading indicator */}
      {loading && (
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>🔍 Buscando...</Text>
        </View>
      )}

      {/* No results message */}
      {showDropdown &&
        value.trim() &&
        suggestions.length === 0 &&
        !loading && (
          <View style={styles.noResultsContainer}>
            <Text style={styles.noResultsText}>
              No se encontraron productos con "{value}"
            </Text>
          </View>
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 10,
    marginBottom: SPACING.small,
  },
  input: {
    backgroundColor: THEME.colors.surfaceVariant,
    padding: SPACING.small,
    borderRadius: THEME.radii.sm,
    fontSize: 14,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
  },
  dropdown: {
    position: 'absolute',
    top: 45,
    left: 0,
    right: 0,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    maxHeight: 250,
    zIndex: 20,
    ...THEME.shadow,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.small,
    paddingVertical: SPACING.small,
    borderBottomWidth: 1,
    borderBottomColor: THEME.colors.surfaceVariant,
  },
  suggestionContent: {
    flex: 1,
  },
  suggestionCode: {
    fontSize: 13,
    fontWeight: '700',
    color: THEME.colors.text,
    marginBottom: 2,
  },
  suggestionDescription: {
    fontSize: 12,
    color: THEME.colors.textSecondary,
    marginBottom: 2,
  },
  suggestionUnit: {
    fontSize: 11,
    color: THEME.colors.textSecondary,
    fontStyle: 'italic',
  },
  suggestionArrow: {
    fontSize: 20,
    color: THEME.colors.primary,
    marginLeft: SPACING.small,
  },
  loadingContainer: {
    position: 'absolute',
    top: 45,
    left: 0,
    right: 0,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    paddingVertical: SPACING.medium,
    alignItems: 'center',
    zIndex: 20,
  },
  loadingText: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
  },
  noResultsContainer: {
    position: 'absolute',
    top: 45,
    left: 0,
    right: 0,
    backgroundColor: THEME.colors.surface,
    borderRadius: THEME.radii.sm,
    borderWidth: 1,
    borderColor: THEME.colors.outline,
    paddingVertical: SPACING.medium,
    paddingHorizontal: SPACING.small,
    alignItems: 'center',
    zIndex: 20,
  },
  noResultsText: {
    fontSize: 13,
    color: THEME.colors.textSecondary,
    textAlign: 'center',
  },
});