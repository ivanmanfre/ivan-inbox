import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { pdfInfo, providerForm } from './file.ts'

Deno.test('the provider request contains the reviewed text, filename and the original PDF bytes', async () => {
  const bytes = new Blob(['%PDF-1.7\nBinary fixture', new Uint8Array([0, 255, 128])])
  const file = { id: '4c79e423-5a84-41a3-bb6d-55180ebf2653', name: 'Plan.pdf', ...await pdfInfo(bytes) }
  const form = await providerForm('Here’s the deck.', 'account-test', file, bytes)
  const req = new Request('https://example.test', { method: 'POST', body: form })
  const parts = await req.formData()
  assertEquals(parts.get('text'), 'Here’s the deck.')
  assertEquals(parts.get('account_id'), 'account-test')
  const pdf = parts.get('attachments') as File
  assertEquals(pdf.name, 'Plan.pdf')
  assertEquals(pdf.type, 'application/pdf')
  assertEquals(new Uint8Array(await pdf.arrayBuffer()), new Uint8Array(await bytes.arrayBuffer()))
  await assertRejects(() => providerForm('Hi', 'account-test', file, new Blob(['%PDF-1.7\nDifferent file'])) )
})
