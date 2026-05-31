import { logger } from '../../services/logger.ts';

export class ProofosCheckbox extends HTMLElement {
  private inputEl: HTMLInputElement | null = null;
  private slotEl: HTMLSlotElement | null = null;
  private containerEl: HTMLDivElement | null = null;
  private isRendered = false;
  private suppressAttributeSync = false;

  private handleSlotChange = () => {
    if (!this.slotEl) return;
    const assigned = this.slotEl.assignedNodes({ flatten: true }).filter((node) => {
      if (node.nodeType === Node.ELEMENT_NODE) return true;
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.trim().length;
      }
      return false;
    });

    this.toggleAttribute('data-empty', assigned.length === 0);
  };

  static get observedAttributes(): string[] {
    return ['checked', 'disabled', 'name', 'value', 'aria-label', 'aria-labelledby'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    try {
      this.render();
      this.syncAllAttributes();
      this.handleSlotChange();
    } catch (error) {
      logger.error({ error }, 'Failed to initialize proofos-checkbox');
    }
  }

  disconnectedCallback(): void {
    if (this.slotEl) {
      this.slotEl.removeEventListener('slotchange', this.handleSlotChange);
    }

    if (this.containerEl) {
      this.containerEl.removeEventListener('click', this.handleContainerClick);
      this.containerEl.removeEventListener('keydown', this.handleKeyDown);
      this.containerEl.removeEventListener('focus', this.handleContainerFocus);
      this.containerEl.removeEventListener('blur', this.handleContainerBlur);
    }
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (!this.isRendered || !this.inputEl) {
      return;
    }

    if (this.suppressAttributeSync) {
      this.suppressAttributeSync = false;
      return;
    }

    switch (name) {
      case 'checked': {
        const isChecked = newValue !== null;
        this.applyCheckedState(isChecked);
        break;
      }
      case 'disabled': {
        const isDisabled = newValue !== null;
        this.applyDisabledState(isDisabled);
        break;
      }
      case 'name': {
        this.inputEl.name = newValue ?? '';
        break;
      }
      case 'value': {
        this.inputEl.value = newValue ?? 'on';
        break;
      }
      case 'aria-label': {
        if (newValue !== null) {
          this.inputEl.setAttribute('aria-label', newValue);
        } else {
          this.inputEl.removeAttribute('aria-label');
        }
        break;
      }
      case 'aria-labelledby': {
        if (newValue !== null) {
          this.inputEl.setAttribute('aria-labelledby', newValue);
        } else {
          this.inputEl.removeAttribute('aria-labelledby');
        }
        break;
      }
      default:
        break;
    }
  }

  get checked(): boolean {
    return this.inputEl?.checked ?? this.hasAttribute('checked');
  }

  set checked(value: boolean) {
    const isChecked = Boolean(value);
    this.applyCheckedState(isChecked);
    this.reflectAttribute('checked', isChecked);
  }

  get disabled(): boolean {
    return this.inputEl?.disabled ?? this.hasAttribute('disabled');
  }

  set disabled(value: boolean) {
    const isDisabled = Boolean(value);
    this.applyDisabledState(isDisabled);
    this.reflectAttribute('disabled', isDisabled);
  }

  get value(): string {
    if (this.inputEl) {
      return this.inputEl.value;
    }
    return this.getAttribute('value') ?? 'on';
  }

  set value(next: string) {
    if (this.inputEl) {
      this.inputEl.value = next;
    }
    this.setAttribute('value', next);
  }

  click(): void {
    if (this.disabled) {
      return;
    }
    this.toggleFromUser();
  }

  focus(options?: FocusOptions): void {
    this.containerEl?.focus(options);
  }

  blur(): void {
    this.containerEl?.blur();
  }

  private render(): void {
    if (this.isRendered || !this.shadowRoot) {
      return;
    }

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: inline-flex;
        position: relative;
        font-family: inherit;
        outline: none;
      }

      :host([disabled]) {
        cursor: not-allowed;
        opacity: 0.6;
      }

      :host([data-empty]) .content {
        display: none;
      }

      :host([data-empty]) .checkbox {
        gap: 0;
      }

      .wrapper {
        position: relative;
        display: inline-flex;
        width: 100%;
        height: 100%;
      }

      .checkbox-input {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        border: 0;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        overflow: hidden;
        white-space: nowrap;
        pointer-events: none;
      }

      .checkbox {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0.75rem;
        cursor: pointer;
        width: 100%;
        user-select: none;
      }

      .checkbox:focus {
        outline: none;
      }

      .control {
        width: 20px;
        height: 20px;
        border-radius: 0.375rem;
        border: 1.5px solid #d1d5db;
        background: #ffffff;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
      }

      .control::after {
        position: relative;
        top: -1px;
        content: '';
        width: 5px;
        height: 10px;
        border-right: 2px solid transparent;
        border-bottom: 2px solid transparent;
        transform: rotate(45deg) scale(0);
        transform-origin: center;
        transition: transform 0.2s ease;
      }

      :host([data-checked]) .control {
        background: #4f46e5;
        border-color: #4f46e5;
        box-shadow: 0 0 0 2px rgba(79, 70, 229, 0.15);
      }

      :host([data-checked]) .control::after {
        border-color: #ffffff;
        transform: rotate(45deg) scale(1);
      }

      :host([data-focused]) .control {
        box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.3);
        border-color: #4f46e5;
      }

      .content {
        display: inline-flex;
        flex-direction: column;
        gap: 0.5rem;
        flex: 1 1 auto;
        height: 100%;
      }
    `;

    const wrapper = document.createElement('div');
    wrapper.className = 'wrapper';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'checkbox-input';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');

    const container = document.createElement('div');
    container.className = 'checkbox';
    container.setAttribute('part', 'container');
    container.setAttribute('role', 'checkbox');
    container.setAttribute('aria-checked', 'false');
    container.tabIndex = 0;

    const control = document.createElement('span');
    control.className = 'control';
    control.setAttribute('part', 'control');

    const content = document.createElement('span');
    content.className = 'content';
    content.setAttribute('part', 'content');

    const slot = document.createElement('slot');
    content.appendChild(slot);

    container.append(control, content);
    wrapper.append(input, container);
    this.shadowRoot.append(style, wrapper);

    this.inputEl = input;
    this.containerEl = container;
    this.slotEl = slot;

    slot.addEventListener('slotchange', this.handleSlotChange);
    container.addEventListener('click', this.handleContainerClick);
    container.addEventListener('keydown', this.handleKeyDown);
    container.addEventListener('focus', this.handleContainerFocus);
    container.addEventListener('blur', this.handleContainerBlur);

    this.isRendered = true;
  }

  private syncAllAttributes(): void {
    if (!this.inputEl) return;

    this.applyCheckedState(this.hasAttribute('checked'));
    this.applyDisabledState(this.hasAttribute('disabled'));

    this.inputEl.name = this.getAttribute('name') ?? '';
    this.inputEl.value = this.getAttribute('value') ?? 'on';

    const ariaLabel = this.getAttribute('aria-label');
    if (ariaLabel) {
      this.inputEl.setAttribute('aria-label', ariaLabel);
    } else {
      this.inputEl.removeAttribute('aria-label');
    }

    const ariaLabelledBy = this.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      this.inputEl.setAttribute('aria-labelledby', ariaLabelledBy);
    } else {
      this.inputEl.removeAttribute('aria-labelledby');
    }

    if (this.containerEl) {
      this.containerEl.tabIndex = this.disabled ? -1 : 0;
      this.containerEl.setAttribute('aria-disabled', this.disabled ? 'true' : 'false');
      this.containerEl.setAttribute('aria-checked', this.checked ? 'true' : 'false');
    }
  }

  private applyCheckedState(checked: boolean): void {
    if (this.inputEl) {
      this.inputEl.checked = checked;
    }
    this.toggleAttribute('data-checked', checked);
    if (this.containerEl) {
      this.containerEl.setAttribute('aria-checked', checked ? 'true' : 'false');
    }
  }

  private applyDisabledState(disabled: boolean): void {
    if (this.inputEl) {
      this.inputEl.disabled = disabled;
    }
    this.toggleAttribute('data-disabled', disabled);
    if (this.containerEl) {
      this.containerEl.tabIndex = disabled ? -1 : 0;
      this.containerEl.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
  }

  private reflectAttribute(name: string, shouldHave: boolean): void {
    const currentlyHas = this.hasAttribute(name);
    if (shouldHave === currentlyHas) {
      this.suppressAttributeSync = false;
      return;
    }

    this.suppressAttributeSync = true;
    if (shouldHave) {
      this.setAttribute(name, '');
    } else {
      this.removeAttribute(name);
    }
  }

  private handleContainerClick = (event: MouseEvent) => {
    if (this.disabled) {
      return;
    }

    if (this.shouldIgnoreEvent(event)) {
      return;
    }

    this.toggleFromUser();
  };

  private handleKeyDown = (event: KeyboardEvent) => {
    if (this.disabled) {
      return;
    }

    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      this.toggleFromUser();
    }
  };

  private handleContainerFocus = () => {
    this.toggleAttribute('data-focused', true);
  };

  private handleContainerBlur = () => {
    this.toggleAttribute('data-focused', false);
  };

  private toggleFromUser(): void {
    this.checked = !this.checked;
    const changeEvent = new Event('change', { bubbles: true, composed: true });
    this.dispatchEvent(changeEvent);
  }

  private shouldIgnoreEvent(event: Event): boolean {
    return event
      .composedPath()
      .some(
        (node) => node instanceof HTMLElement && node.hasAttribute('data-checkbox-interactive')
      );
  }
}

if (!customElements.get('proofos-checkbox')) {
  customElements.define('proofos-checkbox', ProofosCheckbox);
}

declare global {
  interface HTMLElementTagNameMap {
    'proofos-checkbox': ProofosCheckbox;
  }
}
