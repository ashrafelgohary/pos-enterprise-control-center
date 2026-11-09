import type { EditableEmail } from './types';

const splitAddresses = (value: string): string[] =>
  value
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

export function buildMailtoUrl(email: EditableEmail): string {
  const to = splitAddresses(email.to).map(encodeURIComponent).join(',');
  const params = [
    ['cc', splitAddresses(email.cc).join(',')],
    ['subject', email.subject],
    ['body', email.body],
  ]
    .filter(([, value]) => value.length > 0)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');

  return `mailto:${to}${params ? `?${params}` : ''}`;
}

export function formatEmailForClipboard(email: EditableEmail): string {
  return `To: ${email.to}\nCC: ${email.cc}\nSubject: ${email.subject}\n\n${email.body}`;
}
