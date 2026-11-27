/**
 * EMAIL PREVIEWS (email-look-v1) — writes every email the app can send, rendered by the real
 * renderEmail (lib/email/templates.ts → lib/email/layout.ts), as files Jordan opens on his PC or
 * phone: <id>.html (what the inbox shows), <id>.txt (the plain-text part, subject on top), and an
 * index.html linking them all.
 *
 * Sample data only (scripts/email-samples.ts), including the hostile-name versions, so escaping
 * can be seen. No database, no network, no settings or keys are read. Nothing is sent.
 *
 * Run:  npx tsx scripts/email-preview.ts [output folder]
 *       default output folder: C:\FairSynq-Code-Audit\email-previews (outside the repo)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderEmail } from '../lib/email/templates'
import { escapeHtml } from '../lib/email/layout'
import { EMAIL_SAMPLES, SAMPLE_CREATED_AT, hostileSamples } from './email-samples'

const DEFAULT_OUT = 'C:\\FairSynq-Code-Audit\\email-previews'
const out = resolve(process.argv[2] ?? DEFAULT_OUT)
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (out === repo || out.startsWith(repo + '\\') || out.startsWith(repo + '/')) {
  console.error(`Refusing to write previews inside the repo (${out}); pick a folder outside it.`)
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const all = [
  ...EMAIL_SAMPLES.map(s => ({ id: s.id, template: s.template, payload: s.payload as unknown })),
  ...hostileSamples().map(h => ({ id: h.id, template: h.template, payload: h.payload as unknown })),
]

const rows: string[] = []
for (const s of all) {
  const r = renderEmail(s.template, s.payload, { createdAt: SAMPLE_CREATED_AT })
  writeFileSync(join(out, `${s.id}.html`), r.html)
  writeFileSync(join(out, `${s.id}.txt`), `Subject: ${r.subject}\n\n${r.text}\n`)
  rows.push(`<li><a href="${escapeHtml(s.id)}.html">${escapeHtml(s.id)}</a> · <a href="${escapeHtml(s.id)}.txt">plain text</a> — ${escapeHtml(r.subject)}</li>`)
}

writeFileSync(join(out, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FairSynq email previews</title></head>
<body style="font-family:Arial,Helvetica,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;line-height:1.5;">
<h1 style="font-size:22px;">FairSynq email previews (${all.length})</h1>
<p>Sample data only. The hostile-* emails use a made-up name with HTML in it, to show it is escaped.</p>
<ul>${rows.join('\n')}</ul>
</body></html>
`)

console.log(`Wrote ${all.length} emails (${all.length * 2} files) + index.html to ${out}`)
