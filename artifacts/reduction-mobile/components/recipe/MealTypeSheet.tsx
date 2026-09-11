/**
 * components/recipe/MealTypeSheet.tsx — editing a recipe's meal types.
 *
 * Recipe-level metadata, not a tree edit. Two rows on purpose (see the web
 * component): a Primary radio row plus an "Also" row of toggles keeps every
 * tap unambiguous. Picking a new primary keeps the old one as a secondary.
 */

import React from 'react';
import { View } from 'react-native';
import { Sheet, SheetField, SheetNote, SheetOption, optionRow } from '@/components/Sheet';
import { MEAL_TYPES, MEAL_TYPE_LABELS, sanitizeMealTypes, type MealType } from '@/shared/mealTypes';

export function MealTypeSheet({
  open,
  mealTypes,
  onChange,
  onClose,
}: {
  open: boolean;
  mealTypes: string[] | undefined;
  onChange: (next: MealType[]) => void;
  onClose: () => void;
}) {
  const current = sanitizeMealTypes(mealTypes);
  const primary = current[0] ?? null;
  const secondaries = new Set(current.slice(1));

  const setPrimary = (t: MealType) => {
    if (t === primary) return;
    onChange([t, ...current.filter((x) => x !== t)]);
  };
  const toggleSecondary = (t: MealType) => {
    if (t === primary) return;
    if (secondaries.has(t)) onChange(current.filter((x) => x !== t));
    else onChange([...current, t]);
  };

  return (
    <Sheet open={open} title="Meal types" onClose={onClose}>
      <SheetField label="Primary" hint="drives sorting and the card badge">
        <View style={optionRow}>
          {MEAL_TYPES.map((t) => (
            <SheetOption key={t} label={MEAL_TYPE_LABELS[t]} current={t === primary} onPress={() => setPrimary(t)} />
          ))}
        </View>
      </SheetField>
      <SheetField label="Also" hint="widens the filter matches">
        <View style={optionRow}>
          {MEAL_TYPES.map((t) => (
            <SheetOption
              key={t}
              label={MEAL_TYPE_LABELS[t]}
              current={secondaries.has(t)}
              disabled={t === primary}
              onPress={() => toggleSecondary(t)}
            />
          ))}
        </View>
      </SheetField>
      {current.length === 0 ? (
        <SheetNote>Untagged. Pick a primary and this recipe joins the meal-type filters.</SheetNote>
      ) : null}
    </Sheet>
  );
}
