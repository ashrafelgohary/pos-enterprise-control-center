// Builds an Outlook-ready .eml *draft* (X-Unsent: 1) with the branded HTML body.
// Images referenced by the HTML (e.g. the Alshaya logo) are embedded as CID parts,
// so recipients outside the corporate network still see them. Nothing is sent.
import type { EditableEmail } from './types';

const CRLF = '\r\n';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const utf8Base64 = (s: string) => bytesToBase64(new TextEncoder().encode(s));
const wrap76 = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join(CRLF);
const encodeHeader = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8Base64(s)}?=`);
const addressList = (s: string) =>
  s.split(/[;,\s]+/).map((a) => a.trim()).filter((a) => /^[^@\s]+@[^@\s]+$/.test(a)).join(', ');

interface InlineImage { cid: string; type: string; base64: string; name: string }

async function embedImages(html: string): Promise<{ html: string; images: InlineImage[] }> {
  const images: InlineImage[] = [];
  const srcs = Array.from(new Set(Array.from(html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi), (m) => m[1])))
    .filter((s) => !s.startsWith('data:') && !s.startsWith('cid:'));
  let out = html;
  for (const [i, src] of srcs.entries()) {
    const abs = new URL(src, window.location.origin).href;
    try {
      const res = await fetch(abs);
      if (!res.ok) throw new Error(String(res.status));
      const type = (res.headers.get('content-type') || 'image/png').split(';')[0];
      const cid = `img${i + 1}.poscc@alshaya`;
      images.push({ cid, type, base64: bytesToBase64(new Uint8Array(await res.arrayBuffer())),
        name: src.split('/').pop() || `image${i + 1}.png` });
      out = out.split(`src="${src}"`).join(`src="cid:${cid}"`);
    } catch {
      out = out.split(`src="${src}"`).join(`src="${abs}"`); // fallback: absolute link
    }
  }
  return { html: out, images };
}

export async function buildBrandedEml(email: EditableEmail, bodyHtml: string): Promise<string> {
  const { html, images } = await embedImages(bodyHtml);
  const fullHtml = /<html[\s>]/i.test(html)
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;">${html}</body></html>`;
  const alt = `alt_${Math.random().toString(36).slice(2)}`;
  const rel = `rel_${Math.random().toString(36).slice(2)}`;

  const L: string[] = [
    'X-Unsent: 1',
    `To: ${addressList(email.to)}`,
  ];
  const cc = addressList(email.cc);
  if (cc) L.push(`Cc: ${cc}`);
  L.push(
    `Subject: ${encodeHeader(email.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8Base64(email.body)),
    '',
    `--${alt}`,
    `Content-Type: multipart/related; boundary="${rel}"`,
    '',
    `--${rel}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8Base64(fullHtml)),
    '',
  );
  for (const img of images) {
    L.push(
      `--${rel}`,
      `Content-Type: ${img.type}; name="${img.name}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.name}"`,
      '',
      wrap76(img.base64),
      '',
    );
  }
  L.push(`--${rel}--`, '', `--${alt}--`, '');
  return L.join(CRLF);
}

export async function downloadBrandedEml(email: EditableEmail, bodyHtml: string): Promise<void> {
  const eml = await buildBrandedEml(email, bodyHtml);
  const name = (email.subject || 'deployment-notification').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.eml`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
