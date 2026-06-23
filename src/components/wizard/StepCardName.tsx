/**
 * Step 1: Card Name + Tags.
 * Card name is the only field that cannot be AI-generated.
 * Tags are for frontend sorting/filtering (not used in AI prompts).
 */
import { TextInput } from '../shared/TextInput';
import { TagInput } from '../shared/TagInput';
import { useTranslation } from '../../i18n/I18nContext';

interface StepCardNameProps {
  cardName: string;
  tags: string[];
  onNameChange: (name: string) => void;
  onTagsChange: (tags: string[]) => void;
}

export function StepCardName({ cardName, tags, onNameChange, onTagsChange }: StepCardNameProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-2">{t('cardName.title')}</h2>
        <p className="text-sm text-slate-400 mb-6">
          {t('cardName.description')}
        </p>
        <TextInput
          label={t('cardName.nameLabel')}
          value={cardName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('cardName.namePlaceholder')}
          autoFocus
        />
      </div>

      <div className="border-t border-white/5 pt-6">
        <h3 className="text-lg font-semibold text-white mb-2">{t('cardName.tagsTitle')}</h3>
        <p className="text-xs text-slate-400 mb-2">
          {t('cardName.tagsDesc')}
        </p>
        <TagInput
          tags={tags}
          onChange={onTagsChange}
          placeholder={t('cardName.tagsPlaceholder')}
        />
      </div>
    </div>
  );
}
