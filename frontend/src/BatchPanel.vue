<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { BaseButton, BaseCard, BaseIconButton, BaseSegmented, BaseTable, BaseTag } from '@codex-proxy/ui'
import type { BaseTableColumn } from '@codex-proxy/ui'
import { Plus, Play, Pause, Square, ArrowRight, Layers } from '@lucide/vue'
import { api } from './api'
import type { Bootstrap, Run, Target } from './api'
import { accountDisplayName } from './accountDisplay'
import { methodText, verdict } from './presentation'
import { runBatch } from './batchRunner'

const props = defineProps<{ bootstrap: Bootstrap | null; draft: Target; disabled: boolean }>()
const emit = defineEmits<{ open: [id: string]; refresh: []; progress: [run: Run]; lock: [ids: string[], pending: boolean] }>()
type Job = { id: string; target: Target; status: 'queued' | 'running' | 'completed' | 'error' | 'cancelled'; run: Run | null; error: string }
const targets = ref<Target[]>([]), jobs = ref<Job[]>([]), mode = ref('serial')
const running = ref(false), paused = ref(false), error = ref(''), notice = ref('')
let disposed = false, pauseRequested = false, cancelled = false
const pending = computed(() => jobs.value.some(j => j.status === 'queued' || j.status === 'running'))
watch(() => [jobs.value.filter(j=>j.run && ['queued','running'].includes(j.status)).map(j=>j.run!.id),pending.value] as const, ([ids,hasPending]) => emit('lock',ids,hasPending), {deep:true})
const canAdd = computed(() => props.draft.account_id && props.draft.key_id && props.draft.request_model && props.draft.expected_model && targets.value.length < 100 && !pending.value && !props.disabled)
function accountLabel(id: string) { const a=props.bootstrap?.accounts.find(a=>a.id===id); return a ? accountDisplayName(a) : '未提供邮箱' }
function keyLabel(id: string) { return props.bootstrap?.keys.find(k=>k.id===id)?.name || '计量 Key 不可用' }
const targetRows = computed(() => targets.value.map(t=>({...t,id:t.account_id,label:accountLabel(t.account_id),keyLabel:keyLabel(t.key_id)})))
const columns: BaseTableColumn[] = [{key:'label',label:'账户邮箱',kind:'identity',size:'2xl'},{key:'keyLabel',label:'计量 Key',size:'lg'},{key:'method',label:'方法',format:v=>methodText(v as Target['method'])},{key:'request_model',label:'请求模型',kind:'mono',size:'lg'},{key:'actions',label:'操作',kind:'actions'}]
const jobColumns: BaseTableColumn[] = [{key:'label',label:'账户邮箱',kind:'identity',size:'2xl'},{key:'result',label:'进度 / 结果',kind:'custom',size:'xl'},{key:'error',label:'异常原因',size:'2xl'},{key:'actions',label:'报告',kind:'actions'}]
const jobRows = computed(() => jobs.value.map(j=>({...j,label:accountLabel(j.target.account_id)})))
const done = computed(() => jobs.value.filter(j=>['completed','error','cancelled'].includes(j.status)).length)
const text = {queued:'等待执行',running:'检测中',completed:'已完成',error:'检测失败',cancelled:'已取消'}
function add() {
  if (!canAdd.value) return
  const target={...props.draft}, index=targets.value.findIndex(t=>t.account_id===target.account_id)
  if (index<0) targets.value.push(target); else targets.value[index]=target
  notice.value='已加入列表。继续选择账户和计量 Key，可添加下一项。'
}
function allowed() { return !disposed && !pauseRequested && !cancelled && document.visibilityState === 'visible' }
async function execute(job: Job) {
  job.status='running'
  try {
    if (!job.run) job.run=(await api<{run:Run}>('runs/start',{method:job.target.method,account_id:job.target.account_id,key_id:job.target.key_id,request_model:job.target.request_model,claimed_model:job.target.expected_model,tier:job.target.tier})).run
    else {
      job.run=(await api<{run:Run}>('runs/get',{id:job.run.id})).run
      if (allowed() && ['paused','running'].includes(job.run.status)) job.run=(await api<{run:Run}>('runs/control',{id:job.run.id,action:'resume'})).run
    }
    while (allowed() && job.run.status==='ready') {
      job.run=(await api<{run:Run}>('runs/step',{id:job.run.id})).run
      if (!disposed) emit('progress',job.run)
    }
    if (job.run.status==='completed') job.status='completed'
    else if (job.run.status==='paused') {job.status='error';job.error=job.run.attempts.at(-1)?.error || '检测暂停，可从报告手动续测'}
    else if (job.run.status==='stopped') job.status='cancelled'
    else job.status='queued'
  } catch(e) { job.status='error';job.error=e instanceof Error?e.message:String(e) }
  finally {if(job.run && !disposed)emit('progress',job.run)}
}
async function start(resume=false) {
  if (running.value || props.disabled || disposed || document.visibilityState !== 'visible') return
  if (!resume) {
    if (!targets.value.length || pending.value) return
    jobs.value=targets.value.map(t=>({id:t.account_id,target:{...t},status:'queued',run:null,error:''}))
  }
  running.value=true;paused.value=false;pauseRequested=false;cancelled=false;error.value='';notice.value=''
  try {
    await runBatch(jobs.value.filter(j=>j.status==='queued'),mode.value==='parallel'?3:1,execute,allowed)
    if (cancelled) {
      const remaining=jobs.value.filter(j=>j.status==='queued')
      await Promise.all(remaining.map(async j=>{try {if(j.run)j.run=(await api<{run:Run}>('runs/control',{id:j.run.id,action:'stop'})).run;j.status='cancelled';if(j.run && !disposed)emit('progress',j.run)}catch(e){j.status='error';j.error=e instanceof Error?e.message:String(e)}}))
    }
    paused.value=pending.value
  } catch(e) {error.value=e instanceof Error?e.message:String(e);paused.value=pending.value}
  finally {running.value=false;if(!disposed)emit('refresh')}
}
function pause() {pauseRequested=true;notice.value='当前请求完成后暂停，不再发送下一题。'}
async function cancel() {
  cancelled=true;pauseRequested=true;notice.value='当前请求完成后取消，已生成的报告保留。'
  if (!running.value) {
    running.value=true
    try {await Promise.all(jobs.value.filter(j=>j.status==='queued').map(async j=>{try{if(j.run)j.run=(await api<{run:Run}>('runs/control',{id:j.run.id,action:'stop'})).run;j.status='cancelled';if(j.run && !disposed)emit('progress',j.run)}catch(e){j.status='error';j.error=e instanceof Error?e.message:String(e)}}))}
    finally {running.value=false;paused.value=false;emit('refresh')}
  }
}
function visibility() {if(document.visibilityState!=='visible' && running.value)pause()}
onMounted(()=>document.addEventListener('visibilitychange',visibility))
onScopeDispose(()=>{disposed=true;pauseRequested=true;document.removeEventListener('visibilitychange',visibility)})
</script>

