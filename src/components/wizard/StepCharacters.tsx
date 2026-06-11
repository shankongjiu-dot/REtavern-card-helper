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
import type { WizardCharacter, LorebookEntry } from '../../constants/defaults';
import type { CharacterVersion } from '../../pages/WizardPage';

interface StepCharactersProps {
  characters: WizardCharacter[];
  entries: LorebookEntry[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, updates: Partial<WizardCharacter>) => void;
  onGenerateCharacter: (index: number) => void;
  onModifyCharacter: (index: number, instructions: string) => void;
  onPolishSelection: (index: number, selectedText: string, fullText: string) => void;
  onEntriesUpdate: (entries: LorebookEntry[]) => void;
  generatingIndex: number | null;
  modifyingIndex: number | null;
  characterHistory: Record<string, CharacterVersion[]>;
  onSelectVersion: (charIndex: number, charId: string, versionId: string) => void;
  onDeleteVersion: (charId: string, versionId: string) => void;
  onSaveVersion: (charId: string, content: string) => void;
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
}: StepCharactersProps) {
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
        <h2 className="text-xl font-bold text-white">角色配置</h2>
        <p className="text-sm text-slate-400 mt-1">
          每个角色只需要：角色名称 + 角色设定。生成结果将自动转为世界书格式。
        </p>
      </div>

      {/* Writing methodology guidance */}
      <div className="rounded-lg bg-indigo-900/20 border border-indigo-700/40 px-4 py-3 mb-4">
        <p className="text-xs text-indigo-300 leading-relaxed">
          <span className="font-semibold">写作规则（参考 tavern-cards 方法论）：</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-1.5 text-[11px] text-indigo-300/80">
          <p>✦ <strong>一句一意</strong>：写完一个态度就停，不补述同一件事</p>
          <p>✦ <strong>数据库格式</strong>：用列表和键值对，不用散文段落</p>
          <p>✦ <strong>行为展现性格</strong>：写具体行为，不贴抽象标签</p>
          <p>✦ <strong>每句话过四问</strong>：删了AI会错吗？是信息还是装饰？列表能替代吗？不看原文能理解吗？</p>
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
            />
          </div>
        ))}
      </div>

      {/* Add character button */}
      <div className="mt-4">
        <Button variant="secondary" onClick={handleAdd}>
          + 添加角色
        </Button>
      </div>

      {/* Generated world book entries preview */}
      {linkedEntries.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-lg font-semibold text-indigo-300">生成结果（世界书格式）</h3>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-600/20 text-indigo-400 border border-indigo-600/30">
              自动注入
            </span>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            以下条目由角色设定自动生成，可在进入下一步前修改。
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
                    优先级: {entry.priority}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">
                    触发词: {entry.keys.join(', ') || '常驻'}
                  </span>
                </div>
                <TextArea
                  value={entry.content}
                  onChange={(e) => updateLinkedEntry(entry.id, e.target.value)}
                  placeholder="条目内容..."
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
