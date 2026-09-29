"use strict";exports.ids=[4],exports.modules={"./src/intelligence.ts"(e,n,t){t.d(n,{runIntelligence:()=>c});var s=t("fs"),i=t("ai"),a=t("@ai-sdk/anthropic"),r=t("@ai-sdk/deepseek"),o=t("@ai-sdk/google"),l=t("@ai-sdk/openai");async function c(e,n,t="claude-3-5-haiku-latest"){if(!n)return console.log("No API key provided — skipping intelligence analysis"),null;if(!s.existsSync(e))return console.log(`Diff JSON not found at ${e} — skipping intelligence analysis`),null;try{var d;let c,u,g=(d=JSON.parse(s.readFileSync(e,"utf8")),(c=JSON.stringify(d,null,2)).length>5e4&&(c=c.substring(0,5e4)+"\n... (truncated due to size)"),`You are a senior frontend performance engineer. Analyze the Rsdoctor bundle-diff JSON below (baseline → current) and produce a concise GitHub PR comment in Markdown.

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
${c}
\`\`\``),p=(u=t.toLowerCase()).startsWith("claude")?"anthropic":u.startsWith("gemini")?"google":u.startsWith("deepseek")?"deepseek":u.startsWith("qwen")?"qwen":"openai";console.log(`Running intelligence analysis: ${p} / ${t}`);let h=function(e,n,t){switch(e){case"anthropic":return(0,a.createAnthropic)({apiKey:t})(n);case"google":return(0,o.createGoogleGenerativeAI)({apiKey:t})(n);case"deepseek":return(0,r.createDeepSeek)({apiKey:t})(n);case"qwen":return(0,l.createOpenAI)({apiKey:t,baseURL:"https://dashscope.aliyuncs.com/compatible-mode/v1"})(n);default:return(0,l.createOpenAI)({apiKey:t})(n)}}(p,t,n),{text:f}=await (0,i.generateText)({model:h,maxOutputTokens:2048,prompt:g});return console.log("Intelligence analysis complete"),{analysis:f,provider:p,model:t}}catch(e){return console.warn(`Intelligence analysis failed: ${e}`),null}}}};