/**
 * CharacterEditor - Single character editor panel used in Step 2.
 * Simplified to: name + description only.
 * Uses local state for editing and syncs to parent on blur.
 *
 * Includes:
 *   - Version history panel that tracks AI generation results
 *   - Partial AI modification (instruction-based or selection-based polish)
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { TextInput } from '../shared/TextInput';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { CHARACTER_ALIGNMENTS } from '../../constants/defaults';
import { useTranslation } from '../../i18n/I18nContext';
import type { WizardCharacter } from '../../constants/defaults';
import type { CharacterVersion } from '../../pages/WizardPage';
import type { MutableRefObject } from 'react';

interface CharacterEditorProps {
  character: WizardCharacter;
  index: number;
  onUpdate: (updates: Partial<WizardCharacter>) => void;
  onRemove: () => void;
  onGenerate: (index: number) => void;
  onModify: (index: number, instructions: string, currentDescription: string) => void;
  onPolishSelection: (index: number, selectedText: string, fullText: string) => void;
  canRemove: boolean;
  isGenerating: boolean;
  isModifying: boolean;
  history: CharacterVersion[];
  onSelectVersion: (versionId: string) => void;
  onDeleteVersion: (versionId: string) => void;
  onSaveVersion: (content: string) => void;
  streamingChunkCallbackRef: MutableRefObject<((chunk: string, fullText: string) => void) | null>;
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function CharacterEditor({
  character,
  index,
  onUpdate,
  onRemove,
  onGenerate,
  onModify,
  onPolishSelection,
  canRemove,
  isGenerating,
  isModifying,
  history,
  onSelectVersion,
  onDeleteVersion,
  onSaveVersion,
  streamingChunkCallbackRef,
}: CharacterEditorProps) {
  const { t } = useTranslation();
  const [localName, setLocalName] = useState(character.name ?? '');
  const [localDesc, setLocalDesc] = useState(character.description ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [showModifyPanel, setShowModifyPanel] = useState(false);
  const [modifyInstruction, setModifyInstruction] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamPreviewRef = useRef<HTMLDivElement | null>(null);

  // Streaming chunk handler — shared ref, WizardPage reads this during generation
  // Throttle streaming re-renders to ~1 frame using requestAnimationFrame
  const pendingChunkRef = useRef('');
  const rafPendingRef = useRef(false);
  const flushChunks = useCallback(() => {
    setStreamingText(pendingChunkRef.current);
    rafPendingRef.current = false;
  }, []);

  const wrappedOnGenerate = useCallback(() => {
    // Reset streaming state
    pendingChunkRef.current = '';
    setStreamingText('');

    // Set up the chunk handler on the shared ref — WizardPage's onChunk callback
    // will call this, updating the local streaming preview in real-time
    streamingChunkCallbackRef.current = (_chunk: string, fullText: string) => {
      pendingChunkRef.current = fullText;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(flushChunks);
      }
    };

    onGenerate(index);
  }, [onGenerate, index, flushChunks, streamingChunkCallbackRef]);

  // Clear streaming state and chunk handler when generation finishes
  useEffect(() => {
    if (!isGenerating) {
      streamingChunkCallbackRef.current = null;
      setStreamingText('');
      pendingChunkRef.current = '';
    }
  }, [isGenerating, streamingChunkCallbackRef]);

  // Auto-scroll streaming preview to bottom
  useEffect(() => {
    if (streamingText && streamPreviewRef.current) {
      streamPreviewRef.current.scrollTop = streamPreviewRef.current.scrollHeight;
    }
  }, [streamingText]);

  useEffect(() => { setLocalName(character.name ?? ''); }, [character.name]);
  useEffect(() => { setLocalDesc(character.description ?? ''); }, [character.description]);

  // Force-sync localDesc when generation finishes — ensures the textarea
  // reflects the new description even if the useEffect above is delayed
  const prevGeneratingRef = useRef(isGenerating);
  useEffect(() => {
    const wasGenerating = prevGeneratingRef.current;
    prevGeneratingRef.current = isGenerating;
    if (wasGenerating && !isGenerating && character.description) {
      setLocalDesc(character.description);
    }
  }, [isGenerating, character.description]);

  const hasName = (character.name ?? '').trim().length > 0;
  const hasHistory = history.length > 0;
  const hasDescription = localDesc.trim().length > 0;

  // Detect text selection in the description textarea
  const handleDescSelect = useCallback(() => {
    const textarea = descTextareaRef.current;
    if (textarea) {
      const sel = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
      setSelectedText(sel.trim());
    }
  }, []);

  const handleSelectVersion = (version: CharacterVersion) => {
    setLocalDesc(version.content);
    onUpdate({ description: version.content });
    onSelectVersion(version.id);
    setExpandedVersionId(null);
  };

  const handleSaveCurrentAsVersion = () => {
    if (localDesc.trim()) {
      onSaveVersion(localDesc);
    }
  };

  const handleModify = () => {
    if (!modifyInstruction.trim() || isModifying) return;
    // Pass localDesc directly to avoid stale draft race condition
    onModify(index, modifyInstruction.trim(), localDesc);
    setModifyInstruction('');
  };

  const handlePolishSelection = () => {
    if (!selectedText || isModifying) return;
    onUpdate({ description: localDesc });
    onPolishSelection(index, selectedText, localDesc);
    setSelectedText('');
  };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">
          {t('characters.characterIndex', { index: String(index + 1) })}{localName ? `: ${localName}` : ''}
        </h3>
        <div className="flex items-center gap-2">
          {hasName && (
            <Button
              variant="secondary"
              size="sm"
              onClick={wrappedOnGenerate}
              disabled={isGenerating}
            >
              {isGenerating ? t('characterEditor.generating') : t('characterEditor.generate')}
            </Button>
          )}
          {canRemove && (
            <Button variant="danger" size="sm" onClick={onRemove} disabled={isGenerating}>
              {t('characterEditor.remove')}
            </Button>
          )}
        </div>
      </div>

      {/* Fields */}
      <TextInput
        label={t('characterEditor.nameLabel')}
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={(e) => onUpdate({ name: e.target.value })}
        placeholder={t('characterEditor.namePlaceholder')}
      />

      {/* Alignment selector (optional D&D nine-grid) — collapsible */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium text-slate-400 mb-1.5 hover:text-slate-300 transition-colors">
          <span className="transition-transform group-open:rotate-90">▶</span>
          {t('characterEditor.alignment')}
          <span className="text-slate-600 font-normal">{t('characterEditor.alignmentHint')}</span>
          {character.alignment && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 border border-indigo-700/40">
              {CHARACTER_ALIGNMENTS.find(a => a.value === character.alignment)?.label || character.alignment}
            </span>
          )}
        </summary>
        <div className="grid grid-cols-3 gap-1.5 mt-2">
          <button
            onClick={() => onUpdate({ alignment: undefined })}
            className={`text-[11px] py-1.5 px-2 rounded border transition-colors ${
              !character.alignment
                ? 'border-slate-500 bg-slate-700/60 text-slate-200'
                : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
            }`}
          >
            {t('characterEditor.noAlignment')}
          </button>
          {CHARACTER_ALIGNMENTS.map((a) => (
            <button
              key={a.value}
              onClick={() => onUpdate({ alignment: a.value })}
              title={a.desc}
              className={`text-[11px] py-1.5 px-2 rounded border transition-colors ${
                character.alignment === a.value
                  ? 'border-indigo-500 bg-indigo-900/40 text-indigo-200'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </details>

      {/* NSFW toggle */}
      <div className="flex items-center gap-3 py-1">
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={character.nsfw ?? false}
            onChange={(e) => onUpdate({ nsfw: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
        </label>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-300">{t('characterEditor.nsfwContent')}</span>
          <span className="text-[10px] text-slate-500">
            {character.nsfw ? t('characterEditor.nsfwAllowed') : t('characterEditor.nsfwDisabled')}
          </span>
        </div>
      </div>

      <div>
        <TextArea
          label={t('characterEditor.descLabel')}
          value={localDesc}
          onChange={(e) => setLocalDesc(e.target.value)}
          onBlur={(e) => onUpdate({ description: e.target.value })}
          placeholder={t('characterEditor.descPlaceholder')}
          rows={4}
          textareaRef={descTextareaRef}
          onSelect={handleDescSelect}
        />

        {/* Show selected text indicator */}
        {selectedText && hasDescription && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded border border-amber-700/30">
              {t('characterEditor.selectedChars', { count: String(selectedText.length) })}
            </span>
            <button
              onClick={handlePolishSelection}
              disabled={isModifying}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-800/30 text-amber-300 hover:bg-amber-700/40 transition-colors disabled:opacity-40"
            >
              {isModifying ? t('characterEditor.polishing') : t('characterEditor.polishSelected')}
            </button>
            <button
              onClick={() => setSelectedText('')}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              {t('characterEditor.cancelSelection')}
            </button>
          </div>
        )}
      </div>

      {/* AI Streaming Preview — shows raw output as it arrives */}
      {(isGenerating || streamingText) && (
        <div className="rounded-lg border border-purple-700/40 bg-purple-950/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-purple-300 flex items-center gap-2">
              {isGenerating && (
                <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
              )}
              {t('characterEditor.streamingOutputTitle')}
            </h4>
            <span className="text-[10px] text-slate-500">{streamingText.length} {t('common.words')}</span>
          </div>
          <div
            ref={streamPreviewRef}
            className="max-h-[300px] overflow-y-auto rounded bg-slate-950/60 p-3 border border-slate-800"
          >
            {streamingText ? (
              <pre className="text-[11px] text-purple-200/80 font-mono whitespace-pre-wrap leading-relaxed">
                {streamingText}
              </pre>
            ) : (
              <p className="text-[11px] text-slate-500 italic">{t('characterEditor.streamingWaiting')}</p>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-2">
            {t('characterEditor.streamingHint')}
          </p>
        </div>
      )}

      {/* Action buttons row */}
      {hasDescription && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveCurrentAsVersion}
            className="text-[11px] px-2.5 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            {t('characterEditor.saveAsVersion')}
          </button>
          <button
            onClick={() => setShowModifyPanel(!showModifyPanel)}
            className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
              showModifyPanel
                ? 'border-cyan-500/50 text-cyan-300 bg-cyan-900/20'
                : 'border-cyan-600/30 text-cyan-400 hover:text-cyan-300 hover:border-cyan-500/50'
            }`}
          >
            {showModifyPanel ? t('characterEditor.collapseModify') : t('characterEditor.modifyPanel')}
          </button>
          {hasHistory && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-[11px] px-2.5 py-1 rounded border border-indigo-600/40 text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/60 transition-colors"
            >
              {showHistory ? t('characterEditor.collapsePreview') : `${t('characterEditor.versionHistory')} (${history.length})`}
            </button>
          )}
        </div>
      )}

      {/* AI Partial Modification Panel */}
      {showModifyPanel && hasDescription && (
        <div className="rounded-lg border border-cyan-700/40 bg-cyan-950/15 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-cyan-300">{t('characterEditor.modifyTitle')}</h4>
            <span className="text-[10px] text-slate-500">{t('characterEditor.modifyHint')}</span>
          </div>
          <textarea
            value={modifyInstruction}
            onChange={(e) => setModifyInstruction(e.target.value)}
            placeholder={t('characterEditor.modifyPlaceholder')}
            className="w-full h-16 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 resize-y focus:border-cyan-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleModify();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleModify}
              disabled={!modifyInstruction.trim() || isModifying}
            >
              {isModifying ? t('characterEditor.modifying') : t('characterEditor.modifyButton')}
            </Button>
            <span className="text-[10px] text-slate-500">{t('characterEditor.modifyShortcut')}</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            {t('characterEditor.modifyDesc')}
          </p>
        </div>
      )}

      {/* Version History Panel */}
      {showHistory && hasHistory && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-slate-300">{t('characterEditor.versionHistory')}</h4>
            <span className="text-[10px] text-slate-500">{t('characterEditor.versionHistoryHint')}</span>
          </div>

          <div className="space-y-1.5">
            {history.map((version, vIndex) => {
              const isActive = version.content === localDesc;
              const isExpanded = expandedVersionId === version.id;
              return (
                <div
                  key={version.id}
                  className={`rounded-lg border transition-all ${
                    isActive
                      ? 'border-indigo-500/50 bg-indigo-900/15'
                      : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
                  }`}
                >
                  {/* Version header row */}
                  <div className="flex items-center gap-2 px-3 py-1.5">
                    <button
                      onClick={() => handleSelectVersion(version)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                        version.isOriginal
                          ? 'bg-emerald-800/40 text-emerald-300'
                          : 'bg-violet-800/40 text-violet-300'
                      }`}>
                        {version.isOriginal ? t('characterEditor.original') : `v${vIndex}`}
                      </span>
                      <span className={`text-xs truncate ${isActive ? 'text-indigo-300' : 'text-slate-400'}`}>
                        {version.content.slice(0, 60)}{version.content.length > 60 ? '...' : ''}
                      </span>
                      <span className="text-[10px] text-slate-600 shrink-0 ml-auto">
                        {formatTime(version.timestamp)}
                      </span>
                    </button>
                    <button
                      onClick={() => setExpandedVersionId(isExpanded ? null : version.id)}
                      className="text-[10px] text-slate-500 hover:text-slate-300 shrink-0 px-1"
                      title={t('characterEditor.expandPreview')}
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                    {!version.isOriginal && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteVersion(version.id); }}
                        className="text-[10px] text-red-400/60 hover:text-red-400 shrink-0 px-1"
                        title={t('common.delete')}
                      >
                        x
                      </button>
                    )}
                  </div>

                  {/* Expanded preview */}
                  {isExpanded && (
                    <div className="px-3 pb-2">
                      <div className="max-h-[200px] overflow-y-auto rounded bg-slate-950/50 p-2 border border-slate-800">
                        <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                          {version.content}
                        </pre>
                      </div>
                      {!isActive && (
                        <button
                          onClick={() => handleSelectVersion(version)}
                          className="mt-1.5 text-[11px] px-2 py-1 rounded bg-indigo-800/30 text-indigo-300 hover:bg-indigo-700/40 transition-colors"
                        >
                          {t('characterEditor.useThisVersion')}
                        </button>
                      )}
                      {isActive && (
                        <span className="mt-1.5 inline-block text-[11px] text-indigo-400">
                          {t('characterEditor.currentInUse')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
