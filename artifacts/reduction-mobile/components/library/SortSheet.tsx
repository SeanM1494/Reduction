/**
 * components/library/SortSheet.tsx — the web's sort <select>, as a sheet.
 *
 * A native picker would need a dependency and looks different on every
 * platform; six options fit in one sheet and one tap picks and closes.
 */

import React from 'react';
import { View } from 'react-native';
import { Sheet, SheetOption, optionRow } from '@/components/Sheet';
import { SORTS, type SortKey } from '@/lib/libraryView';

export function SortSheet({
  open,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  value: SortKey;
  onPick: (key: SortKey) => void;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Sort by" onClose={onClose}>
      <View style={optionRow}>
        {SORTS.map(([key, label]) => (
          <SheetOption
            key={key}
            label={label}
            current={key === value}
            onPress={() => {
              onPick(key);
              onClose();
            }}
          />
        ))}
      </View>
    </Sheet>
  );
}
