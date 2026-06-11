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
import type { WizardCharacter } from '../../constants/defaults';
import type { CharacterVersion } from '../../pages/WizardPage';

interface CharacterEditorProps {
  character: WizardCharacter;
  index: number;
  onUpdate: (updates: Partial<WizardCharacter>) => void;
  onRemove: () => void;
  onGenerate: (index: number) => void;
  onModify: (index: number, instructions: string) => void;
  onPolishSelection: (index: number, selectedText: string, fullText: string) => void;
  canRemove: boolean;
  isGenerating: boolean;
  isModifying: boolean;
  history: CharacterVersion[];
  onSelectVersion: (versionId: string) => void;
  onDeleteVersion: (versionId: string) => void;
  onSaveVersion: (content: string) => void;
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
}: CharacterEditorProps) {
  const [localName, setLocalName] = useState(character.name ?? '');
  const [localDesc, setLocalDesc] = useState(character.description ?? '');
  const [showHistory, setShowHistory] = useState(false);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [showModifyPanel, setShowModifyPanel] = useState(false);
  const [modifyInstruction, setModifyInstruction] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const descTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { setLocalName(character.name ?? ''); }, [character.name]);
  useEffect(() => { setLocalDesc(character.description ?? ''); }, [character.description]);

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
    // Sync current description first
    onUpdate({ description: localDesc });
    onModify(index, modifyInstruction.trim());
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
          角色 {index + 1}{localName ? `: ${localName}` : ''}
        </h3>
        <div className="flex items-center gap-2">
          {hasName && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onGenerate(index)}
              disabled={isGenerating}
            >
              {isGenerating ? '生成中...' : 'AI 生成'}
            </Button>
          )}
          {canRemove && (
            <Button variant="danger" size="sm" onClick={onRemove} disabled={isGenerating}>
              移除
            </Button>
          )}
        </div>
      </div>

      {/* Fields */}
      <TextInput
        label="角色名称"
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={(e) => onUpdate({ name: e.target.value })}
        placeholder="输入角色名称"
      />

      <div>
        <TextArea
          label="角色设定（AI 将基于此扩展生成）"
          value={localDesc}
          onChange={(e) => setLocalDesc(e.target.value)}
          onBlur={(e) => onUpdate({ description: e.target.value })}
          placeholder="写给 AI 的约束指令，如角色核心设定、行为准则、关系要求等。AI 会在此基础上扩展联想，生成完整的角色描述和世界书条目。"
          rows={4}
          textareaRef={descTextareaRef}
          onSelect={handleDescSelect}
        />

        {/* Show selected text indicator */}
        {selectedText && hasDescription && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="text-[10px] text-amber-400 bg-amber-900/20 px-2 py-0.5 rounded border border-amber-700/30">
              已选中 {selectedText.length} 字
            </span>
            <button
              onClick={handlePolishSelection}
              disabled={isModifying}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-800/30 text-amber-300 hover:bg-amber-700/40 transition-colors disabled:opacity-40"
            >
              {isModifying ? 'AI 处理中...' : 'AI 润色选中'}
            </button>
            <button
              onClick={() => setSelectedText('')}
              className="text-[10px] text-slate-500 hover:text-slate-300"
            >
              取消选中
            </button>
          </div>
        )}
      </div>

      {/* Action buttons row */}
      {hasDescription && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveCurrentAsVersion}
            className="text-[11px] px-2.5 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
          >
            保存当前为新版本
          </button>
          <button
            onClick={() => setShowModifyPanel(!showModifyPanel)}
            className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
              showModifyPanel
                ? 'border-cyan-500/50 text-cyan-300 bg-cyan-900/20'
                : 'border-cyan-600/30 text-cyan-400 hover:text-cyan-300 hover:border-cyan-500/50'
            }`}
          >
            {showModifyPanel ? '收起局部修改' : 'AI 局部修改'}
          </button>
          {hasHistory && (
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-[11px] px-2.5 py-1 rounded border border-indigo-600/40 text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/60 transition-colors"
            >
              {showHistory ? '收起版本历史' : `版本历史 (${history.length})`}
            </button>
          )}
        </div>
      )}

      {/* AI Partial Modification Panel */}
      {showModifyPanel && hasDescription && (
        <div className="rounded-lg border border-cyan-700/40 bg-cyan-950/15 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-cyan-300">AI 局部修改</h4>
            <span className="text-[10px] text-slate-500">描述修改意图，AI 会保留其他内容不变</span>
          </div>
          <textarea
            value={modifyInstruction}
            onChange={(e) => setModifyInstruction(e.target.value)}
            placeholder={"例如：在性格部分添加\"怕黑\"和\"喜欢猫\"的属性\n例如：把外貌描述润色得更有画面感\n例如：补充角色和{{user}}的过往纠葛\n例如：把背景设定改成赛博朋克风格"}
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
              {isModifying ? 'AI 修改中...' : '执行修改'}
            </Button>
            <span className="text-[10px] text-slate-500">Ctrl+Enter 快捷执行</span>
          </div>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            与"AI 生成"不同，局部修改会在现有描述基础上做定向修改，不会重写整个角色描述。
            修改结果会自动保存到版本历史中，可随时回退。
          </p>
        </div>
      )}

      {/* Version History Panel */}
      {showHistory && hasHistory && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-semibold text-slate-300">版本历史</h4>
            <span className="text-[10px] text-slate-500">点击版本可切换，展开可预览对比</span>
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
                        {version.isOriginal ? '原始' : `v${vIndex}`}
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
                      title="展开预览"
                    >
                      {isExpanded ? '▲' : '▼'}
                    </button>
                    {!version.isOriginal && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeleteVersion(version.id); }}
                        className="text-[10px] text-red-400/60 hover:text-red-400 shrink-0 px-1"
                        title="删除此版本"
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
                          使用此版本
                        </button>
                      )}
                      {isActive && (
                        <span className="mt-1.5 inline-block text-[11px] text-indigo-400">
                          当前使用中
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
