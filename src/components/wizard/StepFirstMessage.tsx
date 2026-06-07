/**
 * Step 4: First Message - the character's opening message.
 * Supports AI generation with real-time streaming progress and word count control.
 */
import { useState, useCallback } from 'react';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { useAIGenerate } from '../../hooks/useAIGenerate';

interface StepFirstMessageProps {
  firstMessage: string;
  cardName: string;
  characterDescriptions: string;
  onChange: (message: string) => void;
}

const WORD_COUNT_PRESETS = [
  { label: '不限', value: 0 },
  { label: '200 字', value: 200 },
  { label: '500 字', value: 500 },
  { label: '800 字', value: 800 },
  { label: '1200 字', value: 1200 },
];

export function StepFirstMessage({ firstMessage, cardName, characterDescriptions, onChange }: StepFirstMessageProps) {
  const { generateFirstMessageStreaming } = useAIGenerate();
  const [aiStatus, setAiStatus] = useState<AIProgressStatus>('idle');
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const [targetWordCount, setTargetWordCount] = useState(0);

  const handleStreamGenerate = useCallback(async () => {
    setAiStatus('generating');
    setAiText('');
    setAiError(null);
    setPendingResult(null);

    try {
      const fullText = await generateFirstMessageStreaming(
        cardName,
        characterDescriptions,
        '', // no scene hint for quick generate
        (chunk) => {
          setAiText((prev) => prev + chunk);
        },
        targetWordCount || undefined,
      );
      setAiStatus('done');
      setPendingResult(fullText);
    } catch (err: unknown) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : '生成失败');
    }
  }, [cardName, characterDescriptions, generateFirstMessageStreaming, targetWordCount]);

  const handleAccept = useCallback(() => {
    if (pendingResult) {
      onChange(pendingResult);
      setPendingResult(null);
    }
    setAiStatus('idle');
    setAiText('');
  }, [pendingResult, onChange]);

  const handleReject = useCallback(() => {
    setPendingResult(null);
    setAiStatus('idle');
    setAiText('');
  }, []);

  const handleClear = useCallback(() => {
    setAiStatus('idle');
    setAiText('');
    setAiError(null);
    setPendingResult(null);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-white">开场白</h2>
          <p className="text-sm text-slate-400 mt-1">
            角色在对话开始时发出的第一条消息。可用 {'{{user}}'} 作为用户占位符，角色直接使用设定名称。
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleStreamGenerate}
            disabled={aiStatus === 'generating'}
          >
            {aiStatus === 'generating' ? '⏳ 生成中...' : '✨ AI 生成'}
          </Button>
          {pendingResult && (
            <>
              <Button size="sm" onClick={handleAccept}>✅ 采纳</Button>
              <Button size="sm" variant="ghost" onClick={handleReject}>丢弃</Button>
            </>
          )}
        </div>
      </div>

      {/* Word count presets */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-slate-400 shrink-0">目标字数：</span>
        <div className="flex flex-wrap gap-1.5">
          {WORD_COUNT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              onClick={() => setTargetWordCount(preset.value)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                targetWordCount === preset.value
                  ? 'bg-indigo-600/30 border-indigo-500/50 text-indigo-300'
                  : 'border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI Progress Panel */}
      {aiStatus !== 'idle' && (
        <div className="mb-4">
          <AIProgressPanel
            status={aiStatus}
            text={aiText}
            error={aiError}
            title="AI 开场白生成"
            onClear={handleClear}
          />
        </div>
      )}

      <TextArea
        value={firstMessage}
        onChange={(e) => onChange(e.target.value)}
        placeholder="角色名缓缓睁开眼睛，冰冷的石板地面贴在背上..."
        rows={10}
        className="font-mono"
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-slate-500">
          提示：好的开场白通常设置场景、包含感官细节，并给用户一个回应的钩子。
        </p>
        {firstMessage && (
          <span className="text-xs text-slate-500 shrink-0 ml-4">
            当前 {firstMessage.length} 字
          </span>
        )}
      </div>
    </div>
  );
}
