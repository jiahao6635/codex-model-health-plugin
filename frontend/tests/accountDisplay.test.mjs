import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/accountDisplay.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2024 },
})
const { accountDisplayName } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('same name accounts use different emails as display names', () => {
  const name = 'OPENAI账号'
  assert.equal(accountDisplayName({ name, email: 'a@example.com' }), 'a@example.com')
  assert.equal(accountDisplayName({ name, email: 'b@example.com' }), 'b@example.com')
})

test('missing email displays an explicit placeholder', () => {
  assert.equal(accountDisplayName({ name: '  备用账号  ', email: null }), '未提供邮箱')
  assert.equal(accountDisplayName({ name: '主账号', email: '   ' }), '未提供邮箱')
})

test('account labels exclude names and IDs', () => {
  assert.equal(accountDisplayName({ id: 'a', name: 'openai OAuth', email: 'x@example.com' }), 'x@example.com')
  assert.equal(accountDisplayName({ id: 'b', name: '', email: null }), '未提供邮箱')
})
