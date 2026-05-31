import { DEFAULT_LLM_SETTINGS, STORAGE_KEYS } from '../../shared/constants.ts';
import type { LlmProviderId, LlmSettings } from '../../shared/types.ts';
import { getStorageValue, setStorageValue } from '../../shared/utils/storage.ts';
import { escapeHtml } from '../util/diff.ts';

export interface HealthStatus {
  ok: boolean;
  detail: string;
}

export interface CombinedHealth {
  llm: HealthStatus;
  languageTool: HealthStatus;
}

export interface HealthCheckRunner {
  (): Promise<CombinedHealth>;
}

type Testing = 'llm' | 'languageTool' | null;

export class SettingsTab {
  private settings: LlmSettings = DEFAULT_LLM_SETTINGS;
  private llmStatus: HealthStatus | null = null;
  private ltStatus: HealthStatus | null = null;
  private testing: Testing = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly runHealthCheck: HealthCheckRunner
  ) {
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('input', this.onInput);
    this.root.addEventListener('click', this.onClick);
  }

  async refresh(): Promise<void> {
    this.settings = await getStorageValue(STORAGE_KEYS.LLM_SETTINGS);
    this.render();
  }

  private onInput = async (event: Event): Promise<void> => {
    const target = event.target as HTMLInputElement | null;
    if (!target?.dataset.field) return;
    await this.handleFieldChange(target);
  };

  private onChange = async (event: Event): Promise<void> => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | null;
    if (!target?.dataset.field) return;
    await this.handleFieldChange(target);
  };

  private onClick = async (event: MouseEvent): Promise<void> => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.dataset.action === 'test-llm') {
      await this.runTest('llm');
    }
    if (target.dataset.action === 'test-lt') {
      await this.runTest('languageTool');
    }
    if (target.dataset.action === 'reset-defaults') {
      this.settings = { ...DEFAULT_LLM_SETTINGS };
      this.llmStatus = null;
      this.ltStatus = null;
      await this.persist();
      this.render();
    }
  };

  private async runTest(kind: 'llm' | 'languageTool'): Promise<void> {
    this.testing = kind;
    if (kind === 'llm') this.llmStatus = null;
    else this.ltStatus = null;
    this.render();
    try {
      const result = await this.runHealthCheck();
      if (kind === 'llm') this.llmStatus = result.llm;
      else this.ltStatus = result.languageTool;
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown error';
      const status: HealthStatus = { ok: false, detail };
      if (kind === 'llm') this.llmStatus = status;
      else this.ltStatus = status;
    } finally {
      this.testing = null;
      this.render();
    }
  }

  private async handleFieldChange(target: HTMLInputElement | HTMLSelectElement): Promise<void> {
    const field = target.dataset.field as keyof LlmSettings;
    const value = (target as HTMLInputElement).value;
    if (field === 'provider') {
      const next = value === 'openai' ? 'openai' : 'ollama';
      const swap: LlmSettings =
        next === this.settings.provider
          ? { ...this.settings }
          : {
              ...this.settings,
              provider: next as LlmProviderId,
              ...defaultsForProvider(next as LlmProviderId, this.settings),
            };
      this.settings = swap;
    } else if (field === 'temperature' || field === 'maxTokens') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        this.settings = { ...this.settings, [field]: numeric };
      }
    } else {
      this.settings = { ...this.settings, [field]: value };
    }
    // Reset the status for whichever section was affected.
    if (field === 'languageToolUrl') {
      this.ltStatus = null;
    } else {
      this.llmStatus = null;
    }
    await this.persist();
    this.render();
  }

  private async persist(): Promise<void> {
    await setStorageValue(STORAGE_KEYS.LLM_SETTINGS, this.settings);
  }

  private renderStatus(status: HealthStatus | null): string {
    if (!status) return '';
    const cls = status.ok ? 'notice--ok' : 'notice--warn';
    return `<div class="notice ${cls}">${escapeHtml(status.detail)}</div>`;
  }

  private render(): void {
    const s = this.settings;
    const isOpenAi = s.provider === 'openai';
    const testingLlm = this.testing === 'llm';
    const testingLt = this.testing === 'languageTool';

    this.root.innerHTML = `
      <section class="rules-section">
        <h2>LLM provider</h2>
        <div class="form-row">
          <label for="provider">Provider</label>
          <select id="provider" data-field="provider">
            <option value="ollama" ${!isOpenAi ? 'selected' : ''}>Ollama (local)</option>
            <option value="openai" ${isOpenAi ? 'selected' : ''}>OpenAI-compatible</option>
          </select>
          <span class="help">${
            isOpenAi
              ? 'Sends document text to the configured endpoint.'
              : 'Default. Runs entirely on your machine via Ollama.'
          }</span>
        </div>
        <div class="form-row">
          <label for="baseUrl">Base URL</label>
          <input id="baseUrl" data-field="baseUrl" type="url" value="${escapeHtml(s.baseUrl)}" />
        </div>
        <div class="form-row">
          <label for="model">Model</label>
          <input id="model" data-field="model" type="text" value="${escapeHtml(s.model)}" />
          <span class="help">${
            isOpenAi
              ? 'e.g. gpt-4o-mini, openai/gpt-4o-mini, deepseek/deepseek-r1'
              : 'e.g. qwen2.5:latest, llama3:8b. Pull first with: ollama pull &lt;model&gt;'
          }</span>
        </div>
        ${
          isOpenAi
            ? `<div class="form-row">
                 <label for="apiKey">API key</label>
                 <input id="apiKey" data-field="apiKey" type="password" autocomplete="off" value="${escapeHtml(s.apiKey)}" />
               </div>`
            : ''
        }
        <div class="form-grid-2">
          <div class="form-row">
            <label for="temperature">Temperature</label>
            <input id="temperature" data-field="temperature" type="number" min="0" max="1" step="0.05" value="${s.temperature}" />
          </div>
          <div class="form-row">
            <label for="maxTokens">Max output tokens</label>
            <input id="maxTokens" data-field="maxTokens" type="number" min="256" max="32768" step="128" value="${s.maxTokens}" />
          </div>
        </div>
        <div class="toolbar">
          <button class="button button--primary" data-action="test-llm" ${testingLlm ? 'disabled' : ''}>
            ${testingLlm ? 'Testing…' : 'Test LLM connection'}
          </button>
        </div>
        ${this.renderStatus(this.llmStatus)}
      </section>

      <section class="rules-section">
        <h2>LanguageTool (grammar / punctuation / capitalization)</h2>
        <div class="form-row">
          <label for="languageToolUrl">LanguageTool URL</label>
          <input id="languageToolUrl" data-field="languageToolUrl" type="url" placeholder="http://localhost:8010" value="${escapeHtml(s.languageToolUrl)}" />
          <span class="help">Start the bundled server with <code>npm run lt:up</code>. Leave blank to fall back to the LLM for grammar-class rules.</span>
        </div>
        <div class="toolbar">
          <button class="button button--primary" data-action="test-lt" ${testingLt ? 'disabled' : ''}>
            ${testingLt ? 'Testing…' : 'Test LanguageTool connection'}
          </button>
        </div>
        ${this.renderStatus(this.ltStatus)}
      </section>

      <section class="rules-section">
        <div class="toolbar">
          <button class="button" data-action="reset-defaults">Reset to defaults</button>
        </div>
      </section>
    `;
  }
}

function defaultsForProvider(provider: LlmProviderId, current: LlmSettings): Partial<LlmSettings> {
  if (provider === 'openai') {
    return {
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      apiKey: current.apiKey,
    };
  }
  return {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:latest',
    apiKey: '',
  };
}
