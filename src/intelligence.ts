import * as fs from 'fs';
import { generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { renderAnalysisPrompt } from './prompt-builder';

export interface IntelligenceResult {
  analysis: string;
  provider: string;
  model: string;
}

type Provider = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'qwen';

function resolveProvider(model: string): Provider {
  const m = model.toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('gemini')) return 'google';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('qwen')) return 'qwen';
  return 'openai';
}

function buildLLM(
  provider: Provider,
  model: string,
  apiKey: string,
): LanguageModel {
  switch (provider) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey });
      return client(model);
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey });
      return client(model);
    }
    case 'deepseek': {
      const client = createDeepSeek({ apiKey });
      return client(model);
    }
    case 'qwen': {
      const client = createOpenAI({
        apiKey,
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      });
      return client(model);
    }
    default: {
      const client = createOpenAI({ apiKey });
      return client(model);
    }
  }
}

export async function runIntelligence(
  diffJsonPath: string,
  apiKey: string,
  model = 'claude-3-5-haiku-latest',
): Promise<IntelligenceResult | null> {
  if (!apiKey) {
    console.log('No API key provided — skipping intelligence analysis');
    return null;
  }

  if (!fs.existsSync(diffJsonPath)) {
    console.log(
      `Diff JSON not found at ${diffJsonPath} — skipping intelligence analysis`,
    );
    return null;
  }

  try {
    const diffData: unknown = JSON.parse(fs.readFileSync(diffJsonPath, 'utf8'));
    const prompt = renderAnalysisPrompt(diffData);
    const provider = resolveProvider(model);

    console.log(`Running intelligence analysis: ${provider} / ${model}`);

    const llm = buildLLM(provider, model, apiKey);
    const { text } = await generateText({
      model: llm,
      maxOutputTokens: 2048,
      prompt,
    });

    console.log('Intelligence analysis complete');
    return { analysis: text, provider, model };
  } catch (err) {
    console.warn(`Intelligence analysis failed: ${err}`);
    return null;
  }
}
