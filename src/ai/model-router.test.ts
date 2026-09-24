import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { getOpenAiModelForTier, getOpenAiModelsForTier, selectSupliaModelTier } from './model-router';

const MODEL_ENV_NAMES = [
  'AI_PROVIDER',
  'SUPLIA_AI_PROVIDER',
  'OPENAI_MODEL',
  'OPENAI_FAST_MODEL',
  'OPENAI_BALANCED_MODEL',
  'OPENAI_ORCHESTRATOR_MODEL',
  'OPENAI_REASONING_MODEL',
  'OPENAI_CRITICAL_MODEL',
  'OPENAI_FALLBACK_MODEL',
  'OPENAI_LEGACY_FALLBACK_MODEL',
  'SUPLIA_OPENAI_FAST_MODEL',
  'SUPLIA_OPENAI_BALANCED_MODEL',
  'SUPLIA_OPENAI_ORCHESTRATOR_MODEL',
  'SUPLIA_OPENAI_REASONING_MODEL',
  'SUPLIA_OPENAI_CRITICAL_MODEL',
  'SUPLIA_OPENAI_FALLBACK_MODEL',
  'SUPLIA_OPENAI_LEGACY_FALLBACK_MODEL',
] as const;

async function withCleanModelEnv(run: () => void | Promise<void>) {
  const previous = new Map(MODEL_ENV_NAMES.map((name) => [name, process.env[name]]));
  MODEL_ENV_NAMES.forEach((name) => delete process.env[name]);
  try {
    await run();
  } finally {
    previous.forEach((value, name) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    });
  }
}

test('routes GPT-6 Luna and Sol with a Luna fallback', async () => {
  await withCleanModelEnv(() => {
    assert.equal(getOpenAiModelForTier('fast'), 'gpt-6-luna');
    assert.equal(getOpenAiModelForTier('balanced'), 'gpt-6-luna');
    assert.equal(getOpenAiModelForTier('orchestrator'), 'gpt-6-sol');
    assert.equal(getOpenAiModelForTier('reasoning'), 'gpt-6-sol');
    assert.equal(getOpenAiModelForTier('critical'), 'gpt-6-sol');

    assert.deepEqual(getOpenAiModelsForTier('fast'), ['gpt-6-luna']);
    assert.deepEqual(getOpenAiModelsForTier('balanced'), ['gpt-6-luna']);
    assert.deepEqual(getOpenAiModelsForTier('orchestrator'), ['gpt-6-sol', 'gpt-6-luna']);
    assert.deepEqual(getOpenAiModelsForTier('reasoning'), ['gpt-6-sol', 'gpt-6-luna']);
    assert.deepEqual(getOpenAiModelsForTier('critical'), ['gpt-6-sol', 'gpt-6-luna']);
    assert.doesNotMatch(getOpenAiModelsForTier('critical').join(','), /gpt-4o-mini|gpt-5\.[45]/);
  });
});

test('routes generic and classification work to Luna and strategy or high-risk work to Sol', async () => {
  await withCleanModelEnv(() => {
    const messages: Parameters<typeof selectSupliaModelTier>[0]['messages'] = [];
    const genericTier = selectSupliaModelTier({ message: 'Redacta un email breve para presentar el producto.', messages });
    const classificationTier = selectSupliaModelTier({ message: 'Clasifica esta respuesta como positiva o negativa.', messages });
    const strategyTier = selectSupliaModelTier({ message: 'Analiza y recomienda una estrategia comercial.', messages });
    const highRiskTier = selectSupliaModelTier({ message: 'Envia una campana a todos sin aprobar.', messages });

    assert.equal(getOpenAiModelForTier(genericTier), 'gpt-6-luna');
    assert.equal(getOpenAiModelForTier(classificationTier), 'gpt-6-luna');
    assert.equal(getOpenAiModelForTier(strategyTier), 'gpt-6-sol');
    assert.equal(getOpenAiModelForTier(highRiskTier), 'gpt-6-sol');
  });
});

test('keeps explicit model environment overrides compatible', async () => {
  await withCleanModelEnv(() => {
    process.env.OPENAI_REASONING_MODEL = 'custom-reasoning-model';
    process.env.OPENAI_FALLBACK_MODEL = 'custom-fallback-model';
    assert.equal(getOpenAiModelForTier('reasoning'), 'custom-reasoning-model');
    assert.deepEqual(getOpenAiModelsForTier('reasoning'), [
      'custom-reasoning-model',
      'gpt-6-sol',
      'gpt-6-luna',
      'custom-fallback-model',
    ]);
  });
});

test('declares the current tier models in local and App Hosting config', () => {
  const appHosting = readFileSync('apphosting.yaml', 'utf8');
  const envExample = readFileSync('.env.example', 'utf8');
  const expected = {
    OPENAI_MODEL: 'gpt-6-luna',
    OPENAI_EMAIL_MODEL: 'gpt-6-luna',
    OPENAI_FAST_MODEL: 'gpt-6-luna',
    OPENAI_BALANCED_MODEL: 'gpt-6-luna',
    OPENAI_ORCHESTRATOR_MODEL: 'gpt-6-sol',
    OPENAI_REASONING_MODEL: 'gpt-6-sol',
    NATIVE_RESEARCH_REPORT_MODEL: 'gpt-6-luna',
    OPENAI_CRITICAL_MODEL: 'gpt-6-sol',
    OPENAI_FALLBACK_MODEL: 'gpt-6-luna',
  } as const;

  for (const [name, model] of Object.entries(expected)) {
    assert.match(appHosting, new RegExp(`- variable: ${name}\\r?\\n\\s+value: ${model}`));
    assert.match(envExample, new RegExp(`^${name}="${model}"$`, 'm'));
  }

  assert.doesNotMatch(`${appHosting}\n${envExample}`, /gpt-4o-mini|gpt-5\.[45]/);
});
