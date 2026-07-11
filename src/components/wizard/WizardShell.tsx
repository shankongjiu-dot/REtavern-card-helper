/**
 * WizardShell - Step indicator bar with Previous/Next navigation.
 * Wraps wizard step content and handles step transitions.
 * Mobile: scrollable step indicator, stacked navigation buttons.
 */
import { WIZARD_STEPS } from '../../constants/defaults';
import { Button } from '../shared/Button';
import { Check } from 'lucide-react';
import { useTranslation } from '../../i18n/I18nContext';
import { themeAlpha } from '../../constants/theme';

interface WizardShellProps {
  currentStep: number;
  onPrev: () => void;
  onNext: () => void;
  onSave: () => void;
  onSaveDraft?: () => void;
  onClear?: () => void;
  onClearStep?: () => void;
  stepError: string | null;
  saving: boolean;
  extraActions?: React.ReactNode;
  hideBottomNav?: boolean;
  children: React.ReactNode;
}

export function WizardShell({ currentStep, onPrev, onNext, onSave, onSaveDraft, onClear, onClearStep, stepError, saving, extraActions, hideBottomNav, children }: WizardShellProps) {
  const { t } = useTranslation();
  const isFirst = currentStep === 1;
  const isLast = currentStep === WIZARD_STEPS.length;
  const stepKeys = ['wizard.stepName','wizard.stepCharacters','wizard.stepWorldBook','wizard.stepMvu','wizard.stepStagedMode','wizard.stepFirstMessage','wizard.stepExport'];
  const borderColor = 'color-mix(in srgb, var(--text-color) 5%, transparent)';

  return (
    <div>
      {/* Step indicator bar */}
      <div className="mb-4 sm:mb-8">
        <div className="overflow-x-auto scrollbar-none -mx-3 sm:mx-0 px-3 sm:px-0 pb-2 sm:pb-0">
          <div className="flex items-center justify-between min-w-[420px] sm:min-w-0">
            {WIZARD_STEPS.map((step, i) => {
              const isCompleted = step.id < currentStep;
              const isCurrent = step.id === currentStep;

              return (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-semibold transition-all duration-300
                        ${isCurrent
                          ? 'bg-gradient-primary text-inverse shadow-lg shadow-primary-glow scale-110'
                          : isCompleted
                            ? 'bg-gradient-success text-inverse shadow-md'
                            : 'text-[var(--color-text-muted)]'
                        }`}
                      style={!isCurrent && !isCompleted ? { backgroundColor: 'color-mix(in srgb, var(--color-surface-elevated) 60%, transparent)' } : undefined}
                    >
                      {isCompleted ? <Check size={12} strokeWidth={3} /> : step.id}
                    </div>
                    <span
                      className={`mt-1 sm:mt-1.5 text-[10px] sm:text-[11px] font-medium whitespace-nowrap transition-colors duration-200 ${isCurrent ? 'text-primary-bright' : ''}`}
                      style={{ color: isCurrent ? undefined : isCompleted ? 'color-mix(in srgb, var(--color-status-success) 70%, transparent)' : 'var(--color-text-muted)' }}
                    >
                      {t(stepKeys[step.id - 1])}
                    </span>
                  </div>
                  {i < WIZARD_STEPS.length - 1 && (
                    <div
                      className="flex-1 h-[2px] mx-1.5 sm:mx-2 min-w-[12px] sm:min-w-[16px] rounded-full transition-colors duration-500"
                      style={{ backgroundColor: isCompleted ? themeAlpha('success', 50) : 'color-mix(in srgb, var(--color-border-default) 40%, transparent)' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <p className="md:hidden text-center text-xs mt-1" style={{ color: 'color-mix(in srgb, var(--text-color) 40%, transparent)' }}>
          {t('wizard.stepIndicator', { current: String(currentStep), total: String(WIZARD_STEPS.length) })}
        </p>
      </div>

      {/* Step content */}
      <div className="min-h-[200px] sm:min-h-[280px]">
        {children}
      </div>

      {/* Error display */}
      {stepError && (
        <div
          className="mt-3 rounded-lg px-4 py-2.5 text-sm animate-scale-in"
          style={{ backgroundColor: themeAlpha('danger', 20), border: `1px solid ${themeAlpha('danger', 30)}`, color: 'var(--color-status-danger)' }}
        >
          {stepError}
        </div>
      )}

      {/* Navigation buttons */}
      {!hideBottomNav && (
        <div className="mt-3 sm:mt-5 flex flex-col sm:flex-row justify-between gap-3 pt-3 sm:pt-4" style={{ borderTop: `1px solid ${borderColor}` }}>
          <Button variant="ghost" onClick={onPrev} disabled={isFirst} className="w-full sm:w-auto">
            &larr; {t('common.previous')}
          </Button>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-3 sm:flex-wrap sm:justify-end">
            {onClear && (
              <Button variant="ghost" onClick={onClear} disabled={saving}>
                {t('wizard.clearDraft')}
              </Button>
            )}
            {onClearStep && (
              <Button variant="ghost" onClick={onClearStep} disabled={saving}>
                {t('wizard.clearCurrentStep')}
              </Button>
            )}
            {onSaveDraft && (
              <Button variant="secondary" onClick={() => onSaveDraft()} disabled={saving}>
                {t('wizard.saveDraft')}
              </Button>
            )}
            {extraActions}
            {isLast ? (
              <Button onClick={onSave} disabled={saving}>
                {saving ? t('common.saving') : t('wizard.saveCard')}
              </Button>
            ) : (
              <Button onClick={onNext}>
                {t('common.next')} &rarr;
              </Button>
            )}
          </div>
        </div>
      )}
      {hideBottomNav && (
        <div className="mt-3 sm:mt-5 flex justify-start pt-3 sm:pt-4" style={{ borderTop: `1px solid ${borderColor}` }}>
          <Button variant="ghost" onClick={onPrev} disabled={isFirst}>
            &larr; {t('common.previous')}
          </Button>
        </div>
      )}
    </div>
  );
}
