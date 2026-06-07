/**
 * Step 1: Card Name + Tags.
 * Card name is the only field that cannot be AI-generated.
 * Tags are for frontend sorting/filtering (not used in AI prompts).
 * Now includes an AI Name Generator for inspiration.
 */
import { useState, useCallback } from 'react';
import { TextInput } from '../shared/TextInput';
import { TagInput } from '../shared/TagInput';
import { PresetPanel } from './PresetPanel';
import { Button } from '../shared/Button';
import { useAIGenerate } from '../../hooks/useAIGenerate';
import { useToast } from '../shared/Toast';

interface StepCardNameProps {
  cardName: string;
  tags: string[];
  onNameChange: (name: string) => void;
  onTagsChange: (tags: string[]) => void;
}

interface NameCandidate {
  name: string;
  style: string;
}

export function StepCardName({ cardName, tags, onNameChange, onTagsChange }: StepCardNameProps) {
  const { generateNames } = useAIGenerate();
  const { addToast } = useToast();
  const [generating, setGenerating] = useState(false);
  const [candidates, setCandidates] = useState<NameCandidate[]>([]);
  const [nameHint, setNameHint] = useState('');

  const handleGenerateNames = useCallback(async () => {
    setGenerating(true);
    setCandidates([]);
    try {
      const result = await generateNames(nameHint, tags.join(', '));
      if (result.length > 0) {
        setCandidates(result);
      } else {
        addToast('error', '未生成候选名字，请重试');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '生成失败';
      addToast('error', `AI 取名失败：${msg}`);
    } finally {
      setGenerating(false);
    }
  }, [generateNames, nameHint, tags, addToast]);

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

        {/* AI Name Generator */}
        <div className="mt-4 p-4 rounded-xl border border-slate-700 bg-slate-800/30">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-medium text-slate-300">✨ AI 取名</span>
            <span className="text-[10px] text-slate-500">生成候选名字供你选择</span>
          </div>
          <div className="flex gap-2 mb-3">
            <input
              className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
              value={nameHint}
              onChange={(e) => setNameHint(e.target.value)}
              placeholder="提示词（可选）：如“奇幻女法师”“赛博朋克黑客”"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateNames}
              disabled={generating}
            >
              {generating ? '⏳ 生成中...' : '🎲 AI 取名'}
            </Button>
          </div>
          {candidates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {candidates.map((c, i) => (
                <button
                  key={i}
                  onClick={() => { onNameChange(c.name); setCandidates([]); addToast('success', `已选择：${c.name}`); }}
                  className="px-3 py-1.5 rounded-lg border border-slate-600 bg-slate-800 text-sm text-slate-200 hover:border-indigo-500 hover:text-indigo-300 transition-colors"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[10px] text-slate-500 ml-1.5">{c.style}</span>
                </button>
              ))}
            </div>
          )}
        </div>
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

      {/* Preset import section */}
      <div className="border-t border-white/5 pt-6">
        <PresetPanel />
      </div>
    </div>
  );
}
