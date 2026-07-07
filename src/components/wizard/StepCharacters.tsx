/**
 * Step 2: Character configuration.
 * Uses CSS variables for consistent theming.
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
  onPolishSelection: (index: number, selectedText: string, fullText: string, selectionStart: number, selectionEnd: number) => void;
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lastEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });
  }, [onAdd]);

  const charEntryIds = new Set<string>();
  for (const c of characters) {
    for (const eid of c.entryIds ?? []) charEntryIds.add(eid);
  }
  const linkedEntries = entries.filter(e => charEntryIds.has(e.id));

  const updateLinkedEntry = useCallback((entryId: string, content: string) => {
    const updated = entries.map(e =>
      e.id === entryId ? { ...e, content } : e
    );
    onEntriesUpdate(updated);
  }, [entries, onEntriesUpdate]);

  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-color)' }}>{t('characters.title')}</h2>
        <p className="text-sm mt-1" style={{ color: mutedText }}>{t('characters.subtitle')}</p>
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
            <h3 className="text-lg font-semibold text-primary-bright">{t('characters.generatedResultsTitle')}</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary-tint-light text-primary-muted border border-primary-tint-light">
              {t('characters.autoInjectBadge')}
            </span>
          </div>
          <p className="text-xs mb-4" style={{ color: faintText }}>{t('characters.generatedResultsHint')}</p>
          <div className="space-y-3">
            {linkedEntries.map((entry) => (
              <details
                key={entry.id}
                className="group rounded-xl border border-primary-tint-light p-4"
                style={{ backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.5)' }}
              >
                <summary className="flex items-center gap-2 cursor-pointer select-none list-none">
                  <span className="text-[10px] transition-transform group-open:rotate-90" style={{ color: faintText }}>&#x25B6;</span>
                  <span className="text-sm">{entry.constant ? '\uD83D\uDD35' : '\uD83D\uDFE2'}</span>
                  <h4 className="text-sm font-medium min-w-0 truncate" style={{ color: 'var(--text-color)' }}>{entry.name}</h4>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 shrink-0">
                    {t('characters.priorityLabel', { value: String(entry.priority) })}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 min-w-0 truncate">
                    {t('characters.keysLabel', { value: entry.keys.join(', ') || t('characters.constantLabel') })}
                  </span>
                </summary>
                <div className="mt-3">
                  <TextArea
                    value={entry.content}
                    onChange={(e) => updateLinkedEntry(entry.id, e.target.value)}
                    placeholder={t('lorebook.contentPlaceholder')}
                    rows={3}
                  />
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
