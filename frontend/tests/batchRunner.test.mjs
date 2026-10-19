import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const { outputText } = ts.transpileModule(readFileSync(new URL('../src/batchRunner.ts', import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2024}})
const {runBatch}=await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
for (const concurrency of [1,3]) test(`batch concurrency ${concurrency} runs each account once`,async()=>{
 let active=0,peak=0;const done=[]
 await runBatch([1,2,3,4,5],concurrency,async item=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));done.push(item);active--},()=>true)
 assert.equal(peak,concurrency);assert.deepEqual(done.sort(),[1,2,3,4,5])
})
test('pause drains in-flight accounts without starting the queued ones',async()=>{
 let allowed=true;const started=[]
 await runBatch([1,2,3,4,5],3,async item=>{started.push(item);await new Promise(r=>setTimeout(r,5));allowed=false},()=>allowed)
 assert.deepEqual(started,[1,2,3])
})