<template>
  <BaseCard>
    <template #header><div><h2 class="flex items-center gap-2"><Layers class="size-5" />批量测试</h2><p class="subtitle">页面内执行；切走或关闭页面后停止发送下一题，报告保留在检测历史</p></div></template>
    <template #body>
      <p v-if="error" role="alert" class="sample-error">{{ error }}</p>
      <p v-if="notice" role="status" class="muted text-cp-sm">{{ notice }}</p>
      <div class="monitor-toolbar"><p class="muted text-cp-sm">沿用上方选择的账户、计量 Key、模型和档位。同一账户再次添加会更新配置。</p><BaseButton :disabled="!canAdd" @click="add"><Plus class="size-4" />加入批量列表</BaseButton></div>
      <BaseTable :columns="columns" :rows="targetRows" empty-text="从上方选择账户和计量 Key，加入要测试的列表。"><template #actions="{row}"><BaseButton size="sm" :disabled="pending || running" @click="targets=targets.filter(t=>t.account_id!==row.id)">移除</BaseButton></template></BaseTable>
      <div class="flex flex-wrap gap-3 items-center mt-4 mb-6"><BaseSegmented v-model="mode" label="批量执行方式" :disabled="pending || running" :options="[{value:'serial',label:'串行'},{value:'parallel',label:'并行'}]" /><BaseButton variant="primary" :disabled="disabled || !targets.length || pending || running" @click="start()"><Play class="size-4" />开始批量测试</BaseButton><span class="muted text-cp-xs">{{ targets.length }} 个账户 · {{ mode==='parallel'?'最多同时检测 3 个账户':'逐个账户完成检测' }} · 每个账户内部逐题执行</span></div>
      <div v-if="jobs.length" class="monitor-batch"><div class="flex flex-wrap items-center justify-between gap-3"><h3>本批次 · {{ done }} / {{ jobs.length }} 已结束</h3><div v-if="pending" class="flex gap-2"><BaseButton v-if="running" size="sm" @click="pause"><Pause class="size-4" />暂停批次</BaseButton><BaseButton v-else-if="paused" size="sm" :disabled="disabled" @click="start(true)"><Play class="size-4" />继续批次</BaseButton><BaseButton size="sm" @click="cancel"><Square class="size-3" />取消批次</BaseButton></div></div><progress class="sample-progress" :value="done" :max="jobs.length" aria-label="批次进度" /><p v-if="paused" role="status" class="muted text-cp-sm">批次已暂停，点击“继续批次”后继续。</p><BaseTable :columns="jobColumns" :rows="jobRows"><template #result="{row}"><BaseTag>{{ paused && row.status==='queued'?'已暂停':text[row.status as Job['status']] }}</BaseTag><p v-if="row.run" class="muted text-cp-xs">{{ row.run.report.valid_samples }} / {{ row.run.report.planned_samples }} 有效样本 · {{ row.status==='completed'?verdict(row.run.report,'completed'):'等待完整检测' }}</p></template><template #actions="{row}"><BaseIconButton v-if="row.run" :label="`查看 ${row.label} 的批量报告`" @click="emit('open',row.run.id)"><ArrowRight class="size-4" /></BaseIconButton></template></BaseTable></div>
    </template>
  </BaseCard>
</template>
