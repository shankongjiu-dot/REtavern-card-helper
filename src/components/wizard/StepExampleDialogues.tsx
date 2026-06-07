/**
 * Step 5: Example Dialogues (optional).
 * Shows the AI how the character speaks. Uses <START>, {{user}}, and actual character names.
 * Supports AI generation with real-time streaming progress.
 */
import { useState, useCallback } from 'react';
import { TextArea } from '../shared/TextArea';
import { Button } from '../shared/Button';
import { AIProgressPanel, type AIProgressStatus } from '../shared/AIProgressPanel';
import { useAIGenerate } from '../../hooks/useAIGenerate';

interface StepExampleDialoguesProps {
  exampleDialogues: string;
  cardName: string;
  characterDescriptions: string;
  onChange: (dialogues: string) => void;
}

export function StepExampleDialogues({ exampleDialogues, cardName, characterDescriptions, onChange }: StepExampleDialoguesProps) {
  const { generateExampleDialoguesStreaming } = useAIGenerate();
  const [aiStatus, setAiStatus] = useState<AIProgressStatus>('idle');
  const [aiText, setAiText] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);

  const handleStreamGenerate = useCallback(async () => {
    setAiStatus('generating');
    setAiText('');
    setAiError(null);
    setPendingResult(null);

    try {
      const fullText = await generateExampleDialoguesStreaming(
        cardName,
        characterDescriptions,
        (chunk) => {
          setAiText((prev) => prev + chunk);
        },
      );
      setAiStatus('done');
      setPendingResult(fullText);
    } catch (err: unknown) {
      setAiStatus('error');
      setAiError(err instanceof Error ? err.message : '生成失败');
    }
  }, [cardName, characterDescriptions, generateExampleDialoguesStreaming]);

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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">示例对话 <span className="text-sm font-normal text-slate-500">（可选）</span></h2>
          <p className="text-sm text-slate-400 mt-1">
            示例对话可以教会 AI 角色的说话方式。用 {'<START>'} 分隔不同的对话组。
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

      {/* AI Progress Panel */}
      {aiStatus !== 'idle' && (
        <div className="mb-4">
          <AIProgressPanel
            status={aiStatus}
            text={aiText}
            error={aiError}
            title="AI 示例对话生成"
            onClear={handleClear}
          />
        </div>
      )}

      <TextArea
        value={exampleDialogues}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`<START>\n{{user}}: Hello there!\n角色名: *looks up* Oh, greetings. I didn't expect company.\n\n<START>\n{{user}}: Tell me about yourself.\n角色名: *sighs* It's a long story...`}
        rows={12}
        className="font-mono"
      />
      <p className="mt-2 text-xs text-slate-500">
        格式：每组对话以 {'<START>'} 开头，然后 {'{{user}}'}: 消息，角色名: 回复（用角色设定名称，不要用 {'{{char}}'}）。写 2-3 组简短对话。
      </p>
    </div>
  );
}