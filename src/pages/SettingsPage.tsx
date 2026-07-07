/**
 * SettingsPage - API configuration page.
 * Features: API URL presets, API key management, model selection, parameters.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { getAISettings, saveAISettings, maskApiKey, type AISettings } from '../db/database';
import { fetchModels } from '../services/ai-service';
import { useToast } from '../components/shared/Toast';
import { Button } from '../components/shared/Button';
import { useTranslation } from '../i18n/I18nContext';

export function SettingsPage() {
  const { t } = useTranslation();
  const { addToast } = useToast();

  const presets = [
    { label: 'OpenAI', url: 'https://api.openai.com/v1' },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
    { label: 'DeepSeek', url: 'https://api.deepseek.com' },
    { label: '火山方舟', url: 'https://ark.cn-beijing.volces.com/api/v3' },
    { label: t('settings.localOobabooga'), url: 'http://127.0.0.1:5000/v1' },
    { label: t('settings.localKoboldCPP'), url: 'http://127.0.0.1:5001/v1' },
  ];
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [modelList, setModelList] = useState<Array<{ id: string; owned_by: string }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [editingKey, setEditingKey] = useState(false);
  const [tempKey, setTempKey] = useState('');

  useEffect(() => {
    getAISettings().then((s) => {
      setSettings(s);
      setTempKey(s.apiKey);
    }).catch((err) => {
      console.error('Failed to load AI settings:', err);
    });
  }, []);

  const lastFetchedUrlRef = useRef<string>('');
  useEffect(() => {
    if (lastFetchedUrlRef.current && lastFetchedUrlRef.current !== settings?.apiUrl) {
      setModelList([]);
      // URL 切换后，旧 Key 可能不适用于新渠道，重置验证状态并解锁输入框
      if (settings?.keyVerified) {
        const updated = { ...settings, keyVerified: false };
        setSettings(updated);
        setEditingKey(true);
      }
    }
  }, [settings?.apiUrl]);

  const handleFetchModels = useCallback(async () => {
    if (!settings) return;
    const url = settings.apiUrl.trim();
    const key = (settings.keyVerified && !editingKey ? settings.apiKey : tempKey).trim();
    if (!url) {
      addToast('error', t('settings.urlRequired'));
      return;
    }
    setFetchingModels(true);
    try {
      const models = await fetchModels(url, key);
      setModelList(models);
      lastFetchedUrlRef.current = url;
      if (models.length > 0) {
        const currentInList = models.some((m) => m.id === settings.model);
        const modelToSave = currentInList ? settings.model : models[0].id;
        const updated = await saveAISettings({
          apiUrl: url,
          apiKey: key,
          model: modelToSave,
          keyVerified: true,
        });
        setSettings(updated);
        setEditingKey(false);
        addToast('success', `${t('settings.fetchSuccess', { count: String(models.length) })}${currentInList ? '' : t('settings.autoSelected')}`);
      } else {
        addToast('error', t('settings.noModels'));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('settings.fetchFailed');
      addToast('error', msg);
    } finally {
      setFetchingModels(false);
    }
  }, [settings, tempKey, editingKey, addToast, t]);

  const handleUnlockKey = () => {
    setTempKey(settings?.apiKey || '');
    setEditingKey(true);
  };

  const handlePresetClick = (url: string) => {
    if (settings) setSettings({ ...settings, apiUrl: url });
  };

  const handleSaveSettings = async (patch: Partial<AISettings>) => {
    if (!settings) return;
    const updated = await saveAISettings(patch);
    setSettings(updated);
    addToast('success', t('settings.saveSuccess'));
  };

  const keyIsLocked = settings?.keyVerified && !editingKey;

  const mutedText = 'color-mix(in srgb, var(--text-color) 60%, transparent)';
  const faintText = 'color-mix(in srgb, var(--text-color) 40%, transparent)';
  const borderColor = 'var(--color-border-default)';
  const surfaceBg = 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.5)';
  const inputBg = 'var(--input-bg)';

  if (!settings) {
    return (
      <div className="animate-fade-in flex items-center justify-center h-[calc(100dvh-4rem)]">
        <p style={{ color: mutedText }}>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-color)' }}>{t('settings.title')}</h1>
        <p className="text-sm mt-1" style={{ color: mutedText }}>{t('settings.subtitle')}</p>
      </div>

      {/* Settings Card */}
      <div className="rounded-xl border p-6 space-y-6" style={{ borderColor, backgroundColor: surfaceBg }}>
        {/* Row 1: API URL + Presets */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
            {t('settings.apiUrl')}
          </label>
          <input
            className="w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
            style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
            value={settings.apiUrl}
            onChange={(e) => setSettings({ ...settings, apiUrl: e.target.value })}
            placeholder="https://api.openai.com/v1"
          />
          <p className="text-[11px] mt-0.5" style={{ color: faintText }}>{t('settings.apiUrlHint')}</p>
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => handlePresetClick(p.url)}
                className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors
                  ${settings.apiUrl === p.url
                    ? 'border-primary-tint bg-primary-tint text-primary-bright'
                    : 'border-slate-600 bg-slate-700/50 text-slate-400 hover:border-slate-500 hover:text-slate-300'
                  }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: API Key */}
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
            {t('settings.apiKey')}
          </label>
          {keyIsLocked ? (
            <div className="flex items-center gap-2">
              <div
                className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono select-none"
                style={{ borderColor, backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.6)', color: mutedText }}
              >
                🔒 {maskApiKey(settings.apiKey)}
              </div>
              <button
                onClick={handleUnlockKey}
                className="text-xs text-primary-muted hover:text-primary-bright px-2 py-1 rounded border border-slate-600 hover:border-primary-tint transition-colors"
              >
                ✏️ {t('common.edit')}
              </button>
            </div>
          ) : (
            <input
              type="password"
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
              value={tempKey}
              onChange={(e) => setTempKey(e.target.value)}
              placeholder={t('settings.keyPlaceholder')}
            />
          )}
        </div>

        {/* Row 3: Model + Fetch */}
        <div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
                {t('settings.model')}
              </label>
              {modelList.length > 0 ? (
                <select
                  value={settings.model}
                  onChange={(e) => handleSaveSettings({ model: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
                >
                  {modelList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}{m.owned_by ? ` (${m.owned_by})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
                  style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
                  value={settings.model}
                  onChange={(e) => setSettings({ ...settings, model: e.target.value })}
                  placeholder={t('settings.modelPlaceholder')}
                />
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handleFetchModels} disabled={fetchingModels} className="shrink-0">
              {fetchingModels ? `⏳ ${t('settings.fetching')}` : `🔄 ${t('settings.fetchModels')}`}
            </Button>
          </div>
          {modelList.length > 0 && (
            <p className="text-[11px] mt-1" style={{ color: faintText }}>
              {t('settings.fetchSuccess', { count: String(modelList.length) })} · {t('settings.keyHidden')}
            </p>
          )}
        </div>

        {/* Row 4: Temperature + Max Tokens + Retry */}
        <div className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
              {t('settings.temperatureLabel')}: <span className="text-primary-muted">{settings.temperature.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
              className="w-full accent-[var(--color-primary)]"
            />
            <div className="flex justify-between text-[10px]" style={{ color: faintText }}>
              <span>{t('settings.precision')}</span>
              <span>{t('settings.creative')}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
              {t('settings.maxTokensLabel')}
            </label>
            <input
              type="number"
              min={100}
              max={300000}
              step={100}
              value={settings.maxTokens}
              onChange={(e) => setSettings({ ...settings, maxTokens: parseInt(e.target.value) || 4000 })}
              className="rounded-lg border px-3 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
            />
            <p className="text-[10px]" style={{ color: faintText }}>{t('settings.maxTokensHint')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
              {t('settings.retryCountLabel')} <span style={{ color: faintText }}>({settings.retryCount ?? 3})</span>
            </label>
            <input
              type="number"
              min={0}
              max={10}
              step={1}
              value={settings.retryCount ?? 3}
              onChange={(e) => setSettings({ ...settings, retryCount: parseInt(e.target.value) || 0 })}
              className="rounded-lg border px-3 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
              style={{ borderColor, backgroundColor: inputBg, color: 'var(--text-color)' }}
            />
            <p className="text-[10px]" style={{ color: faintText }}>{t('settings.retryHint')}</p>
          </div>
        </div>

        {/* Save button */}
        <div className="flex items-center justify-end pt-2" style={{ borderTop: `1px solid ${borderColor}` }}>
          <Button
            size="sm"
            onClick={() => handleSaveSettings({
              apiUrl: settings.apiUrl,
              model: settings.model,
              temperature: settings.temperature,
              maxTokens: settings.maxTokens,
              retryCount: settings.retryCount,
              ...(editingKey ? { apiKey: tempKey } : {}),
            })}
          >
            💾 {t('settings.saveButton')}
          </Button>
        </div>
      </div>

      {/* Help section */}
      <div className="mt-6 rounded-xl border p-5" style={{ borderColor: 'rgba(51, 65, 85, 0.5)', backgroundColor: 'rgba(var(--card-bg-r), var(--card-bg-g), var(--card-bg-b), 0.3)' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'color-mix(in srgb, var(--text-color) 80%, transparent)' }}>
          💡 {t('settings.helpTitle')}
        </h3>
        <ul className="text-xs space-y-2" style={{ color: mutedText }}>
          <li>• {t('settings.helpApiUrl')}</li>
          <li>• {t('settings.helpApiKey')}</li>
          <li>• {t('settings.helpFetchModels')}</li>
          <li>• {t('settings.helpTemperature')}</li>
          <li>• {t('settings.helpSupports')}</li>
        </ul>
      </div>
    </div>
  );
}
