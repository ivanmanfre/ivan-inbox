import { test } from 'node:test'
import assert from 'node:assert/strict'
import { violations } from './check-storage-costs.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('rejects SDK image options even when multiline or held in a variable', () => {
  for (const source of [
    `bucket.getPublicUrl(path, {\n transform: { width: 480 }\n})`,
    `bucket.getPublicUrl(path, options)`,
    `bucket.createSignedUrl(path, 60, { transform: { width: 480 } })`,
    `bucket.download(path, {transform: opts})`,
    `bucket.download(path, options)`,
    `const args = [path, options]; bucket.getPublicUrl(...args)`,
  ]) assert.ok(violations(source).length, source)
})

test('rejects literal, template and concatenated paid routes', () => {
  for (const source of [
    `const url = '/storage/v1/render/image/public/a.jpg'`,
    'const url = `${host}/storage/v1/render/image/public/${path}`',
    `const url = '/render/' + 'image/public/' + path`,
    'const R=`${BASE}/storage/v1/render`; const url = `${R}/image/public/${p}`',
    `const SEG = '/render/'; const url = SEG + 'image/public/' + path`,
    `const url = ['storage', 'v1', 'render', 'image', 'public', path].join('/')`,
  ]) assert.ok(violations(source).length, source)
})

test('CLI scans CSS, HTML and JSON alongside application code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-cost-fixture-'))
  try {
    fs.mkdirSync(path.join(root, 'src'))
    for (const ext of ['css', 'html', 'json']) fs.writeFileSync(path.join(root, 'src', `paid.${ext}`), '/storage/v1/render/image/public/a.jpg')
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-storage-costs.mjs', import.meta.url))], { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 1)
    for (const ext of ['css', 'html', 'json']) assert.ok(result.stderr.includes(`paid.${ext}`), result.stderr)
  } finally { fs.rmSync(root, { recursive: true }) }
})

test('allows original objects, stored previews and the legacy URL reader', () => {
  for (const source of [
    `bucket.getPublicUrl(path)`,
    `const url = '/storage/v1/object/public/a.jpg'`,
    `const prefix = '_library-thumbnails/w480-h600-q75/'`,
    String.raw`const match = url.pathname.match(/(object|render\/image)\/public\//)`,
  ]) assert.deepEqual(violations(source), [])
})
