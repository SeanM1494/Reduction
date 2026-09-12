/**
 * components/edit/EditSheet.tsx — the fields behind a tap in edit mode. The
 * web's EditSheet.tsx ported; its header carries the reasoning, and the two
 * rules that matter most survive intact:
 *
 * AMOUNT IS ONE FIELD, NOT THREE. `parseAmount` decides: a number is a qty,
 * "2-3" is a range, "to taste" is text. Nobody picks a kind before typing.
 *
 * A FIELD'S MESSAGE MAY NOT TAKE UP SPACE. The sheet is bottom-anchored and
 * capped, so anything inserted into its flow moves the controls above or
 * below it by more than a 44px target — under a tap that is still landing.
 * `Field` draws its problem absolutely against the field, pointer-events
 * off, so nothing moves and the tap that revealed it still lands where it
 * was aimed (CLAUDE.md, "A sheet's error message may not take up space").
 *
 * Every op is validated against the candidate tree BEFORE it is applied —
 * `problemsWith` runs the real `validateRecipe` — so the server can only
 * ever be asked for a tree it will accept, and the message someone reads
 * is the validator's own. Move targets, delete blockers and the section
 * consequences all come from lib/recipe-model/edits.ts, never re-derived.
 *
 * Sections are addressed by INDEX (the one asymmetry): the sheet closes on
 * any structural op so no index outlives the tree it was read from.
 */

import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { UNITS, validateRecipe, type Recipe, type Unit } from '@/shared/layout';
import { editableAmount } from '@/shared/amounts';
import {
  applyEdit,
  consumerOf,
  deleteIngredientBlocker,
  deleteSectionBlocker,
  linkConsequence,
  noTargetsReason,
  parentStepOf,
  parseAmount,
  parseTiming,
  validMoveTargets,
  type EditOp,
  type RecipeFields,
  type SectionFields,
  type StepFields,
} from '@/shared/edits';
import { Sheet, SheetButton, SheetOption, optionRow } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export type EditTarget = { kind: 'node'; id: string } | { kind: 'recipe' } | { kind: 'section'; index: number };

interface Props {
  recipe: Recipe;
  target: EditTarget | null;
  onApply: (op: EditOp) => void;
  onClose: () => void;
}

const UNIT_LABEL: Record<string, string> = { fl_oz: 'fl oz', tbsp: 'Tbs' };
/** The validator's own set, so the picker can never offer a unit the
 *  server will refuse. */
const UNIT_OPTIONS = [...UNITS] as Unit[];

/** Problems the candidate tree would have, in the validator's words. */
function problemsWith(recipe: Recipe, op: EditOp): string[] {
  try {
    return validateRecipe(applyEdit(recipe, op));
  } catch (e) {
    return [(e as Error).message];
  }
}

export function EditSheet({ recipe, target, onApply, onClose }: Props) {
  const open = !!target;
  const targetId = target?.kind === 'node' ? target.id : '';
  const section = recipe.sections.find((s) => s.ingredients.some((i) => i.id === targetId) || s.nodes.some((n) => n.id === targetId));
  const ingredient = section?.ingredients.find((i) => i.id === targetId) ?? null;
  const stepNode = section?.nodes.find((n) => n.id === targetId) ?? null;

  let title = 'Edit';
  let body: React.ReactNode = null;
  if (target?.kind === 'recipe') {
    title = 'Recipe';
    body = <RecipeForm recipe={recipe} onApply={onApply} onClose={onClose} />;
  } else if (target?.kind === 'section' && recipe.sections[target.index]) {
    title = 'Section';
    body = <SectionForm key={target.index} recipe={recipe} sectionIndex={target.index} onApply={onApply} onClose={onClose} />;
  } else if (target?.kind === 'node' && ingredient) {
    title = ingredient.name || 'Ingredient';
    body = <IngredientForm key={targetId} recipe={recipe} ingredientId={targetId} onApply={onApply} onClose={onClose} />;
  } else if (target?.kind === 'node' && stepNode) {
    title = 'Step';
    body = <StepForm key={targetId} recipe={recipe} stepId={targetId} onApply={onApply} onClose={onClose} />;
  }

  return (
    <Sheet open={open && body !== null} title={title} onClose={onClose} avoidKeyboard>
      {body}
    </Sheet>
  );
}

