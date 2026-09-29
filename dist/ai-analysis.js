"use strict";exports.ids=[4],exports.modules={"./src/intelligence.ts"(e,n,s){s.d(n,{runIntelligence:()=>d});var t=s("fs"),i=s("./node_modules/ai/dist/index.mjs"),a=s("./node_modules/@ai-sdk/anthropic/dist/index.mjs"),o=s("./node_modules/@ai-sdk/deepseek/dist/index.mjs"),l=s("./node_modules/@ai-sdk/google/dist/index.mjs"),r=s("./node_modules/@ai-sdk/openai/dist/index.mjs");async function d(e,n,s="claude-3-5-haiku-latest"){if(!n)return console.log("No API key provided — skipping intelligence analysis"),null;if(!t.existsSync(e))return console.log(`Diff JSON not found at ${e} — skipping intelligence analysis`),null;try{var c;let d,u,g=(c=JSON.parse(t.readFileSync(e,"utf8")),(d=JSON.stringify(c,null,2)).length>5e4&&(d=d.substring(0,5e4)+"\n... (truncated due to size)"),`You are a senior frontend performance engineer. Analyze the Rsdoctor bundle-diff JSON below (baseline → current) and produce a concise GitHub PR comment in Markdown.

## Output format

### 📊 Size Changes

| Asset / Chunk | Baseline | Current | Δ Size | Δ % | Initial? |
|---|---|---|---|---|---|

(Only list entries with **>5 % or >10 KB** increase. If none, write "No significant regressions detected 🎉".)

### 🔍 Root Cause Analysis
- Bullet points: which modules / dependencies drove each regression.

### ⚠️ Risk Assessment
Overall severity: **Low / Medium / High**
- One-sentence justification focusing on initial-chunk impact and total size delta.

### 💡 Optimization Suggestions
- Numbered, actionable steps (e.g. code-split, tree-shake, replace heavy deps).

## Priority rules
1. Initial / entry chunks > async chunks > static assets.
2. Newly added large modules or duplicate dependencies deserve explicit callout.
3. If total bundle size *decreased*, highlight the wins instead.

## Constraints
- Be concise — aim for <300 words.
- Use exact numbers from the data; do not fabricate figures.
- If the diff data is empty or shows no meaningful change, state that clearly and skip the table.

Bundle diff data:
\`\`\`json
${d}
\`\`\``),p=(u=s.toLowerCase()).startsWith("claude")?"anthropic":u.startsWith("gemini")?"google":u.startsWith("deepseek")?"deepseek":u.startsWith("qwen")?"qwen":"openai";console.log(`Running intelligence analysis: ${p} / ${s}`);let h=function(e,n,s){switch(e){case"anthropic":return(0,a.nM)({apiKey:s})(n);case"google":return(0,l.sw)({apiKey:s})(n);case"deepseek":return(0,o.PW)({apiKey:s})(n);case"qwen":return(0,r.ry)({apiKey:s,baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1"})(n);default:return(0,r.ry)({apiKey:s})(n)}}(p,s,n),{text:m}=await (0,i.Df)({model:h,maxOutputTokens:2048,prompt:g});return console.log("Intelligence analysis complete"),{analysis:m,provider:p,model:s}}catch(e){return console.warn(`Intelligence analysis failed: ${e}`),null}}}};