/**
 * Step 1: Card Name + Tags.
 * Card name is the only field that cannot be AI-generated.
 * Tags are for frontend sorting/filtering (not used in AI prompts).
 */
import { TextInput } from '../shared/TextInput';
import { TagInput } from '../shared/TagInput';

interface StepCardNameProps {
  cardName: string;
  tags: string[];
  onNameChange: (name: string) => void;
  onTagsChange: (tags: string[]) => void;
}

export function StepCardName({ cardName, tags, onNameChange, onTagsChange }: StepCardNameProps) {
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-2">卡片名称</h2>
        <p className="text-sm text-slate-400 mb-6">
          为你的角色卡起一个名字，用于在卡片库中显示和搜索。
        </p>
        <TextInput
          label="卡片名称"
          value={cardName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="例如：神秘的流浪者"
          autoFocus
        />
      </div>

      <div className="border-t border-white/5 pt-6">
        <h3 className="text-lg font-semibold text-white mb-2">卡片标签（可选）</h3>
        <p className="text-xs text-slate-400 mb-2">
          用于分类和筛选，不会出现在 AI 提示词中。
        </p>
        <TagInput
          tags={tags}
          onChange={onTagsChange}
          placeholder="例如：奇幻、校园、魔法..."
        />
      </div>
    </div>
  );
}
