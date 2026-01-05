// New file: hooks/useProductSearch.ts
// This hook provides classified product search with debouncing
// Used by inventory input screens to autocomplete product codes/descriptions

import { useState, useEffect, useCallback } from 'react';
import { searchProducts, ClassifiedProduct } from '../lib/classifiedProducts';

export interface UseProductSearchProps {
  debounceMs?: number;
}

export function useProductSearch(props?: UseProductSearchProps) {
  const debounceMs = props?.debounceMs ?? 300;
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<ClassifiedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useState<NodeJS.Timeout | null>(null)[1];

  const performSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    try {
      const results = await searchProducts(searchQuery);
      setSuggestions(results);
    } catch (error) {
      console.warn('Product search error:', error);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(query);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [query, debounceMs, performSearch]);

  return {
    query,
    setQuery,
    suggestions,
    loading,
    setSuggestions,
  };
}