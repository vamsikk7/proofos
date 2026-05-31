export class ProofosLogo extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  static get observedAttributes() {
    return ['size'];
  }

  attributeChangedCallback(name: string, oldValue: string, newValue: string) {
    if (oldValue !== newValue && name === 'size') {
      this.render();
    }
  }

  private getSize(): string {
    return this.getAttribute('size') || '48';
  }

  private render(): void {
    const size = this.getSize();
    this.shadow.innerHTML = `
      <style>
        :host { display: inline-block; line-height: 0; }
        svg { display: block; width: 100%; height: 100%; }
      </style>
      <svg width="${size}" height="${size}" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="ProofOS">
        <rect width="256" height="256" rx="56" fill="#4f46e5"/>
        <path d="M68 130 L112 174 L196 82" stroke="#ffffff" stroke-width="28" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        <path d="M96 204 L160 204" stroke="#ffffff" stroke-opacity="0.6" stroke-width="10" stroke-linecap="round" fill="none"/>
      </svg>
    `;
  }
}

customElements.define('proofos-logo', ProofosLogo);
