import {
  addCustomRule,
  deleteCustomRule,
  loadRules,
  setRuleEnabled,
} from '../../shared/rules/store.ts';
import type { Rule } from '../../shared/rules/types.ts';
import { escapeHtml } from '../util/diff.ts';

export class RulesTab {
  private rules: Rule[] = [];

  constructor(private readonly root: HTMLElement) {
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('change', this.onChange);
    this.root.addEventListener('submit', this.onSubmit);
  }

  async refresh(): Promise<void> {
    this.rules = await loadRules();
    this.render();
  }

  private onClick = async (event: MouseEvent): Promise<void> => {
    const target = event.target as HTMLElement;
    if (!target) return;
    if (target.dataset.action === 'delete-rule') {
      const ruleId = target.dataset.ruleId;
      if (!ruleId) return;
      await deleteCustomRule(ruleId);
      await this.refresh();
    }
  };

  private onChange = async (event: Event): Promise<void> => {
    const target = event.target as HTMLInputElement;
    if (target?.matches('input.toggle')) {
      const ruleId = target.dataset.ruleId;
      if (!ruleId) return;
      await setRuleEnabled(ruleId, target.checked);
    }
  };

  private onSubmit = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const form = event.target as HTMLFormElement | null;
    if (!form || form.dataset.role !== 'custom-rule-form') return;
    const data = new FormData(form);
    const name = String(data.get('name') ?? '');
    const instruction = String(data.get('instruction') ?? '');
    const created = await addCustomRule({ name, instruction, category: 'custom' });
    if (created) {
      form.reset();
      await this.refresh();
    }
  };

  private render(): void {
    const builtins = this.rules.filter((rule) => rule.builtin);
    const customs = this.rules.filter((rule) => !rule.builtin);

    this.root.innerHTML = `
      <section class="rules-section">
        <h2>Built-in rules</h2>
        ${builtins.map(renderRow).join('')}
      </section>
      <section class="rules-section">
        <h2>Custom rules</h2>
        ${
          customs.length > 0
            ? customs.map(renderRow).join('')
            : `<div class="empty-state">No custom rules yet. Add one below.</div>`
        }
      </section>
      <section class="rules-section">
        <h2>Add custom rule</h2>
        <form data-role="custom-rule-form">
          <div class="form-row">
            <label for="custom-name">Name</label>
            <input id="custom-name" name="name" type="text" maxlength="80" required placeholder="e.g. No em dashes" />
          </div>
          <div class="form-row">
            <label for="custom-instruction">Instruction for the model</label>
            <textarea id="custom-instruction" name="instruction" maxlength="800" required
              placeholder="Flag every em dash and suggest replacing it with a comma or parentheses."></textarea>
          </div>
          <div class="toolbar">
            <button class="button button--primary" type="submit">Add rule</button>
          </div>
        </form>
      </section>
    `;
  }
}

function renderRow(rule: Rule): string {
  return `
    <div class="rule-row">
      <div>
        <div class="rule-row__title">${escapeHtml(rule.name)}</div>
        <div class="rule-row__instruction">${escapeHtml(rule.instruction)}</div>
      </div>
      <div class="rule-row__actions">
        <input class="toggle" type="checkbox" data-rule-id="${escapeHtml(rule.id)}" ${
          rule.enabled ? 'checked' : ''
        } aria-label="Enable rule ${escapeHtml(rule.name)}" />
        ${
          rule.builtin
            ? ''
            : `<button class="button" data-action="delete-rule" data-rule-id="${escapeHtml(rule.id)}">Delete</button>`
        }
      </div>
    </div>
  `;
}
