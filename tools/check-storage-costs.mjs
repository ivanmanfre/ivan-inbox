import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function text(node) {
  if (ts.isStringLiteralLike(node)) return node.text
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => text(s.expression) + s.literal.text).join('')
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return text(node.left) + text(node.right)
  return ''
}

export function violations(source) {
  const file = ts.createSourceFile('input.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Set()
  function visit(node) {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    if (text(node).includes('render/image')) found.add(`line ${line}: paid image route`)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? text(callee.argumentExpression) : ''
      if ((method === 'getPublicUrl' && node.arguments.length > 1)
          || (method === 'createSignedUrl' && node.arguments.length > 2)
          || (method === 'download' && node.arguments.length > 1)) {
        found.add(`line ${line}: storage image options require a reviewed stored preview`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return [...found]
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let count = 0
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) scan(file)
      else if (/\.[cm]?[jt]sx?$/.test(file) && !/\.(test|spec)\./.test(file)) {
        for (const issue of violations(fs.readFileSync(file, 'utf8'))) { console.error(`${file}: ${issue}`); count++ }
      }
    }
  }
  scan('src')
  console.log(`Storage cost guard: ${count} forbidden constructors`)
  process.exitCode = count ? 1 : 0
}