// ------------------------------------------------------------ pieces ------

/** A field and, when it has one, its problem — drawn OVER the sheet, not in
 *  its flow. See the file header. */
function Field({ label, hint, messages, notice, children }: { label?: string; hint?: string; messages: string[]; notice?: string | null; children: React.ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const has = messages.length > 0 || !!notice;
  return (
    // A field carrying a message stacks above the fields after it, or the
    // next label would paint through the message (siblings paint in order).
    <View style={[styles.field, has && styles.fieldRaised]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {hint ? <Text style={styles.hint}> {hint}</Text> : null}
        </Text>
      ) : null}
      {children}
      {has ? (
        <View style={styles.problem} pointerEvents="none" accessibilityRole="alert" testID="field-problem">
          {messages.map((m, i) => (
            <Text key={i} style={styles.problemText}>
              {m}
            </Text>
          ))}
          {notice ? <Text style={styles.noticeText}>{notice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function Input({
  value,
  onChange,
  onCommit,
  placeholder,
  keyboard = 'default',
  autoFocus,
  testID,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  keyboard?: 'default' | 'decimal-pad' | 'url';
  autoFocus?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      onBlur={onCommit}
      onSubmitEditing={onCommit}
      blurOnSubmit
      placeholder={placeholder}
      placeholderTextColor={colors.faint}
      keyboardType={keyboard}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      testID={testID}
    />
  );
}

function Blocked({ text }: { text: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Text style={styles.blocked} accessibilityRole="alert">
      {text}
    </Text>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <View style={rowStyles.actions}>{children}</View>;
}

/** The web's .rd-go inside a sheet: the one primary action of a form. */
function Primary({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.primary} testID={testID}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

function UnitPicker({ value, onPick }: { value: Unit | null; onPick: (u: Unit | null) => void }) {
  return (
    <View style={optionRow}>
      <SheetOption label="none (countable)" current={value === null} onPress={() => onPick(null)} />
      {UNIT_OPTIONS.map((u) => (
        <SheetOption key={u} label={UNIT_LABEL[u] ?? u} current={value === u} onPress={() => onPick(u)} />
      ))}
    </View>
  );
}

// -------------------------------------------------------- ingredient ------

function IngredientForm({ recipe, ingredientId, onApply, onClose }: { recipe: Recipe; ingredientId: string; onApply: (op: EditOp) => void; onClose: () => void }) {
  const ing = recipe.sections.flatMap((s) => s.ingredients).find((i) => i.id === ingredientId)!;
  const [amount, setAmount] = useState(() => editableAmount(ing));
  const [name, setName] = useState(ing.name ?? '');
  const [note, setNote] = useState(ing.note ?? '');
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];

  const commit = (field: string, fields: EditOp extends infer _ ? Parameters<typeof buildIngredientOp>[1] : never) => {
    const op = buildIngredientOp(ingredientId, fields);
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };
  const commitAmount = () => {
    const p = parseAmount(amount);
    commit('amount', { qty: p.qty, qtyMax: p.qtyMax, text: p.text });
  };

  const targets = useMemo(() => validMoveTargets(recipe, ingredientId), [recipe, ingredientId]);
  const parent = parentStepOf(recipe, ingredientId);
  const blocked = targets.length ? null : noTargetsReason(recipe, ingredientId);
  const blockedDelete = useMemo(() => deleteIngredientBlocker(recipe, ingredientId), [recipe, ingredientId]);
  // Renaming can sever the section-as-ingredient link sequence.ts orders
  // by — the cookie bug. Said before the commit, from the live value.
  const renameWarning = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed === (ing.name ?? '')) return null;
    try {
      return linkConsequence(recipe, applyEdit(recipe, { type: 'setIngredientFields', ingredientId, fields: { name: trimmed } }));
    } catch {
      return null;
    }
  }, [recipe, ingredientId, name, ing.name]);
  const home = recipe.sections.find((s) => s.ingredients.some((i) => i.id === ingredientId))!;

  return (
    <>
      <Field label="Amount" messages={at('amount')}>
        <Input value={amount} onChange={setAmount} onCommit={commitAmount} placeholder="2, 2-3, ½, or “to taste”" testID="edit-amount" />
      </Field>
      <Field label="Unit" messages={at('unit')}>
        <UnitPicker value={(ing.unit as Unit | null) ?? null} onPick={(u) => commit('unit', { unit: u })} />
      </Field>
      <Field label="Name" messages={at('name')} notice={renameWarning}>
        <Input value={name} onChange={setName} onCommit={() => commit('name', { name })} testID="edit-name" />
      </Field>
      <Field label="Note" hint="prep that isn’t a step" messages={at('note')}>
        <Input value={note} onChange={setNote} onCommit={() => commit('note', { note: note.trim() || null })} placeholder="finely diced" testID="edit-note" />
      </Field>
      <Field label="Used in" hint="which step it joins" messages={[]}>
        {blocked ? (
          <Blocked text={blocked} />
        ) : (
          <View style={optionRow}>
            {home.nodes.map((n) => {
              const isCurrent = parent?.id === n.id;
              const allowed = isCurrent || targets.includes(n.id);
              return (
                <SheetOption
                  key={n.id}
                  label={n.label}
                  current={isCurrent}
                  disabled={!allowed}
                  onPress={() => !isCurrent && onApply({ type: 'moveIngredient', ingredientId, toStepId: n.id })}
                />
              );
            })}
          </View>
        )}
      </Field>
      <Field messages={[]}>
        <Actions>
          <SheetButton label={`Delete “${ing.name || 'this ingredient'}”`} danger disabled={!!blockedDelete} onPress={() => onApply({ type: 'deleteIngredient', ingredientId })} testID="edit-delete-ingredient" />
        </Actions>
        {blockedDelete ? <Blocked text={blockedDelete} /> : null}
      </Field>
    </>
  );
}

function buildIngredientOp(ingredientId: string, fields: { qty?: number | null; qtyMax?: number | null; unit?: Unit | null; name?: string; text?: string | null; note?: string | null }): EditOp {
  return { type: 'setIngredientFields', ingredientId, fields };
}

// -------------------------------------------------------------- step ------

function StepForm({ recipe, stepId, onApply, onClose }: { recipe: Recipe; stepId: string; onApply: (op: EditOp) => void; onClose: () => void }) {
  const node = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const [label, setLabel] = useState(node.label ?? '');
  const [minutes, setMinutes] = useState(typeof node.minutes === 'number' ? String(node.minutes) : '');
  const [tempF, setTempF] = useState(typeof node.tempF === 'number' ? String(node.tempF) : '');
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];
  const commit = (field: string, fields: StepFields) => {
    const op: EditOp = { type: 'setStepFields', stepId, fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };
  return (
    <>
      <Field label="Label" hint="a few words" messages={at('label')}>
        <Input value={label} onChange={setLabel} onCommit={() => commit('label', { label: label.trim() })} testID="edit-label" />
      </Field>
      {/* Time and temperature are not decoration on the label: `minutes` is
          what Cook mode offers a timer for and the library card totals. */}
      <Field messages={[...at('minutes'), ...at('tempF')]}>
        <View style={rowStyles.pair}>
          <View style={rowStyles.half}>
            <Text style={rowStyles.subLabel}>Time <Text style={rowStyles.subHint}>minutes</Text></Text>
            <Input value={minutes} onChange={setMinutes} onCommit={() => commit('minutes', { minutes: parseTiming(minutes) })} placeholder="—" keyboard="decimal-pad" testID="edit-minutes" />
          </View>
          <View style={rowStyles.half}>
            <Text style={rowStyles.subLabel}>Temp <Text style={rowStyles.subHint}>°F</Text></Text>
            <Input value={tempF} onChange={setTempF} onCommit={() => commit('tempF', { tempF: parseTiming(tempF) })} placeholder="—" keyboard="decimal-pad" testID="edit-temp" />
          </View>
        </View>
      </Field>
      <InputOrder recipe={recipe} stepId={stepId} onApply={onApply} />
      <StepActions recipe={recipe} stepId={stepId} onApply={onApply} onClose={onClose} />
    </>
  );
}

/** The order this step's inputs are listed in — the diagram's rows and Cook
 *  mode's ingredient rows. Up/down buttons, not a second drag idiom. */
function InputOrder({ recipe, stepId, onApply }: { recipe: Recipe; stepId: string; onApply: (op: EditOp) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const section = recipe.sections.find((s) => s.nodes.some((n) => n.id === stepId))!;
  const node = section.nodes.find((n) => n.id === stepId)!;
  const inputs = node.inputs ?? [];
  if (inputs.length < 2) return null;
  const nameOf = (id: string) => section.ingredients.find((i) => i.id === id)?.name ?? section.nodes.find((n) => n.id === id)?.label ?? id;
  const swap = (i: number, j: number) => {
    const next = [...inputs];
    [next[i], next[j]] = [next[j], next[i]];
    onApply({ type: 'reorderInputs', stepId, inputs: next });
  };
  return (
    <Field label="Order" hint="how these rows are listed" messages={[]}>
      <View style={styles.orderList}>
        {inputs.map((id, i) => (
          <View key={id} style={styles.orderRow} testID={`edit-order-${id}`}>
            <Text style={styles.orderName} numberOfLines={1}>
              {nameOf(id)}
            </Text>
            <SheetButton label="↑" disabled={i === 0} onPress={() => swap(i, i - 1)} testID={`edit-order-up-${id}`} />
            <SheetButton label="↓" disabled={i === inputs.length - 1} onPress={() => swap(i, i + 1)} testID={`edit-order-down-${id}`} />
          </View>
        ))}
      </View>
    </Field>
  );
}

/** Add an ingredient, then the four shape-changing actions: constructive
 *  first, destructive last. */
function StepActions({ recipe, stepId, onApply, onClose }: { recipe: Recipe; stepId: string; onApply: (op: EditOp) => void; onClose: () => void }) {
  const [mode, setMode] = useState<'none' | 'adding' | 'splitting' | 'merging'>('none');
  const [blocked, setBlocked] = useState<string | null>(null);
  const node = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const next = consumerOf(recipe, stepId);
  const run = (op: EditOp): string[] | null => {
    const errors = problemsWith(recipe, op);
    if (errors.length) return errors;
    onApply(op);
    return null;
  };

  if (mode === 'adding') return <AddIngredientForm recipe={recipe} stepId={stepId} onApply={onApply} onDone={onClose} onCancel={() => setMode('none')} />;
  if (mode === 'splitting') return <SplitForm recipe={recipe} stepId={stepId} onApply={onApply} onDone={onClose} onCancel={() => setMode('none')} />;
  if (mode === 'merging' && next) {
    return (
      <Field label={`Merge into “${next.label}”`} hint="which label stays?" messages={[]}>
        <View style={optionRow}>
          {[next.label, node.label].map((label, i) => (
            <SheetOption
              key={i}
              label={label}
              current={i === 0}
              onPress={() => {
                const errors = run({ type: 'mergeStepInto', stepId, label });
                if (errors) setBlocked(errors[0]);
                else onClose();
              }}
            />
          ))}
        </View>
        <View style={rowStyles.gap} />
        <SheetButton label="Cancel" onPress={() => setMode('none')} />
        {blocked ? <Blocked text={blocked} /> : null}
      </Field>
    );
  }
  return (
    <>
      <Field label="Ingredients" messages={[]}>
        <Actions>
          <SheetButton label="Add an ingredient here" onPress={() => setMode('adding')} testID="edit-add-ingredient" />
        </Actions>
      </Field>
      <Field label="This step" messages={[]}>
        <Actions>
          <SheetButton label="Split…" onPress={() => setMode('splitting')} testID="edit-split" />
          <SheetButton
            label="Add step after"
            testID="edit-add-step"
            onPress={() => {
              const errors = run({ type: 'addStepAfter', afterStepId: stepId, label: 'new step' });
              if (errors) setBlocked(errors[0]);
              else onClose();
            }}
          />
          <SheetButton label="Merge into next" disabled={!next} onPress={() => setMode('merging')} testID="edit-merge" />
          <SheetButton
            label="Delete step"
            danger
            testID="edit-delete-step"
            onPress={() => {
              const errors = run({ type: 'deleteStep', stepId });
              if (errors) setBlocked(errors[0]);
              else onClose();
            }}
          />
        </Actions>
        {blocked ? <Blocked text={blocked} /> : null}
      </Field>
    </>
  );
}

function SplitForm({ recipe, stepId, onApply, onDone, onCancel }: { recipe: Recipe; stepId: string; onApply: (op: EditOp) => void; onDone: () => void; onCancel: () => void }) {
  const section = recipe.sections.find((s) => s.nodes.some((n) => n.id === stepId))!;
  const node = section.nodes.find((n) => n.id === stepId)!;
  const nameOf = (id: string) => section.ingredients.find((i) => i.id === id)?.name ?? section.nodes.find((n) => n.id === id)?.label ?? id;
  const [firstLabel, setFirstLabel] = useState(node.label ?? '');
  const [secondLabel, setSecondLabel] = useState('');
  const [toSecond, setToSecond] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const op: EditOp = { type: 'splitStep', stepId, firstLabel: firstLabel.trim(), secondLabel: secondLabel.trim(), toSecond };
  return (
    <Field label="Split in two" hint="the second follows the first" messages={problems}>
      <Text style={rowStyles.subLabel}>First step</Text>
      <Input value={firstLabel} onChange={setFirstLabel} testID="split-first" />
      <View style={rowStyles.gap} />
      <Text style={rowStyles.subLabel}>Then</Text>
      <Input value={secondLabel} onChange={setSecondLabel} placeholder="what happens next" testID="split-second" />
      {(node.inputs ?? []).length ? (
        <>
          <View style={rowStyles.gap} />
          <Text style={rowStyles.subLabel}>Move to the second step <Text style={rowStyles.subHint}>tap to move</Text></Text>
          <View style={optionRow}>
            {(node.inputs ?? []).map((id) => (
              <SheetOption key={id} label={nameOf(id)} current={toSecond.includes(id)} onPress={() => setToSecond((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} />
            ))}
          </View>
        </>
      ) : null}
      <View style={rowStyles.gap} />
      <Actions>
        <Primary
          label="Split"
          testID="split-go"
          onPress={() => {
            const errors = problemsWith(recipe, op);
            if (errors.length) return setProblems(errors);
            onApply(op);
            onDone();
          }}
        />
        <SheetButton label="Cancel" onPress={onCancel} />
      </Actions>
    </Field>
  );
}

/** One button, one op: committing on the first blur would insert a nameless
 *  ingredient the validator immediately rejects. */
function AddIngredientForm({ recipe, stepId, onApply, onDone, onCancel }: { recipe: Recipe; stepId: string; onApply: (op: EditOp) => void; onDone: () => void; onCancel: () => void }) {
  const step = recipe.sections.flatMap((s) => s.nodes).find((n) => n.id === stepId)!;
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit | null>(null);
  const [name, setName] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  const build = (): EditOp => {
    const p = parseAmount(amount);
    return { type: 'addIngredient', toStepId: stepId, fields: { qty: p.qty, qtyMax: p.qtyMax, text: p.text, unit, name: name.trim() } };
  };
  return (
    <Field label={`Add to “${step.label}”`} hint="it joins this step" messages={problems}>
      <Text style={rowStyles.subLabel}>Name</Text>
      <Input value={name} onChange={setName} placeholder="egg yolks" autoFocus testID="add-name" />
      <View style={rowStyles.gap} />
      <Text style={rowStyles.subLabel}>Amount</Text>
      <Input value={amount} onChange={setAmount} placeholder="2 or 2-3" testID="add-amount" />
      <View style={rowStyles.gap} />
      <Text style={rowStyles.subLabel}>Unit</Text>
      <UnitPicker value={unit} onPick={setUnit} />
      <View style={rowStyles.gap} />
      <Actions>
        <Primary
          label="Add"
          testID="add-go"
          onPress={() => {
            const op = build();
            const errors = problemsWith(recipe, op);
            if (errors.length) return setProblems(errors);
            onApply(op);
            onDone();
          }}
        />
        <SheetButton label="Cancel" onPress={onCancel} />
      </Actions>
    </Field>
  );
}

// ------------------------------------------------------------ recipe ------

/** `servings` HERE IS `recipe.servings` — what the recipe makes, a
 *  correction — never `entry.servings`. See CLAUDE.md. */
function RecipeForm({ recipe, onApply, onClose }: { recipe: Recipe; onApply: (op: EditOp) => void; onClose: () => void }) {
  const [title, setTitle] = useState(recipe.title ?? '');
  const [servings, setServings] = useState(typeof recipe.servings === 'number' ? String(recipe.servings) : '');
  const [yieldText, setYieldText] = useState(recipe.yieldText ?? '');
  const [source, setSource] = useState(recipe.source ?? '');
  const [sourceUrl, setSourceUrl] = useState(recipe.sourceUrl ?? '');
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const at = (field: string) => problems[field] ?? [];
  const commit = (field: string, fields: RecipeFields) => {
    const op: EditOp = { type: 'setRecipeFields', fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };
  return (
    <>
      <Field label="Title" messages={at('title')}>
        <Input value={title} onChange={setTitle} onCommit={() => commit('title', { title: title.trim() })} testID="recipe-title" />
      </Field>
      <Field label="Serves" hint="what the recipe makes" messages={at('servings')}>
        <Input value={servings} onChange={setServings} onCommit={() => commit('servings', { servings: parseTiming(servings) })} placeholder="—" keyboard="decimal-pad" testID="recipe-serves" />
      </Field>
      <Field label="Yield" hint="in the source's words" messages={at('yieldText')}>
        <Input value={yieldText} onChange={setYieldText} onCommit={() => commit('yieldText', { yieldText: yieldText.trim() || null })} placeholder="makes 24 cookies" />
      </Field>
      <Field label="Source" messages={at('source')}>
        <Input value={source} onChange={setSource} onCommit={() => commit('source', { source: source.trim() || null })} placeholder="NYT Cooking" />
      </Field>
      <Field label="Link" messages={at('sourceUrl')}>
        <Input value={sourceUrl} onChange={setSourceUrl} onCommit={() => commit('sourceUrl', { sourceUrl: sourceUrl.trim() || null })} placeholder="https://…" keyboard="url" />
      </Field>
      <SectionList recipe={recipe} onApply={onApply} onClose={onClose} />
    </>
  );
}

/** Adding a section: three fields, not five — the amount defaults to 1,
 *  which always validates and is one tap from correction. */
function SectionList({ recipe, onApply, onClose }: { recipe: Recipe; onApply: (op: EditOp) => void; onClose: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [firstStep, setFirstStep] = useState('');
  const [firstIngredient, setFirstIngredient] = useState('');
  const [problems, setProblems] = useState<string[]>([]);
  if (!adding) {
    return (
      <Field label="Sections" hint="tap a section's title to rename it" messages={[]}>
        <Actions>
          <SheetButton label="Add a section" onPress={() => setAdding(true)} testID="recipe-add-section" />
        </Actions>
      </Field>
    );
  }
  const op: EditOp = { type: 'addSection', name: name.trim(), firstStep: firstStep.trim(), firstIngredient: firstIngredient.trim() };
  return (
    <Field label="New section" hint="a part made separately" messages={problems}>
      <Text style={rowStyles.subLabel}>Called</Text>
      <Input value={name} onChange={setName} placeholder="Streusel topping" testID="section-name" />
      <View style={rowStyles.gap} />
      <Text style={rowStyles.subLabel}>First ingredient</Text>
      <Input value={firstIngredient} onChange={setFirstIngredient} placeholder="rolled oats" testID="section-ingredient" />
      <View style={rowStyles.gap} />
      <Text style={rowStyles.subLabel}>First step</Text>
      <Input value={firstStep} onChange={setFirstStep} placeholder="rub together" testID="section-step" />
      <View style={rowStyles.gap} />
      <Actions>
        <Primary
          label="Add section"
          testID="section-go"
          onPress={() => {
            const errors = problemsWith(recipe, op);
            if (errors.length) return setProblems(errors);
            onApply(op);
            onClose();
          }}
        />
        <SheetButton label="Cancel" onPress={() => setAdding(false)} />
      </Actions>
    </Field>
  );
}

// ----------------------------------------------------------- section ------

/** The name is half of the section-as-ingredient link; a rename is warned
 *  before the tap, a delete confirmed with the consequence. */
function SectionForm({ recipe, sectionIndex, onApply, onClose }: { recipe: Recipe; sectionIndex: number; onApply: (op: EditOp) => void; onClose: () => void }) {
  const section = recipe.sections[sectionIndex];
  const [name, setName] = useState(section.name ?? '');
  const [header, setHeader] = useState(section.header ?? '');
  const [problems, setProblems] = useState<Record<string, string[]>>({});
  const [confirming, setConfirming] = useState(false);
  const at = (field: string) => problems[field] ?? [];
  const commit = (field: string, fields: SectionFields) => {
    const op: EditOp = { type: 'setSectionFields', sectionIndex, fields };
    const errors = problemsWith(recipe, op);
    setProblems(errors.length ? { [field]: errors } : {});
    if (!errors.length) onApply(op);
  };
  const renameWarning = useMemo(() => {
    const trimmed = name.trim();
    if (trimmed === (section.name ?? '')) return null;
    try {
      return linkConsequence(recipe, applyEdit(recipe, { type: 'setSectionFields', sectionIndex, fields: { name: trimmed } }));
    } catch {
      return null;
    }
  }, [recipe, sectionIndex, name, section.name]);
  const deleteBlocked = deleteSectionBlocker(recipe, sectionIndex);
  const deleteWarning = useMemo(() => {
    if (deleteBlocked) return null;
    try {
      return linkConsequence(recipe, applyEdit(recipe, { type: 'deleteSection', sectionIndex }));
    } catch {
      return null;
    }
  }, [recipe, sectionIndex, deleteBlocked]);
  const doDelete = () => {
    onApply({ type: 'deleteSection', sectionIndex });
    onClose();
  };
  if (confirming) {
    return (
      <Field label="Delete section?" messages={[]}>
        {deleteWarning ? <Blocked text={deleteWarning} /> : null}
        <View style={rowStyles.gap} />
        <Actions>
          <SheetButton label={`Delete “${section.name || 'this section'}”`} danger onPress={doDelete} testID="section-delete-confirm" />
          <SheetButton label="Keep it" onPress={() => setConfirming(false)} />
        </Actions>
      </Field>
    );
  }
  return (
    <>
      <Field label="Called" messages={at('name')} notice={renameWarning}>
        <Input value={name} onChange={setName} onCommit={() => commit('name', { name: name.trim() })} testID="section-rename" />
      </Field>
      <Field label="Standing note" hint="shown above the table" messages={at('header')}>
        <Input value={header} onChange={setHeader} onCommit={() => commit('header', { header: header.trim() || null })} placeholder="Heat the oven to 350°F" />
      </Field>
      <Field label="This section" messages={[]}>
        <Actions>
          <SheetButton label="Delete section" danger disabled={!!deleteBlocked} onPress={() => (deleteWarning ? setConfirming(true) : doDelete())} testID="section-delete" />
        </Actions>
        {deleteBlocked ? <Blocked text={deleteBlocked} /> : null}
      </Field>
    </>
  );
}

// ------------------------------------------------------------ styles ------

const rowStyles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minWidth: 0 },
  gap: { height: 10 },
  subLabel: { fontSize: 12.5, fontWeight: '600', color: '#6b6154', marginBottom: 5 },
  subHint: { fontWeight: '400', color: '#948b7d' },
});

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    field: { marginBottom: 14, position: 'relative' },
    fieldRaised: { zIndex: 10, elevation: 10 },
    label: { fontSize: 12.5, fontWeight: '600', color: colors.mutedForeground, marginBottom: 5 },
    hint: { fontWeight: '400', color: colors.faint },
    // .rd-field-input: 44px, 16px (the input floor), page colour on a hairline.
    input: {
      minHeight: 44,
      fontSize: 16,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      backgroundColor: colors.background,
      color: colors.foreground,
    },
    // Absolute against the field: no space, no movement, no tap swallowed.
    problem: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: '100%',
      marginTop: 4,
      zIndex: 2,
      padding: 9,
      borderRadius: 10,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
    },
    problemText: { fontSize: 13, lineHeight: 18, color: colors.dangerInk },
    noticeText: { fontSize: 13, lineHeight: 18, color: colors.warmInk },
    blocked: {
      marginTop: 8,
      fontSize: 13,
      lineHeight: 19,
      color: colors.dangerInk,
      backgroundColor: colors.dangerBg,
      borderWidth: 1,
      borderColor: colors.dangerLine,
      borderRadius: 10,
      paddingVertical: 9,
      paddingHorizontal: 11,
    },
    primary: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, borderRadius: colors.radiusButton, backgroundColor: colors.primary },
    primaryText: { fontFamily: fonts.heading, fontSize: 14, color: colors.primaryForeground },
    orderList: { gap: 6 },
    orderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    orderName: { flex: 1, fontSize: 14, color: colors.foreground },
  });
}
