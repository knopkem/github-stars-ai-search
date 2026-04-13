import { useEffect, useRef, useState, useCallback } from 'react';
import type { AppSettings, ExportPayload, HardwareInfo, LmStudioModelsResponse, LmStudioTestResult } from '@github-stars-ai-search/shared';
import { discoverModels, getHardwareInfo, testLmStudioSettings } from '../api';
import { getRecommendation, formatBytes } from '../utils/modelRecommendations';
import {
  Monitor, Cpu, MemoryStick, Zap, RefreshCw, ChevronDown,
  CheckCircle2, XCircle, Loader2, Sparkles,
} from 'lucide-react';

interface SettingsPanelProps {
  settings: AppSettings | null;
  isLoading: boolean;
  mutations: {
    saveGitHub: { mutate: (input: { token: string }) => void; isPending: boolean };
    testGitHub: { mutate: (input: { token: string }) => void; isPending: boolean };
    saveLmStudio: { mutate: (input: { baseUrl: string; chatModel: string; embeddingModel: string; apiKey?: string; concurrency?: number }) => void; isPending: boolean };
    exportCatalog: { mutate: () => void; isPending: boolean };
    importCatalog: { mutate: (payload: ExportPayload) => void; isPending: boolean };
  };
}

function ModelSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  isLoading,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder: string;
  isLoading: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);

  if (isEditing || options.length === 0) {
    return (
      <div className="field-group">
        <label htmlFor={id}>{label}</label>
        <div className="flex gap-2">
          <input
            id={id}
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1"
          />
          {options.length > 0 && (
            <button
              type="button"
              className="ghost-button"
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
              onClick={() => setIsEditing(false)}
              title="Switch to dropdown"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="field-group">
      <label htmlFor={id}>
        {label}
        {isLoading && <Loader2 size={12} className="inline ml-1 animate-spin" style={{ marginLeft: '0.3rem' }} />}
      </label>
      <div className="flex gap-2">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            padding: '0.5rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface-card)',
            color: 'var(--color-text-primary)',
            fontSize: '0.875rem',
          }}
        >
          <option value="">Select a model…</option>
          {options.map((model) => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
        <button
          type="button"
          className="ghost-button"
          style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem' }}
          onClick={() => setIsEditing(true)}
          title="Type model name manually"
        >
          ✏️
        </button>
      </div>
    </div>
  );
}

export function SettingsPanel({ settings, isLoading, mutations }: SettingsPanelProps) {
  const [githubToken, setGitHubToken] = useState('');
  const [lmStudio, setLmStudio] = useState({
    baseUrl: 'http://127.0.0.1:1234',
    chatModel: '',
    embeddingModel: '',
    apiKey: '',
    concurrency: 1,
  });
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [models, setModels] = useState<LmStudioModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [hardwareLoading, setHardwareLoading] = useState(false);

  const [testResult, setTestResult] = useState<LmStudioTestResult | null>(null);

  useEffect(() => {
    if (!settings?.lmStudio) return;
    setLmStudio((current) => ({
      ...current,
      baseUrl: settings.lmStudio?.baseUrl ?? current.baseUrl,
      chatModel: settings.lmStudio?.chatModel ?? current.chatModel,
      embeddingModel: settings.lmStudio?.embeddingModel ?? current.embeddingModel,
      concurrency: settings.lmStudio?.concurrency ?? current.concurrency,
    }));
  }, [settings]);

  // Auto-detect hardware on mount
  useEffect(() => {
    setHardwareLoading(true);
    getHardwareInfo()
      .then(setHardware)
      .catch(() => {/* ignore */})
      .finally(() => setHardwareLoading(false));
  }, []);

  const handleDiscoverModels = useCallback(async () => {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const result = await discoverModels(lmStudio.baseUrl, lmStudio.apiKey || undefined);
      setModels(result);
    } catch (error) {
      setModelsError((error as Error).message);
      setModels(null);
    } finally {
      setModelsLoading(false);
    }
  }, [lmStudio.baseUrl, lmStudio.apiKey]);

  const [testLoading, setTestLoading] = useState(false);

  const handleTest = useCallback(async () => {
    setTestResult(null);
    setTestLoading(true);
    try {
      const result = await testLmStudioSettings(lmStudio);
      setTestResult(result);
    } catch {
      setTestResult({
        chat: { ok: false, error: 'Connection failed' },
        embedding: { ok: false, error: 'Connection failed' },
      });
    } finally {
      setTestLoading(false);
    }
  }, [lmStudio]);

  const recommendation = hardware ? getRecommendation(hardware) : null;

  const handleApplyRecommendation = useCallback(() => {
    if (!recommendation) return;
    setLmStudio((current) => ({
      ...current,
      chatModel: recommendation.chatModels[0] ?? current.chatModel,
      embeddingModel: recommendation.embeddingModels[0] ?? current.embeddingModel,
      concurrency: recommendation.maxConcurrency,
    }));
  }, [recommendation]);

  return (
    <div className="grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>GitHub access</h2>
            <p className="muted">Store the token only on the local API server. It never comes back to the browser once saved.</p>
          </div>
          {settings && <span className="badge">{settings.githubConfigured ? 'configured' : 'not configured'}</span>}
        </div>
        <div className="field-group">
          <label htmlFor="github-token">GitHub personal access token</label>
          <input
            id="github-token"
            type="password"
            placeholder="ghp_..."
            value={githubToken}
            onChange={(event) => setGitHubToken(event.target.value)}
          />
        </div>
        <div className="field-row" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="secondary-button"
            disabled={mutations.testGitHub.isPending}
            onClick={() => mutations.testGitHub.mutate({ token: githubToken })}
          >
            Test token
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={mutations.saveGitHub.isPending}
            onClick={() => {
              mutations.saveGitHub.mutate({ token: githubToken });
              setGitHubToken('');
            }}
          >
            Save token
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>LM Studio configuration</h2>
            <p className="muted">Configure the local LM Studio chat model and a dedicated embeddings model for retrieval.</p>
          </div>
          {settings?.lmStudio && <span className="badge">saved</span>}
        </div>

        {/* Hardware Detection & Recommendations */}
        <div style={{
          background: 'var(--color-surface-card)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.5rem',
          padding: '1rem',
          marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <Sparkles size={16} style={{ color: 'var(--color-accent-blue)' }} />
              Hardware & Recommendations
            </h3>
            {hardwareLoading && <Loader2 size={14} className="animate-spin" />}
          </div>

          {hardware ? (
            <div>
              <div style={{
                display: 'flex',
                gap: '1.5rem',
                flexWrap: 'wrap',
                marginBottom: '0.75rem',
                fontSize: '0.85rem',
              }}>
                {hardware.gpu ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <Monitor size={14} style={{ color: '#22c55e' }} />
                    {hardware.gpu.name} • {formatBytes(hardware.gpu.vramMb)} VRAM
                  </span>
                ) : (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#ef4444' }}>
                    <Monitor size={14} />
                    No GPU detected
                  </span>
                )}
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <MemoryStick size={14} style={{ color: 'var(--color-accent-blue)' }} />
                  {formatBytes(hardware.ramMb)} RAM
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <Cpu size={14} style={{ color: 'var(--color-accent-purple)' }} />
                  {hardware.cpuCores} CPU cores
                </span>
              </div>

              {recommendation && (
                <div style={{
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '0.375rem',
                  padding: '0.75rem',
                  fontSize: '0.85rem',
                }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-accent-blue)' }}>
                    Recommended for {recommendation.tier}
                  </div>
                  <div style={{ display: 'grid', gap: '0.25rem', color: 'var(--color-text-secondary)' }}>
                    <span>💬 Chat: <strong style={{ color: 'var(--color-text-primary)' }}>{recommendation.chatModels[0]}</strong></span>
                    <span>🔢 Embedding: <strong style={{ color: 'var(--color-text-primary)' }}>{recommendation.embeddingModels[0]}</strong></span>
                    <span>⚡ Concurrency: <strong style={{ color: 'var(--color-text-primary)' }}>{recommendation.maxConcurrency}</strong></span>
                    <span style={{ fontStyle: 'italic', marginTop: '0.25rem' }}>{recommendation.notes}</span>
                  </div>
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.3rem 0.75rem' }}
                    onClick={handleApplyRecommendation}
                  >
                    <Zap size={12} style={{ marginRight: '0.3rem' }} />
                    Apply Recommendations
                  </button>
                </div>
              )}
            </div>
          ) : !hardwareLoading ? (
            <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>Could not detect hardware info.</p>
          ) : null}
        </div>

        <div className="grid two-up">
          <div className="field-group">
            <label htmlFor="lm-base-url">Base URL</label>
            <div className="flex gap-2">
              <input
                id="lm-base-url"
                type="text"
                value={lmStudio.baseUrl}
                onChange={(event) => setLmStudio((current) => ({ ...current, baseUrl: event.target.value }))}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="secondary-button"
                style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                disabled={modelsLoading}
                onClick={handleDiscoverModels}
                title="Discover loaded models from LM Studio"
              >
                {modelsLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                <span style={{ marginLeft: '0.3rem' }}>Discover</span>
              </button>
            </div>
            {models && (
              <span className="muted" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                Found {models.chatModels.length} chat, {models.embeddingModels.length} embedding models
              </span>
            )}
            {modelsError && (
              <span style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#ef4444' }}>
                {modelsError}
              </span>
            )}
          </div>
          <div className="field-group">
            <label htmlFor="lm-api-key">API key (optional)</label>
            <input
              id="lm-api-key"
              type="password"
              value={lmStudio.apiKey}
              onChange={(event) => setLmStudio((current) => ({ ...current, apiKey: event.target.value }))}
            />
          </div>
          <ModelSelect
            id="lm-chat-model"
            label="Chat model"
            value={lmStudio.chatModel}
            onChange={(value) => setLmStudio((current) => ({ ...current, chatModel: value }))}
            options={models?.chatModels ?? []}
            placeholder="qwen2.5-7b-instruct"
            isLoading={modelsLoading}
          />
          <ModelSelect
            id="lm-embedding-model"
            label="Embedding model"
            value={lmStudio.embeddingModel}
            onChange={(value) => setLmStudio((current) => ({ ...current, embeddingModel: value }))}
            options={models?.embeddingModels ?? []}
            placeholder="text-embedding-nomic-embed-text-v1.5"
            isLoading={modelsLoading}
          />
        </div>

        {/* Concurrency Slider */}
        <div className="field-group" style={{ marginTop: '1rem' }}>
          <label htmlFor="lm-concurrency" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Parallel requests: <strong>{lmStudio.concurrency}</strong>
          </label>
          <input
            id="lm-concurrency"
            type="range"
            min={1}
            max={8}
            step={1}
            value={lmStudio.concurrency}
            onChange={(e) => setLmStudio((current) => ({ ...current, concurrency: Number.parseInt(e.target.value, 10) }))}
            style={{ width: '100%', maxWidth: '300px' }}
          />
          <span className="muted" style={{ fontSize: '0.75rem' }}>
            Higher values speed up sync but require more VRAM. Set to 1 for sequential processing.
          </span>
        </div>

        {/* Test Results */}
        {testResult && (
          <div style={{
            background: 'var(--color-surface-card)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.375rem',
            padding: '0.75rem',
            marginTop: '1rem',
            fontSize: '0.85rem',
          }}>
            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {testResult.chat.ok
                  ? <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                  : <XCircle size={14} style={{ color: '#ef4444' }} />}
                Chat {testResult.chat.ok ? `(${testResult.chat.latencyMs}ms)` : ''}
                {!testResult.chat.ok && testResult.chat.error && (
                  <span style={{ color: '#ef4444', marginLeft: '0.3rem' }}>{testResult.chat.error}</span>
                )}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                {testResult.embedding.ok
                  ? <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                  : <XCircle size={14} style={{ color: '#ef4444' }} />}
                Embedding {testResult.embedding.ok ? `(${testResult.embedding.latencyMs}ms)` : ''}
                {!testResult.embedding.ok && testResult.embedding.error && (
                  <span style={{ color: '#ef4444', marginLeft: '0.3rem' }}>{testResult.embedding.error}</span>
                )}
              </span>
            </div>
          </div>
        )}

        <div className="field-row" style={{ marginTop: '1rem' }}>
          <button
            type="button"
            className="secondary-button"
            disabled={testLoading}
            onClick={handleTest}
          >
            {testLoading ? 'Testing…' : 'Test LM Studio'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={mutations.saveLmStudio.isPending}
            onClick={() => mutations.saveLmStudio.mutate(lmStudio)}
          >
            Save LM Studio settings
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Import and export</h2>
            <p className="muted">Move the catalog between machines without carrying secrets or browser-only state.</p>
          </div>
        </div>
        <div className="field-row">
          <button
            type="button"
            className="secondary-button"
            disabled={mutations.exportCatalog.isPending}
            onClick={() => mutations.exportCatalog.mutate()}
          >
            Export catalog
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={mutations.importCatalog.isPending}
            onClick={() => importInputRef.current?.click()}
          >
            Import catalog
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                return;
              }
              const text = await file.text();
              const payload = JSON.parse(text) as ExportPayload;
              mutations.importCatalog.mutate(payload);
            }}
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Current status</h2>
            <p className="muted">Quick visibility into what is already configured.</p>
          </div>
        </div>
        {isLoading ? (
          <div className="empty-state">Loading settings…</div>
        ) : (
          <div className="grid two-up">
            <div className="repo-card">
              <strong>GitHub token</strong>
              <p className="muted">{settings?.githubConfigured ? 'Stored on the server' : 'Not configured yet'}</p>
            </div>
            <div className="repo-card">
              <strong>LM Studio</strong>
              <p className="muted">
                {settings?.lmStudio
                  ? `${settings.lmStudio.baseUrl} · chat: ${settings.lmStudio.chatModel} · embeddings: ${settings.lmStudio.embeddingModel} · concurrency: ${settings.lmStudio.concurrency}`
                  : 'Not configured yet'}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
