import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
const require=createRequire(import.meta.url)
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright')
const root=fileURLToPath(new URL('../',import.meta.url)),base=process.env.PREVIEW_URL || 'http://127.0.0.1:4175/'
mkdirSync(`${root}/review/screenshots`,{recursive:true})
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BINARY,args:['--disable-gpu']})
const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
await page.addInitScript(() => {
 window.__calls=[];window.__active=0;window.__peak=0
 let bridge
 Object.defineProperty(window,'codexProxyPlugin',{
  configurable:true,get:()=>bridge,
  set(value){bridge={...value,async request(input){
   window.__calls.push(input)
   const step=input.path==='api/runs/step'
   if(step){window.__active++;window.__peak=Math.max(window.__peak,window.__active)}
   try{
    const response=await value.request(input)
    const data=input.body?JSON.parse(input.body):{}
    if(input.path==='api/runs/start' && data.account_id==='demo-a')window.__primaryId=JSON.parse(new TextDecoder().decode(response.body)).run.id
    if(step && window.__failPrimary && data.id===window.__primaryId){window.__failPrimary=false;throw Error('模拟：请求结果读取失败')}
    return response
   }finally{if(step)window.__active--}
  }}}
 })
})
async function select(label,option){const trigger=page.getByRole('combobox',{name:label,exact:true});await trigger.click();const id=await trigger.getAttribute('aria-controls');await page.locator(`[id="${id}"]`).getByRole('option',{name:option,exact:true}).click()}
async function setup(mode){await page.goto(`${base}?preview=1`);await page.getByRole('radio',{name:'ModelTrace',exact:true}).click();await select('检测账号','primary@example.com');await select('计量 Key','模型体检专用');await select('请求模型','gpt-6-astra');await page.getByRole('button',{name:'加入批量列表',exact:true}).click();await select('检测账号','backup@example.com');await page.getByRole('button',{name:'加入批量列表',exact:true}).click();await page.getByRole('radio',{name:mode,exact:true}).click();assert.equal(await page.getByText('后台未连接',{exact:true}).count(),0);assert.equal(await page.getByRole('checkbox',{name:'启用定时检测',exact:true}).count(),0)}
async function steps(){return await page.evaluate(()=>window.__calls.filter(c=>c.path==='api/runs/step').length)}
try {
 for(const [mode,peak] of [['串行',1],['并行',2]]){
  await setup(mode);await page.getByRole('button',{name:'开始批量测试',exact:true}).click();await page.getByRole('button',{name:'查看 primary@example.com 的批量报告',exact:true}).waitFor();await page.getByRole('button',{name:'查看 primary@example.com 的批量报告',exact:true}).click();await page.getByText('本批次 · 2 / 2 已结束',{exact:true}).waitFor();assert.equal(await steps(),6);assert.equal(await page.evaluate(()=>window.__peak),peak);assert.equal(await page.getByText('已完成',{exact:true}).count(),3);assert.equal(await page.getByRole('progressbar',{name:'有效样本进度',exact:true}).getAttribute('value'),'3');assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.path.includes('automation')).length),0)
 }
 await page.screenshot({path:`${root}/review/screenshots/batch-light.png`,fullPage:true})
 await setup('并行');await page.evaluate(()=>window.__failPrimary=true);await page.getByRole('button',{name:'开始批量测试',exact:true}).click();await page.getByText('本批次 · 2 / 2 已结束',{exact:true}).waitFor();assert.equal(await steps(),4);assert.equal(await page.getByText('检测失败',{exact:true}).count(),1);assert.equal(await page.getByText('已完成',{exact:true}).count(),1)
 await setup('并行');await page.getByRole('button',{name:'开始批量测试',exact:true}).click();await page.waitForFunction(()=>window.__active===2);await page.getByRole('button',{name:'暂停批次',exact:true}).click();await page.getByRole('button',{name:'继续批次',exact:true}).waitFor();const paused=await steps();await page.waitForTimeout(850);assert.equal(await steps(),paused);assert.equal(paused,2);await page.getByRole('button',{name:'继续批次',exact:true}).click();await page.getByText('本批次 · 2 / 2 已结束',{exact:true}).waitFor();assert.equal(await steps(),6)
 await setup('串行');await page.getByRole('button',{name:'开始批量测试',exact:true}).click();await page.waitForFunction(()=>window.__active===1);await page.getByRole('button',{name:'取消批次',exact:true}).click();await page.getByText('本批次 · 2 / 2 已结束',{exact:true}).waitFor();assert.equal(await steps(),1);assert.equal(await page.getByText('已取消',{exact:true}).count(),2)
 await setup('并行');await page.getByRole('button',{name:'开始批量测试',exact:true}).click();await page.waitForFunction(()=>window.__active===2);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))});await page.getByRole('button',{name:'继续批次',exact:true}).waitFor();assert.equal(await steps(),2);await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'))});await page.getByRole('button',{name:'继续批次',exact:true}).click();await page.getByText('本批次 · 2 / 2 已结束',{exact:true}).waitFor()
 for(const [theme,width] of [['dark',1440],['light',390]]){await page.setViewportSize({width,height:1050});await page.goto(`${base}?preview=1&theme=${theme}`);await page.getByText('批量测试',{exact:true}).waitFor();await page.getByText('正在读取宿主账号与检测基线…',{exact:true}).waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`${root}/review/screenshots/batch-${width===390?'mobile':theme}.png`,fullPage:true})}
 assert.deepEqual(errors,[]);console.log('BATCH UI PASS: email-only; serial peak=1; parallel peak=2; pause/resume; cancel; failure isolation; live report; hidden-page pause; no automation routes; light/dark/mobile; model calls=0')
} finally {await browser.close()}
