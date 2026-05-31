export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function truncate(input: string, max = 220): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}
