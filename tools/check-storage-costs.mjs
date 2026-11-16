import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export function violations(source) {
  const file = ts.createSourceFile('input.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const constants = []
  function collect(node) {
    if (ts.isVariableDeclarationList(node) && node.flags & ts.NodeFlags.Const) {
      const scope = ts.isVariableStatement(node.parent) ? node.parent.parent : node.parent
      for (const d of node.declarations) if (ts.isIdentifier(d.name) && d.initializer) constants.push({ name: d.name.text, initializer: d.initializer, scope })
    }
    ts.forEachChild(node, collect)
  }
  collect(file)
  function initializer(node) {
    if (!ts.isIdentifier(node)) return node
    for (let scope = node.parent; scope; scope = scope.parent) {
      const found = constants.findLast(c => c.name === node.text && c.scope === scope)
      if (found) return found.initializer
    }
    return node
  }
  function text(node, seen = new Set()) {
    if (seen.has(node)) return ''
    seen = new Set([...seen, node])
    const resolved = initializer(node)
    if (resolved !== node) return text(resolved, seen)
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return text(node.expression, seen)
    if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => text(s.expression, seen) + s.literal.text).join('')
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return text(node.left, seen) + text(node.right, seen)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
      const array = initializer(node.expression.expression)
      if (ts.isArrayLiteralExpression(array)) return array.elements.map(e => text(e, seen)).join(node.arguments[0] ? text(node.arguments[0], seen) : ',')
    }
    return ''
  }
  const found = new Set()
  function visit(node) {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    if (text(node).includes('render/image')) found.add(`line ${line}: paid image route`)
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isElementAccessExpression(callee) ? text(callee.argumentExpression) : ''
      if ((method === 'getPublicUrl' && node.arguments.length > 1)
          || (method === 'createSignedUrl' && node.arguments.length > 2)
          || (method === 'download' && node.arguments.length > 1)
          || (['getPublicUrl', 'createSignedUrl', 'download'].includes(method) && node.arguments.some(ts.isSpreadElement))) {
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
      else if (!/\.(test|spec)\./.test(file)) {
        const source = fs.readFileSync(file, 'utf8')
        const found = /\.[cm]?[jt]sx?$/.test(file) ? violations(source) : /render\/image|getPublicUrl.*transform/.test(source) ? ['paid storage route in asset'] : []
        for (const issue of found) { console.error(`${file}: ${issue}`); count++ }
      }
    }
  }
  scan('src')
  console.log(`Storage cost guard: ${count} forbidden constructors`)
  process.exitCode = count ? 1 : 0
}
