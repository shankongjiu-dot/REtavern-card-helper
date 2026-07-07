/**
 * CharacterEditor - Single character editor panel used in Step 2.
 * Uses CSS variables for consistent theming.
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
  onPolishSelection: (index: number, selectedText: string, fullText: string, selectionStart: number, selectionEnd: number) => void;
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
  const [selection, setSelection] = useState<{ text: string; start: number; end: number } | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const streamPreviewRef = useRef<HTMLDivElement | null>(null);

  const pendingChunkRef = useRef('');
  const rafPendingRef = useRef(false);
  const flushChunks = useCallback(() => {
    setStreamingText(pendingChunkRef.current);
    rafPendingRef.current = false;
  }, []);

  const wrappedOnGenerate = useCallback(() => {
    pendingChunkRef.current = '';
    setStreamingText('');
    streamingChunkCallbackRef.current = (_chunk: string, fullText: string) => {
      pendingChunkRef.current = fullText;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(flushChunks);
      }
    };
    onGenerate(index);
  }, [onGenerate, index, flushChunks, streamingChunkCallbackRef]);

  useEffect(() => {
    if (!isGenerating) {
      streamingChunkCallbackRef.current = null;
      setStreamingText('');
      pendingChunkRef.current = '';
    }
  }, [isGenerating, streamingChunkCallbackRef]);

  useEffect(() => {
    if (streamingText && streamPreviewRef.current) {
      streamPreviewRef.current.scrollTop = streamPreviewRef.current.scrollHeight;
    }
  }, [streamingText]);

  useEffect(() => { setLocalName(character.name ?? ''); }, [character.name]);
  useEffect(() => { setLocalDesc(character.description ?? ''); }, [character.description]);

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

  const handleDescSelect = useCallback(() => {
    const textarea = descTextareaRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value.substring(start, end);
      setSelection(text.trim() ? { text, start, end } : null);
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
    onModify(index, modifyInstruction.trim(), localDesc);
    setModifyInstruction('');
  };

  const handlePolishSelection = () => {
    if (!selection || isModifying) return;
    onUpdate({ description: localDesc });
    onPolishSelection(index, selection.text, localDesc, selection.start, selection.end);
    setSelection(null);
  };

  const borderColor = 'var(--color-border-default)';
  const surfaceBg = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.5)';
  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';

  return (
    <div className="rounded-xl border p-5 space-y-4" style={{ borderColor, backgroundColor: surfaceBg }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold" style={{ color: 'var(--text-color)' }}>
          {t('characters.characterIndex', { index: String(index + 1) })}{localName ? `: ${localName}` : ''}
        </h3>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <label className="inline-flex items-center gap-2 rounded-full border border-rose-500/25 bg-rose-500/10 px-2.5 py-1 text-xs cursor-pointer" title={character.nsfw ? t('characterEditor.nsfwAllowed') : t('characterEditor.nsfwDisabled')}>
            <span className="text-rose-200">{t('characterEditor.nsfwContent')}</span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={character.nsfw ?? false}
                onChange={(e) => onUpdate({ nsfw: e.target.checked })}
                className="sr-only peer"
              />
              <span className="w-8 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-rose-600" />
            </span>
          </label>
          {hasName && (
            <Button variant="secondary" size="sm" onClick={wrappedOnGenerate} disabled={isGenerating}>
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

      {/* Alignment selector */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer select-none text-xs font-medium mb-1.5 transition-colors hover:text-slate-300" style={{ color: mutedText }}>
          <span className="transition-transform group-open:rotate-90">&#x25B6;</span>
          {t('characterEditor.alignment')}
          <span style={{ color: faintText }}>{t('characterEditor.alignmentHint')}</span>
          {character.alignment && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-tint text-primary-bright border border-primary-tint-light">
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
                  ? 'border-primary-tint bg-primary-tint text-primary-bright'
                  : 'border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </details>

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

        {/* Selected text indicator */}
        {selection && hasDescription && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded border border-amber-700/30">
              {t('characterEditor.selectedChars', { count: String(selection.text.length) })}
            </span>
            <button
              onClick={handlePolishSelection}
              disabled={isModifying}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-800/30 text-amber-300 hover:bg-amber-700/40 transition-colors disabled:opacity-40"
            >
              {isModifying ? t('characterEditor.polishing') : t('characterEditor.polishSelected')}
            </button>
            <button
              onClick={() => setSelection(null)}
              className="text-[10px] hover:text-slate-300 transition-colors"
              style={{ color: faintText }}
            >
              {t('characterEditor.cancelSelection')}
            </button>
          </div>
        )}
      </div>

      {/* AI Streaming Preview */}
      {(isGenerating || streamingText) && (
        <div className="rounded-lg border border-purple-700/40 bg-purple-950/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-purple-300 flex items-center gap-2">
              {isGenerating && (
                <span className="inline-block w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
              )}
              {t('characterEditor.streamingOutputTitle')}
            </h4>
            <span className="text-[10px]" style={{ color: faintText }}>{streamingText.length} {t('common.words')}</span>
          </div>
          <div
            ref={streamPreviewRef}
            className="max-h-[300px] overflow-y-auto rounded p-3 border border-slate-800"
            style={{ backgroundColor: 'rgba(15, 23, 42, 0.6)', willChange: 'contents' }}
          >
            {streamingText ? (
              <pre className="text-[11px] text-purple-200/80 font-mono whitespace-pre-wrap leading-relaxed">
                {streamingText}
              </pre>
            ) : (
              <p className="text-[11px] italic" style={{ color: faintText }}>{t('characterEditor.streamingWaiting')}</p>
            )}
          </div>
          <p className="text-[10px] mt-2" style={{ color: faintText }}>{t('characterEditor.streamingHint')}</p>
        </div>
      )}

      {/* Action buttons row */}
      {hasDescription && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveCurrentAsVersion}
            className="text-[11px] px-2.5 py-1 rounded border transition-colors hover:text-slate-200 hover:border-slate-500"
            style={{ borderColor, color: mutedText }}
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
              className="text-[11px] px-2.5 py-1 rounded border border-primary-tint-light text-primary-muted hover:text-primary-bright hover:border-primary-tint transition-colors"
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
            <span className="text-[10px]" style={{ color: faintText }}>{t('characterEditor.modifyHint')}</span>
          </div>
          <textarea
            value={modifyInstruction}
            onChange={(e) => setModifyInstruction(e.target.value)}
            placeholder={t('characterEditor.modifyPlaceholder')}
            className="w-full h-16 rounded-lg border px-3 py-2 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-cyan-500"
            style={{
              borderColor,
              backgroundColor: 'var(--input-bg)',
              color: 'var(--text-color)',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleModify();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={handleModify} disabled={!modifyInstruction.trim() || isModifying}>
              {isModifying ? t('characterEditor.modifying') : t('characterEditor.modifyButton')}
            </Button>
            <span className="text-[10px]" style={{ color: faintText }}>{t('characterEditor.modifyShortcut')}</span>
          </div>
          <p className="text-[10px] leading-relaxed" style={{ color: faintText }}>{t('characterEditor.modifyDesc')}</p>
        </div>
      )}

      {/* Version History Panel */}
      {showHistory && hasHistory && (
        <div className="rounded-lg border p-3 space-y-2" style={{ borderColor, backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
              {t('characterEditor.versionHistory')}
            </h4>
            <span className="text-[10px]" style={{ color: faintText }}>{t('characterEditor.versionHistoryHint')}</span>
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
                      ? 'border-primary-tint bg-primary-tint-light'
                      : 'border-slate-700/50 bg-slate-800/30 hover:border-slate-600/50'
                  }`}
                >
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
                      <span className={`text-xs truncate ${isActive ? 'text-primary-bright' : 'text-slate-400'}`}>
                        {version.content.slice(0, 60)}{version.content.length > 60 ? '...' : ''}
                      </span>
                      <span className="text-[10px] shrink-0 ml-auto" style={{ color: faintText }}>
                        {formatTime(version.timestamp)}
                      </span>
                    </button>
                    <button
                      onClick={() => setExpandedVersionId(isExpanded ? null : version.id)}
                      className="text-[10px] shrink-0 px-1 hover:text-slate-300 transition-colors"
                      style={{ color: faintText }}
                      title={t('characterEditor.expandPreview')}
                    >
                      {isExpanded ? '\u25B2' : '\u25BC'}
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

                  {isExpanded && (
                    <div className="px-3 pb-2">
                      <div className="max-h-[200px] overflow-y-auto rounded p-2 border border-slate-800" style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                        <pre className="text-[11px] text-slate-400 font-mono whitespace-pre-wrap leading-relaxed">
                          {version.content}
                        </pre>
                      </div>
                      {!isActive && (
                        <button
                          onClick={() => handleSelectVersion(version)}
                          className="mt-1.5 text-[11px] px-2 py-1 rounded bg-primary-tint text-primary-bright hover:bg-primary-tint-strong transition-colors"
                        >
                          {t('characterEditor.useThisVersion')}
                        </button>
                      )}
                      {isActive && (
                        <span className="mt-1.5 inline-block text-[11px] text-primary-muted">
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
