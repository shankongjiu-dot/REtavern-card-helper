/**
 * Step 2: Character configuration — simplified.
 *
 * Each character has: name + description only.
 * Generated results are displayed as world book entries below,
 * allowing users to review and edit before proceeding.
 *
 * When navigating to Step 3, character descriptions are auto-injected
 * as world book entries for efficient token usage.
 */
import { useRef, useCallback } from 'react';
import { CharacterEditor } from './CharacterEditor';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { useTranslation } from '../../i18n/I18nContext';
import type { WizardCharacter, LorebookEntry } from '../../constants/defaults';
import type { CharacterVersion } from '../../pages/WizardPage';
import type { MutableRefObject } from 'react';

interface StepCharactersProps {
  characters: WizardCharacter[];
  entries: LorebookEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, updates: Partial<WizardCharacter>) => void;
  onGenerateCharacter: (index: number) => void;
  onModifyCharacter: (index: number, instructions: string, currentDescription: string) => void;
  onPolishSelection: (index: number, selectedText: string, fullText: string) => void;
  onEntriesUpdate: (entries: LorebookEntry[]) => void;
  generatingIndex: number | null;
  modifyingIndex: number | null;
  characterHistory: Record<string, CharacterVersion[]>;
  onSelectVersion: (charIndex: number, charId: string, versionId: string) => void;
  onDeleteVersion: (charId: string, versionId: string) => void;
  onSaveVersion: (charId: string, content: string) => void;
  streamingChunkCallbackRef: MutableRefObject<((chunk: string, fullText: string) => void) | null>;
}

export function StepCharacters({
  characters,
  entries,
  onAdd,
  onRemove,
  onUpdate,
  onGenerateCharacter,
  onModifyCharacter,
  onPolishSelection,
  onEntriesUpdate,
  generatingIndex,
  modifyingIndex,
  characterHistory,
  onSelectVersion,
  onDeleteVersion,
  onSaveVersion,
  streamingChunkCallbackRef,
}: StepCharactersProps) {
  const { t } = useTranslation();
  const lastEditorRef = useRef<HTMLDivElement>(null);

  const handleAdd = useCallback(() => {
    onAdd();
    // Scroll to the new character after React re-renders
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lastEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, [onAdd]);

  // Get character-linked entries (those with entryIds)
  const charEntryIds = new Set<string>();
  for (const c of characters) {
    for (const eid of c.entryIds ?? []) charEntryIds.add(eid);
  }
  const linkedEntries = entries.filter(e => charEntryIds.has(e.id));
  const userEntries = entries.filter(e => !charEntryIds.has(e.id));

  // Update a single linked entry
  const updateLinkedEntry = useCallback((entryId: string, content: string) => {
    const updated = entries.map(e =>
      e.id === entryId ? { ...e, content } : e
    );
    onEntriesUpdate(updated);
  }, [entries, onEntriesUpdate]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold text-white">{t('characters.title')}</h2>
        <p className="text-sm text-slate-400 mt-1">
          {t('characters.subtitle')}
        </p>
      </div>

      {/* Writing methodology guidance */}
      <div className="rounded-lg bg-indigo-900/20 border border-indigo-700/40 px-4 py-3 mb-4">
        <p className="text-xs text-indigo-300 leading-relaxed">
          <span className="font-semibold">{t('characters.writingRulesTitle')}</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-[11px] text-indigo-300/80">
          <p>✦ <strong>{t('characters.writingRule1')}</strong></p>
          <p>✦ <strong>{t('characters.writingRule2')}</strong></p>
          <p>✦ <strong>{t('characters.writingRule3')}</strong></p>
          <p>✦ <strong>{t('characters.writingRule4')}</strong></p>
        </div>
      </div>

      {/* Character list */}
      <div className="space-y-4">
        {characters.map((char, i) => (
          <div key={char.id} ref={i === characters.length - 1 ? lastEditorRef : undefined}>
            <CharacterEditor
              character={char}
              index={i}
              onUpdate={(updates) => onUpdate(i, updates)}
              onRemove={() => onRemove(i)}
              onGenerate={onGenerateCharacter}
              onModify={onModifyCharacter}
              onPolishSelection={onPolishSelection}
              canRemove={characters.length > 1}
              isGenerating={generatingIndex === i}
              isModifying={modifyingIndex === i}
              history={characterHistory[char.id] || []}
              onSelectVersion={(versionId) => onSelectVersion(i, char.id, versionId)}
              onDeleteVersion={(versionId) => onDeleteVersion(char.id, versionId)}
              onSaveVersion={(content) => onSaveVersion(char.id, content)}
              streamingChunkCallbackRef={streamingChunkCallbackRef}
            />
          </div>
        ))}
      </div>

      {/* Add character button */}
      <div className="mt-4">
        <Button variant="secondary" onClick={handleAdd}>
          + {t('characters.addCharacter')}
        </Button>
      </div>

      {/* Generated world book entries preview */}
      {linkedEntries.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-lg font-semibold text-indigo-300">{t('characters.generatedResultsTitle')}</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-600/30">
              {t('characters.autoInjectBadge')}
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            {t('characters.generatedResultsHint')}
          </p>
          <div className="space-y-3">
            {linkedEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-xl border border-indigo-600/30 bg-slate-800/50 p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{entry.constant ? '🔵' : '🟢'}</span>
                  <h4 className="text-sm font-medium text-white">{entry.name}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                    {t('characters.priorityLabel', { value: String(entry.priority) })}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                    {t('characters.keysLabel', { value: entry.keys.join(', ') || t('characters.constantLabel') })}
                  </span>
                </div>
                <TextArea
                  value={entry.content}
                  onChange={(e) => updateLinkedEntry(entry.id, e.target.value)}
                  placeholder={t('lorebook.contentPlaceholder')}
                  rows={3}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
