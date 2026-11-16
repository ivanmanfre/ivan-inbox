import { test } from 'node:test'
import assert from 'node:assert/strict'
import { violations } from './check-storage-costs.mjs'

test('rejects SDK image options even when multiline or held in a variable', () => {
  for (const source of [
    `bucket.getPublicUrl(path, {\n transform: { width: 480 }\n})`,
    `bucket.getPublicUrl(path, options)`,
    `bucket.createSignedUrl(path, 60, { transform: { width: 480 } })`,
    `bucket.download(path, {transform: opts})`,
    `bucket.download(path, options)`,
  ]) assert.ok(violations(source).length, source)
})

test('rejects literal, template and concatenated paid routes', () => {
  for (const source of [
    `const url = '/storage/v1/render/image/public/a.jpg'`,
    'const url = `${host}/storage/v1/render/image/public/${path}`',
    `const url = '/render/' + 'image/public/' + path`,
  ]) assert.ok(violations(source).length, source)
})

test('allows original objects, stored previews and the legacy URL reader', () => {
  for (const source of [
    `bucket.getPublicUrl(path)`,
    `const url = '/storage/v1/object/public/a.jpg'`,
    `const prefix = '_library-thumbnails/w480-h600-q75/'`,
    String.raw`const match = url.pathname.match(/(object|render\/image)\/public\//)`,
  ]) assert.deepEqual(violations(source), [])
})
