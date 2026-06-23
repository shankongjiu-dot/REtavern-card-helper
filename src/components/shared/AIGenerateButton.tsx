/**
 * AI Generate Button - triggers AI generation with loading state and preview.
 * Directly generates on click (no hint modal), shows loading spinner.
 *
 * @deprecated Use AIProgressPanel + streaming pattern instead.
 * This component uses non-streaming generation and shows results in a modal.
 * New components should use useAIGenerate streaming variants with AIProgressPanel
 * for real-time progress display (see CharacterEditor, StepFirstMessage).
 */
import { useState } from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { useTranslation } from '../../i18n/I18nContext';

interface AIGenerateButtonProps {
  /** Label displayed on the button */
  label?: string;
  /** Hint passed to the generate function (can be empty) */
  hint?: string;
  /** Called when user triggers generation. Returns the generated text. */
  onGenerate: (hint: string) => Promise<string>;
  /** Called when user accepts the generated result */
  onAccept: (result: string) => void;
}

export function AIGenerateButton({
  label,
  hint = '',
  onGenerate,
  onAccept,
}: AIGenerateButtonProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const text = await onGenerate(hint);
      setResult(text);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('ai.generateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = () => {
    if (result) onAccept(result);
    setResult(null);
  };

  const handleReject = () => {
    setResult(null);
  };

  return (
    <>
      {/* Main button */}
      <Button
        variant="secondary"
        size="sm"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? (
          <span className="flex items-center gap-1">
            <span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
            {t('ai.generating')}
          </span>
        ) : (
          label ?? t('ai.generate')
        )}
      </Button>

      {/* Error display */}
      {error && (
        <div className="text-xs text-red-400 mt-1">{error}</div>
      )}

      {/* Result preview modal */}
      <Modal isOpen={!!result} onClose={handleReject} title={t('ai.resultTitle')} maxWidth="max-w-2xl">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg bg-slate-900 border border-slate-700 p-4 max-h-[400px] overflow-y-auto">
            <pre className="text-sm text-slate-200 whitespace-pre-wrap font-mono">{result}</pre>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleReject}>{t('ai.discard')}</Button>
            <Button variant="secondary" onClick={handleGenerate} disabled={loading}>
              {loading ? t('ai.regenerating') : t('common.regenerate')}
            </Button>
            <Button onClick={handleAccept}>{t('ai.accept')}</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
