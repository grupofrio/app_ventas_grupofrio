import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { TruckProduct, useProductStore } from '../../stores/useProductStore';
import { TopBar } from '../ui/TopBar';
import { colors, radii, spacing } from '../../theme/tokens';
import { typography } from '../../theme/typography';

interface CatalogProductPickerProps {
  visible: boolean;
  title?: string;
  excludedProductIds?: number[];
  /** When set, the picker lists these products instead of the full store. */
  products?: TruckProduct[];
  emptyLabel?: string;
  onClose: () => void;
  onSelect: (product: TruckProduct) => void;
}

function fuzzyMatch(text: string, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const haystack = text.toLowerCase();
  return normalized.split(/\s+/).every((token) => haystack.includes(token));
}

export function CatalogProductPicker({
  visible,
  title = 'Seleccionar producto',
  excludedProductIds = [],
  products: productsOverride,
  emptyLabel,
  onClose,
  onSelect,
}: CatalogProductPickerProps) {
  const storeProducts = useProductStore((s) => s.products);
  const products = productsOverride ?? storeProducts;
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) setSearch('');
  }, [visible]);

  const filtered = useMemo(() => {
    const excluded = new Set(excludedProductIds);
    return products
      .filter((product) => !excluded.has(product.id))
      .filter((product) => fuzzyMatch(`${product.name} ${product.default_code || ''}`, search))
      .sort((a, b) => {
        if (a.qty_display > 0 && b.qty_display <= 0) return -1;
        if (a.qty_display <= 0 && b.qty_display > 0) return 1;
        return a.name.localeCompare(b.name);
      });
  }, [excludedProductIds, products, search]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <TopBar title={title} showBack onBack={onClose} />

        <View style={styles.content}>
          <TextInput
            style={styles.search}
            placeholder="Buscar producto o código"
            placeholderTextColor={colors.textDim}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
          />

          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.productRow}
                activeOpacity={0.85}
                onPress={() => onSelect(item)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{item.name}</Text>
                  <Text style={styles.productMeta}>
                    {item.default_code || 'Sin código'} · {item.qty_display} disp.
                  </Text>
                </View>
                <Text style={styles.pickLabel}>Elegir</Text>
              </TouchableOpacity>
            )}
            ListEmptyComponent={(
              <View style={styles.emptyState}>
                <Text style={typography.dim}>
                  {search.trim()
                    ? 'No hay productos que coincidan.'
                    : (emptyLabel || 'No hay productos que coincidan.')}
                </Text>
              </View>
            )}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: 16,
  },
  search: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    marginBottom: 12,
  },
  listContent: {
    paddingBottom: 24,
    gap: 8,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardLighter,
    borderRadius: radii.button,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  productMeta: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 2,
  },
  pickLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  emptyState: {
    backgroundColor: colors.card,
    borderRadius: radii.button,
    padding: 18,
    alignItems: 'center',
  },
});
