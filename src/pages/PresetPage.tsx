/**
 * PresetPage - Standalone preset management page.
 * Import and manage SillyTavern prompt presets for AI generation guidance.
 */
import { useState, useRef, useCallback } from 'react';
import { Button } from '../components/shared/Button';
import {
  importPresetFile,
  loadSavedPreset,
  clearSavedPreset,
  togglePresetPrompt,
  type LoadedPreset,
} from '../services/preset-service';

export function PresetPage() {
  const [preset, setPreset] = useState<LoadedPreset | null>(() => loadSavedPreset());
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(async () => {
    fileRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const loaded = await importPresetFile(file);
      setPreset(loaded);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, []);

  const handleClear = useCallback(() => {
    clearSavedPreset();
    setPreset(null);
  }, []);

  const handleToggle = useCallback((index: number) => {
    const updated = togglePresetPrompt(index);
    setPreset(updated);
  }, []);

  const enabledCount = preset?.prompts.filter(p => p.enabled).length ?? 0;

  const typeLabel = (type: string) => {
    switch (type) {
      case 'example': return <span className="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-300">示例对话</span>;
      case 'jailbreak': return <span className="text-xs px-2 py-0.5 rounded bg-amber-900/30 text-amber-300">突破规则</span>;
      default: return <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-400">系统提示</span>;
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 animate-fade-in">
      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header */}
      <div className="mb-6 animate-slide-up">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-indigo-600/20 animate-pulse-slow">
            <span className="text-xl">📋</span>
          </div>
          <h1 className="text-2xl font-bold text-white">写卡预设管理</h1>
        </div>
        <p className="text-sm text-slate-400 ml-11">
          导入 SillyTavern 预设文件，提取规则作为 AI 生成时的文风和写作指导
        </p>
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 animate-slide-up animation-delay-100">
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 group"
        >
          <span className="text-lg transition-transform group-hover:rotate-12">📂</span>
          {importing ? '导入中...' : preset ? '更换预设' : '导入预设文件'}
        </Button>
        {preset && (
          <Button 
            variant="danger" 
            onClick={handleClear}
            className="group hover:scale-105 transition-transform"
          >
            <span className="mr-1 group-hover:animate-bounce">✕</span>
            清除当前预设
          </Button>
        )}
        {preset && (
          <span className="text-sm text-slate-400 animate-badge-pop">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-900/50 text-indigo-300">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
              已启用 {enabledCount}/{preset.prompts.length} 条规则
            </span>
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-700/50 animate-shake">
          <div className="flex items-center gap-2">
            <span className="text-red-400">⚠️</span>
            <p className="text-sm text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!preset && !error && (
        <div className="p-8 rounded-xl border border-dashed border-slate-700 bg-slate-800/20 text-center animate-fade-in-up">
          <div className="relative inline-block mb-4">
            <div className="text-6xl animate-float">📋</div>
            <div className="absolute -top-2 -right-2 text-2xl animate-bounce">✨</div>
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">暂无预设</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            导入酒馆 .json 预设文件，提取其中的规则作为 AI 生成时的文风和写作指导。
            支持 SillyTavern 标准预设格式、system_prompt 格式等。
          </p>
          <div className="mt-6 p-4 rounded-lg bg-slate-900/50 text-left text-xs text-slate-500 max-w-md mx-auto animate-slide-up animation-delay-200">
            <p className="font-medium text-slate-400 mb-2">支持的预设格式：</p>
            <ul className="list-disc list-inside space-y-1">
              <li className="hover:text-slate-300 transition-colors cursor-default">SillyTavern 标准预设 (.json)</li>
              <li className="hover:text-slate-300 transition-colors cursor-default">system_prompt 格式</li>
              <li className="hover:text-slate-300 transition-colors cursor-default">包含 prompts 数组的 JSON 文件</li>
            </ul>
          </div>
        </div>
      )}

      {/* Preset info + rule list */}
      {preset && (
        <div className="space-y-4 animate-fade-in-up">
          {/* Preset info */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 flex items-center justify-center">
                  <span className="text-sm">📁</span>
                </div>
                <h3 className="font-semibold text-white">{preset.fileName}</h3>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-slate-700/50 text-slate-300">
                共 {preset.prompts.length} 条规则
              </span>
            </div>
            {preset.description && (
              <p className="text-sm text-slate-400 ml-10">{preset.description}</p>
            )}
          </div>

          {/* Rule list */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
              <span className="w-1 h-4 rounded-full bg-indigo-500"></span>
              预设规则
            </h4>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/20 overflow-hidden backdrop-blur-sm">
              {preset.prompts.map((p, i) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-3 px-4 py-3 border-b border-slate-700/30 last:border-b-0
                    ${p.enabled ? '' : 'opacity-50'}
                    transition-all duration-300 hover:bg-slate-700/20 animate-slide-in-left`}
                  style={{ animationDelay: `${i * 50}ms` }}
                >
                  <label className="relative cursor-pointer">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={() => handleToggle(i)}
                      className="sr-only"
                    />
                    <div className={`w-5 h-5 rounded border-2 transition-all duration-300 ${
                      p.enabled 
                        ? 'bg-indigo-600 border-indigo-500 shadow-lg shadow-indigo-500/30' 
                        : 'bg-slate-800 border-slate-600'
                    }`}>
                      {p.enabled && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <svg className="w-3 h-3 text-white animate-checkmark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                      )}
                    </div>
                  </label>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`font-medium truncate transition-colors ${p.enabled ? 'text-white' : 'text-slate-500'}`}>
                        {p.name}
                      </span>
                      {typeLabel(p.type)}
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-2">
                      {p.content}
                    </p>
                  </div>
                  <span className="text-xs text-slate-600 shrink-0 transition-colors hover:text-slate-400">
                    {p.content.length} 字
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Tips */}
          <div className="p-4 rounded-lg bg-gradient-to-br from-indigo-900/30 to-purple-900/20 border border-indigo-700/30 backdrop-blur-sm animate-fade-in-up animation-delay-300">
            <div className="flex items-start gap-2">
              <span className="text-lg mt-0.5">💡</span>
              <div>
                <h4 className="text-sm font-medium text-indigo-300 mb-2">使用提示</h4>
                <ul className="text-xs text-slate-400 space-y-1">
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>启用的规则会在 AI 生成时自动注入到提示词中</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>建议保持启用规则数量在 3-5 条，避免 Token 消耗过大</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>"示例对话"类型的规则对角色对话风格影响较大</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-indigo-400">•</span>
                    <span>预设会自动保存到本地存储，刷新页面不会丢失</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
