// Synthetic scheduling benchmark; no provider calls, secrets, or database.
// Reports scheduling speed only, not model quality or production latency.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
const bundle = await build({ entryPoints: ['src/lib/cowork/specialists.ts'], bundle: true,
  write: false, platform: 'node', format: 'cjs', packages: 'external' });
const module = { exports: {} };
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const tasks = [{role:'analyst',objective:'Analiza',evidence:[0]}, {role:'verifier',objective:'Verifica',evidence:[0]}];
const expected = { summary:'Fixture', findings:[{text:'Dos registros',evidence:[0]}],limitations:[] };
let calls=0;
const invoke = async () => { calls++; await new Promise(resolve=>setTimeout(resolve,40)); return expected; };
const options = {signal:new AbortController().signal,authorize:async()=>{},invoke};
const sequential=[],parallel=[];
for(let sample=0;sample<20;sample++) {
  const measure = async concurrent => {
    const started=performance.now();
    const result=concurrent
      ? await module.exports.runCoworkSpecialists(tasks,[{rows:2}],options)
      : (await Promise.all([tasks].map(async list=>{
          const results=[];for(const task of list) results.push(...await module.exports.runCoworkSpecialists([task],[{rows:2}],options));return results;
        })))[0];
    assert.deepEqual(result.map(item=>item.result),[expected,expected]);
    (concurrent?parallel:sequential).push(performance.now()-started);
  };
  // Alternate order to avoid a fixed warmup advantage.
  await measure(sample%2===0);await measure(sample%2!==0);
}
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
console.log(JSON.stringify({kind:'synthetic_scheduling_only',samplesPerMode:20,modelCalls:0,
  fixtureCalls:calls,sequential:{p50Ms:quantile(sequential,.5),p95Ms:quantile(sequential,.95)},
  parallel:{p50Ms:quantile(parallel,.5),p95Ms:quantile(parallel,.95)},
  medianReductionPercent:100*(1-quantile(parallel,.5)/quantile(sequential,.5)),
  limits:'Does not measure queued scheduler latency, factual quality, tokens or production performance.'},null,2));
