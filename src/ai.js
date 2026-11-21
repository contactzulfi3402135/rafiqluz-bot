'use strict';
/**
 * v6.2.0 — AI engine with TWENTY providers (OpenRouter, Token Harbor, Gemini,
 * ChatGPT, Grok, Claude, …). Every provider speaks the OpenAI-compatible
 * chat-completions language, so one call path serves them all. Free by default
 * (OpenRouter free model works on a $0 balance), auto-falls-back to the free
 * model on 402, escalating quiet pauses on 429, honest per-failure classes.
 * Posts NEVER block on AI.
 */
const { ring } = require('./logger');
const { S } = require('./db');
const cfg = require('./config');

const FREE_MODEL = 'deepseek/deepseek-v4-flash:free';   // v7.2: free-tier default (Oct 2026 lineup)

/**
 * The 20 supported AI providers — all OpenAI-compatible endpoints.
 * keyUrl = where the owner gets an API key (Settings shows it as a clickable
 * "Get API key" link that opens in a new tab). free = has a free tier.
 */
const PROVIDERS = {
  /* v7.2: built-in catalogs refreshed to the Oct-2026 lineups (verified via each
     provider's public model docs). Built-ins are only the starter list — after
     saving a key the dashboard replaces them with the provider's LIVE list, which
     is always the truth. Each list opens with the recommended default model. */
  openrouter: { name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', url: 'https://openrouter.ai/api/v1/chat/completions', model: FREE_MODEL, free: true, models: ['deepseek/deepseek-v4-flash:free', 'google/gemma-4-31b-it:free', 'qwen/qwen3.8-27b:free', 'qwen/qwen3-coder:free', 'openai/gpt-oss-120b:free', 'nvidia/nemotron-3-super-120b-a12b:free', 'meta-llama/llama-3.3-70b-instruct:free'] },
  tokenharbor: { name: 'Token Harbor', keyUrl: 'https://tokenharbor.ai/', url: 'https://tokenharbor.ai/v1/chat/completions', model: 'gpt-5.5', free: true, models: ['gpt-5.5', 'claude-sonnet-5', 'gemini-3.5-flash', 'grok-4.3', 'deepseek-v4-pro', 'qwen3.8-max', 'glm-5.3-flash', 'mistral-medium-3.5'] }, // one key for GPT/Claude/Gemini/Grok/Qwen — the live list loads after saving the key
  gemini: { name: 'Google Gemini', keyUrl: 'https://aistudio.google.com/app/apikey', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-3.5-flash', free: true, models: ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-pro', 'gemini-3-flash', 'gemini-omni-flash'] },
  openai: { name: 'OpenAI · ChatGPT', keyUrl: 'https://platform.openai.com/api-keys', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-5.5', models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-5.2', 'gpt-5.1', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3', 'o3-pro', 'o4-mini'] },
  grok: { name: 'xAI · Grok', keyUrl: 'https://console.x.ai', url: 'https://api.x.ai/v1/chat/completions', model: 'grok-4.3', models: ['grok-4.3', 'grok-4.20-0309-reasoning', 'grok-4.20-0309-non-reasoning'] },
  claude: { name: 'Anthropic · Claude', keyUrl: 'https://console.anthropic.com/settings/keys', url: 'https://api.anthropic.com/v1/chat/completions', model: 'claude-sonnet-5', models: ['claude-sonnet-5', 'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-haiku-4-5'] },
  groq: { name: 'Groq', keyUrl: 'https://console.groq.com/keys', url: 'https://api.groq.com/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile', free: true, models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'groq/compound', 'groq/compound-mini', 'llama-3.1-8b-instant', 'qwen/qwen3.6-27b'] },
  deepseek: { name: 'DeepSeek', keyUrl: 'https://platform.deepseek.com/api_keys', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-v4-flash', models: ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp'] },
  mistral: { name: 'Mistral AI', keyUrl: 'https://console.mistral.ai/api-keys', url: 'https://api.mistral.ai/v1/chat/completions', model: 'mistral-medium-3.5', free: true, models: ['mistral-medium-3.5', 'mistral-large-4', 'mistral-small-latest', 'magistral-medium-latest', 'magistral-small-latest', 'codestral-latest'] },
  together: { name: 'Together AI', keyUrl: 'https://api.together.ai/settings/api-keys', url: 'https://api.together.xyz/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V4-Flash-0731', models: ['deepseek-ai/DeepSeek-V4-Flash-0731', 'deepseek-ai/DeepSeek-V4-Pro-0813', 'deepseek-ai/DeepSeek-V4.1-Flash', 'Qwen/Qwen3.8-Flash', 'Qwen/Qwen3.7-Plus', 'zai-org/GLM-5.3'] },
  cohere: { name: 'Cohere', keyUrl: 'https://dashboard.cohere.com/api-keys', url: 'https://api.cohere.ai/compatibility/v1/chat/completions', model: 'command-a-03-2025', models: ['command-a-03-2025', 'command-r-plus-08-2024', 'command-r-08-2024', 'command-r7b-12-2024'] },
  perplexity: { name: 'Perplexity', keyUrl: 'https://www.perplexity.ai/settings/api', url: 'https://api.perplexity.ai/chat/completions', model: 'sonar', models: ['sonar', 'sonar-pro', 'sonar-reasoning-pro', 'sonar-deep-research'] },
  fireworks: { name: 'Fireworks AI', keyUrl: 'https://fireworks.ai/account/api-keys', url: 'https://api.fireworks.ai/inference/v1/chat/completions', model: 'accounts/fireworks/models/deepseek-v4-flash-0731', models: ['accounts/fireworks/models/deepseek-v4-flash-0731', 'accounts/fireworks/models/deepseek-v4-pro', 'accounts/fireworks/models/qwen3.8-max', 'accounts/fireworks/models/kimi-k2.7-code', 'accounts/fireworks/models/gemma-4-e4b'] },
  cerebras: { name: 'Cerebras', keyUrl: 'https://cloud.cerebras.ai', url: 'https://api.cerebras.ai/v1/chat/completions', model: 'qwen-3.8-27b', free: true, models: ['qwen-3.8-27b', 'gpt-oss-120b'] },
  sambanova: { name: 'SambaNova', keyUrl: 'https://cloud.sambanova.ai/apis', url: 'https://api.sambanova.ai/v1/chat/completions', model: 'Meta-Llama-3.3-70B-Instruct', models: ['Meta-Llama-3.3-70B-Instruct', 'DeepSeek-V3.1', 'DeepSeek-V3.2'] },
  novita: { name: 'Novita AI', keyUrl: 'https://novita.ai/dashboard/keys', url: 'https://api.novita.ai/v3/openai/chat/completions', model: 'deepseek/deepseek-v4-flash', models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro', 'meta-llama/llama-3.3-70b-instruct'] },
  siliconflow: { name: 'SiliconFlow', keyUrl: 'https://cloud.siliconflow.com/account/ak', url: 'https://api.siliconflow.com/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V4-Flash', models: ['deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V4-Pro', 'Qwen/Qwen3.8-72B'] },
  huggingface: { name: 'Hugging Face', keyUrl: 'https://huggingface.co/settings/tokens', url: 'https://router.huggingface.co/v1/chat/completions', model: 'deepseek-ai/DeepSeek-V4-Flash', free: true, models: ['deepseek-ai/DeepSeek-V4-Flash', 'meta-llama/Llama-3.3-70B-Instruct', 'Qwen/Qwen3.8-72B'] },
  qwen: { name: 'Alibaba · Qwen', keyUrl: 'https://bailian.console.alibabacloud.com/?apiKey=1', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus', models: ['qwen-plus', 'qwen3.8-max', 'qwen3.7-max', 'qwen-max', 'qwen-turbo', 'qwen3-coder', 'qwq-32b'] },
  zhipu: { name: 'Zhipu · GLM', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3-flash', free: true, models: ['glm-5.3-flash', 'glm-5.3', 'glm-5.3-flashx', 'glm-5.2', 'glm-5.1', 'glm-5', 'glm-4.7', 'glm-4.6', 'glm-4.6v', 'glm-5v-turbo'] }
};

const pausedUntil = {};   // provider → epoch ms
const pauseLogged = {};
const esc429 = {};
const pauseLabel = {};
let _lastUsage = 0;       // 5C (R54): tokens reported by the provider on the last rawCall

function providerOf() { return String(S.get('ai.provider', cfg.config.ai.provider)).toLowerCase(); }
function keyOf(p) { return String(S.get(`ai.key.${p}`, p === 'openrouter' ? cfg.config.ai.openrouterKey : '')).trim(); }
function modelOf(p) { return String(S.get(`ai.model.${p}`, PROVIDERS[p]?.model || '')).trim(); }

function trip(provider, rawMessage) {
  const msg = String(rawMessage || '').replace(/HTTP (\d{3})/g, 'HTTP_$1'); // normalize codes
  // 402 on a paid model → silently switch to the FREE model and keep going
  if (provider === 'openrouter' && /HTTP_402/.test(msg) && modelOf('openrouter') !== FREE_MODEL) {
    S.set('ai.model.openrouter', FREE_MODEL);
    pausedUntil[provider] = Date.now() + 30000;
    pauseLogged[provider] = false;
    ring.warn('ai.fallback.free', `OpenRouter is out of credit — switched to the FREE model. AI cleaning continues at no cost.`);
    return;
  }
  let rule = /NO_KEY|HTTP_400|HTTP_401|HTTP_403/.test(msg) ? { ms: 10 * 60e3, label: 'auth/key problem' }
    : /HTTP_402/.test(msg) ? { ms: 6 * 3600e3, label: 'out of credits — add credits or switch provider' }
      : /NETWORK/.test(msg) ? { ms: 30e3, label: 'network error' }
        : { ms: 60e3, label: 'temporary error' };
  if (/HTTP_429/.test(msg)) {
    esc429[provider] = Math.min((esc429[provider] || 30e3) * 2, 6 * 3600e3);
    rule = { ms: esc429[provider], label: 'quota exhausted (free tier daily limit)' };
  } else esc429[provider] = 0;
  pausedUntil[provider] = Math.max(pausedUntil[provider] || 0, Date.now() + rule.ms);
  pauseLabel[provider] = rule.label;
  if (!pauseLogged[provider]) {
    pauseLogged[provider] = true;
    ring.warn('ai.paused', `AI "${provider}" paused for ${Math.round(rule.ms / 1000)}s (${rule.label}) — posts continue with regex cleaning only.`);
  }
}
/** v7.3.3: saving a (new) key clears the breaker — a fresh key deserves a fresh attempt. */
function clearPause(p) {
  if (!pausedUntil[p]) return;
  pausedUntil[p] = 0; pauseLogged[p] = false; esc429[p] = 0; pauseLabel[p] = '';
  ring.info('ai.paused.cleared', `AI "${p}" breaker cleared (key/setting changed) — active again immediately`);
}
function paused(p) {
  if (Date.now() < (pausedUntil[p] || 0)) return true;
  if (pauseLogged[p]) { pauseLogged[p] = false; ring.info('ai.resumed', `AI circuit breaker closed — ${p} beautifier active again`); }
  return false;
}

/**
 * One request path for all 20 providers — they all speak OpenAI-compatible.
 * v7.3.1 fix: "thinking" models (every Gemini 3.x, GPT-5/o-series, …) count
 * their INTERNAL reasoning against the output cap, so a small max_tokens made
 * them spend the whole budget thinking and return an empty message — which is
 * exactly the "EMPTY (model returned no text)" the Gemini test showed. Now:
 *   a) such providers get a floor of 2048 output tokens (a ceiling, not a bill);
 *   b) Gemini is asked for "low" reasoning effort (thinking off for short jobs);
 *   c) if the reply is still empty, one roomier retry runs with thinking off;
 *   d) a 400 that names reasoning_effort / max_tokens / temperature is learned
 *      per provider, and the request is retried without that field — so one
 *      code path stays correct across all 20 different API flavours.
 */
const LEARNED = { effortOff: new Set(), maxMCT: new Set(), noTemp: new Set() };

async function rawCall(p, prompt, { timeoutMs = 20000, maxTokens = 700 } = {}, modelOverride = null) {
  if (!S.getBool('privacy.ai.content', false)) throw new Error('AI content sharing is off. Enable it in Settings → AI before sending content to a provider.');
  const conf = PROVIDERS[p];
  if (!conf) { const e = new Error(`Unknown provider "${p}"`); e.code = 'NO_PROVIDER'; throw e; }
  const key = keyOf(p);
  if (!key) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
  const model = modelOverride || modelOf(p) || conf.model;
  if (!model) { const e = new Error(`No model set for ${conf.name} — type a model id from their catalog`); e.code = 'NO_MODEL'; throw e; }
  const gem = p === 'gemini';
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  const send = async (budget, effort) => {
    const body = { model, messages: [{ role: 'user', content: prompt }] };
    body[LEARNED.maxMCT.has(p) ? 'max_completion_tokens' : 'max_tokens'] = budget;
    if (!LEARNED.noTemp.has(p)) body.temperature = 0.4;
    if (gem && effort && !LEARNED.effortOff.has(p)) body.reasoning_effort = effort;
    const res = await fetch(conf.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      const err = new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
      err.code = `HTTP_${res.status}`; err.status = res.status; err.detail = detail;
      throw err;
    }
    return res.json();
  };
  const textOf = (d) => {
    _lastUsage = (Number(d?.usage?.prompt_tokens) || 0) + (Number(d?.usage?.completion_tokens) || 0);
    let out = d?.choices?.[0]?.message?.content;
    if (Array.isArray(out)) out = out.map((x) => (typeof x === 'string' ? x : x?.text || '')).join('');
    return String(out == null ? '' : out).trim();
  };
  /* send with the 400-learning ladder: a provider that rejects reasoning_effort /
     max_tokens / temperature teaches us, we drop that field and ask again (max 3 fixes) */
  const sendWithLearning = async (budget, effort) => {
    for (let i = 0; i < 4; i += 1) {
      try { return await send(budget, effort); }
      catch (err) {
        if (err.status !== 400 || i === 3) throw err;
        const d = String(err.detail || '');
        if (/reasoning_effort/i.test(d) && !LEARNED.effortOff.has(p)) LEARNED.effortOff.add(p);
        else if (/max_completion_tokens|max_tokens/i.test(d) && !LEARNED.maxMCT.has(p)) LEARNED.maxMCT.add(p);
        else if (/temperature/i.test(d) && !LEARNED.noTemp.has(p)) LEARNED.noTemp.add(p);
        else throw err;
      }
    }
    throw new Error('unreachable');
  };
  try {
    const base = Math.max(Number(maxTokens) || 700, gem ? 2048 : 0);
    let data = await sendWithLearning(base, gem ? 'low' : null);
    let out = textOf(data);
    if (!out) {
      const fr = String(data?.choices?.[0]?.finish_reason || '');
      // the whole budget went into thinking → one roomier retry, thinking off
      try {
        const again = await sendWithLearning(Math.max(base * 2, gem ? 8192 : 1024), gem ? 'none' : null);
        out = textOf(again);
        if (out) { ring.info('ai.retry', `AI "${p}" needed a bigger reply budget (thinking model) — got the answer on retry`); return out; }
        data = again;
      } catch { /* keep the honest error below */ }
      const fr2 = String(data?.choices?.[0]?.finish_reason || fr);
      const msg = fr2 === 'content_filter' ? 'BLOCKED (the provider filtered this reply as unsafe — try another model)'
        : (fr2 === 'length' || gem) ? 'EMPTY (the model spent its whole reply budget on internal "thinking" and returned no text — it will retry automatically; if it keeps happening pick a non-thinking model like gemini-3.5-flash-lite)'
          : 'EMPTY (model returned no text — press Test again)';
      const e = new Error(msg); e.code = 'EMPTY'; throw e;
    }
    return out;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('NETWORK timeout'); e.code = 'NETWORK'; throw e; }
    if (!err.code) err.code = 'NETWORK';
    throw err;
  } finally { clearTimeout(t); }
}

async function call(prompt, opts = {}) {
  if (!S.getBool('privacy.ai.content', false)) throw new Error('AI content sharing is off. Enable it in Settings → AI first.');
  const p = providerOf();
  if (paused(p)) throw new Error('paused');
  try { return await rawCall(p, prompt, opts); }
  catch (err) { trip(p, err.message); throw err; }
}

/* ══════════ 5C (R54): per-feature provider + model + usage meter ══════════
 * Every AI feature can be pinned to its OWN provider/model (Settings · AI).
 * Empty = follow the global choice. Every call records calls+tokens in
 * the ai_usage table, which powers the usage meter. */
const FEATURES_5C = ['beautify', 'translate', 'autoReply', 'composer', 'tldr', 'autobold', 'match', 'digest', 'assistant', 'transcribe'];
const featureProvider = (f) => String(S.get(`ai.feature.${f}.provider`, '')).trim().toLowerCase();
const featureModel = (f) => String(S.get(`ai.feature.${f}.model`, '')).trim();
async function callFor(feature, prompt, opts = {}) {
  if (!S.getBool('privacy.ai.content', false)) throw new Error('AI content sharing is off. Enable it in Settings → AI first.');
  const p = featureProvider(feature) || providerOf();
  if (!PROVIDERS[p]) { const e = new Error(`Unknown provider "${p}" for this feature`); e.code = 'NO_PROVIDER'; throw e; }
  if (paused(p)) throw new Error('paused');
  const t0 = Date.now();
  try {
    const out = await rawCall(p, prompt, opts, featureModel(feature) || null);
    try {
      require('./db').AIU.add(feature, p, featureModel(feature) || modelOf(p) || PROVIDERS[p].model || '', _lastUsage, Date.now() - t0);
    } catch { /* usage is best-effort, never blocks the feature */ }
    return out;
  } catch (err) { trip(p, err.message); throw err; }
}

/** 5C (R58): voice transcription — Gemini is the only provider wired for
    inline audio input; anything else gets an honest, actionable error. */
async function transcribe(buf, mime = 'audio/ogg') {
  if (!S.getBool('privacy.ai.content', false)) throw new Error('AI content sharing is off. Enable it in Settings → AI first.');
  const p = featureProvider('transcribe') || providerOf();
  if (p !== 'gemini') throw new Error('Voice transcription needs a Gemini key (Settings · AI → pin the "Voice transcription" feature to Gemini) — the other providers are not wired for audio input.');
  const key = keyOf(p);
  if (!key) throw new Error('No Gemini key — add one in Settings · AI first.');
  const model = featureModel('transcribe') || modelOf(p) || PROVIDERS[p].model;
  const body = {
    contents: [{ parts: [
      { text: 'Transcribe this audio VERBATIM. Return ONLY the transcription in the original language — no labels, no commentary, no translations.' },
      { inline_data: { mime_type: mime, data: buf.toString('base64') } }
    ] }]
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`Gemini transcription failed (HTTP ${res.status}): ${detail || res.statusText}`);
  }
  const d = await res.json();
  const text = (d?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty transcription.');
  try { require('./db').AIU.add('transcribe', p, model, 0, 0); } catch { }
  return text;
}

/** Live "Test connection" (Settings) — bypasses the breaker, honest result. */
async function testConnection() {
  const p = providerOf();
  const conf = PROVIDERS[p] || { name: p };
  if (!keyOf(p)) return { ok: false, error: `No key saved for ${conf.name}. Click "Get API key", create one, paste it above and Save first.` };
  if (!modelOf(p) && !conf.model) return { ok: false, error: `No model set — type a model id from the ${conf.name} catalog.` };
  const t0 = Date.now();
  try {
    /* v7.3.3: the reply must echo a random check token — proves the call really
       went to the provider and came back (a cached/fake instant OK can't pass). */
    const token = Math.random().toString(36).slice(2, 6).toUpperCase();
    const out = await rawCall(p, `Reply with exactly this text and nothing else: OK-${token}`, { timeoutMs: 25000, maxTokens: 20 });
    if (!String(out).includes(token)) return { ok: false, error: `Suspicious reply — "${String(out).slice(0, 60)}" does not contain the check token. The key or model is not actually answering; try another model.` };
    return { ok: true, ms: Date.now() - t0, sample: out.slice(0, 80), provider: conf.name, model: modelOf(p) };
  } catch (err) {
    const friendly = err.code === 'NO_KEY' ? 'No key saved.'
      : /HTTP_401|HTTP_403|valid API key|invalid.*key/i.test(err.message) ? 'Key rejected — check you copied the whole key and that it is valid (Google answers "Please pass a valid API key" for bad keys).'
        : /HTTP_404/.test(err.message) ? 'Endpoint or model not found — check the model id.'
          : /HTTP_429/.test(err.message) ? 'Rate limited / quota exhausted — try again later or add credits.'
            : err.message;
    return { ok: false, error: friendly, provider: conf.name, model: modelOf(p) };
  }
}

const usable = () => S.getBool('privacy.ai.content', false) && Boolean(keyOf(providerOf())) && Boolean(modelOf(providerOf()) || PROVIDERS[providerOf()]?.model);

/** Owner's find→replace rules ("old=>new" per line, max 30).
    5F (R79): a line starting with "-" is a DISABLED rule ("- old=>new") —
    it is stored but never applied, so per-rule enable is a pure text toggle. */
function applyReplacements(t) {
  const rules = String(S.get('replace.rules', '')).split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);
  for (const r of rules) {
    if (r.startsWith('-')) continue; // disabled rule (5F)
    const i = r.indexOf('=>');
    if (i < 1) continue;
    const from = r.slice(0, i).trim();
    const to = r.slice(i + 2).trim();
    if (from) t = t.split(from).join(to);
  }
  return t;
}

/** Regex cleaning — always on, zero cost, the baseline of every post. */
function regexClean(text) {
  let t = String(text || '');
  t = t.replace(/https?:\/\/(wa\.me|whatsapp\.com\/channel)\/\S+/gi, ''); // channel promos
  t = t.replace(/^\s*[-–—=~*]{3,}\s*$/gm, '');                             // divider lines
  t = applyReplacements(t);                                                // owner's find→replace
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** AI beautify — returns cleaned+beautified text, or the regex-cleaned fallback. */
async function beautify(text, styleHint) {
  const base = regexClean(text);
  if (!base) return base;
  if (!usable() || paused(providerOf())) return base;
  const custom = String(S.get('ai.prompt', '')).trim();
  const prompt = (custom ||
    'You clean up WhatsApp channel posts for re-publishing. Rewrite this post: fix spacing, remove promotional watermarks and channel names, keep the ORIGINAL language (Urdu stays Urdu, English stays English), keep ALL facts, links and numbers exactly. Add a short clear title line at the top. Reply with ONLY the cleaned post, nothing else.')
    + (String(styleHint || '').trim() ? `\n\nTEMPLATE STYLE INSTRUCTION (v7.6.0): rewrite the post in this style — ${String(styleHint).trim()} — while keeping every fact.` : '');
  try {
    const out = await callFor('beautify', `${prompt}\n\nPOST:\n${base.slice(0, 3000)}`);
    return out.length > 40 ? out : base;
  } catch { return base; } // never block a post on AI
}

/** Translate a post (fail-open: original text comes back on any problem). */
async function translate(text, lang) {
  const input = String(text || '').trim();
  if (!input || !String(lang || '').trim() || !usable() || paused(featureProvider('translate') || providerOf())) return input;
  try {
    const out0 = await callFor('translate', `Translate this WhatsApp post to ${String(lang).trim()}. Keep the tone and ALL facts, links and numbers exactly. Reply with ONLY the translation.\n\nPOST:\n${input.slice(0, 3000)}`);
    if (!out0 || out0.length < 10) return input;
    /* 5C (R57): glossary is ENFORCED on every translation — the owner's terms
       win over the model's word choices (applied again at the pipeline level,
       which is idempotent for well-formed terms). */
    try {
      const GL = require('./db').GL;
      const gl = GL.list();
      if (gl.length) return GL.apply(out0);
    } catch { }
    return out0;
  } catch { return input; }
}

/** Owner chat ("Ask AI" tab) — conversation with the bot's AI. */
async function chat(message) {
  const userMsg = String(message || '').trim();
  if (!userMsg) throw new Error('Type a message first.');
  if (!S.getBool('privacy.ai.content', false)) throw new Error('AI content sharing is off. Enable it in Settings → AI first.');
  if (!usable()) throw new Error('Add an AI key first (Settings → AI provider). The OpenRouter free model works with a $0 balance.');
  if (paused(providerOf())) {
    const p = providerOf();
    const mins = Math.max(1, Math.ceil(((pausedUntil[p] || 0) - Date.now()) / 60000));
    throw new Error(`AI is paused for ~${mins} more minute(s) — ${pauseLabel[p] || 'circuit breaker'}. If you just fixed the key, press Save once: that re-arms the AI immediately.`);
  }
  const past = require('./db').AICHAT.history(16).map((h) => `${h.role === 'user' ? 'Owner' : 'You'}: ${h.content}`).join('\n');
  const prompt = `You are the helpful assistant inside the Raqifluz Channel Bot dashboard. Answer the owner's questions clearly and briefly (WhatsApp channel tips, post writing, general questions). Previous conversation:\n${past || '(new conversation)'}\n\nOwner: ${userMsg.slice(0, 2000)}\nYou:`;
  const out = await callFor('assistant', prompt, { maxTokens: 900, timeoutMs: 30000 });
  return out;
}

/** Summarize the day's posts into a digest (used by the daily digest feature). */
async function summarize(items, lang) {
  const list = items.map((t, i) => `${i + 1}. ${String(t).replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
  return callFor('digest', `Summarize today's WhatsApp channel posts into ONE attractive digest post${lang ? ` in ${lang}` : ''}: a "📰 DAILY DIGEST" title, 4-8 short bullet points of the most important items, nothing invented. Reply with ONLY the digest post.\n\nPOSTS:\n${list.slice(0, 6000)}`, { maxTokens: 900, timeoutMs: 30000 });
}

/** Auto-reply generator for incoming personal messages (fail = null, never throws). */
async function autoReply(newMessage, recent) {
  const ctx = (recent || []).slice(-4).map((m) => `${m.from_me ? 'Owner' : 'Them'}: ${m.body}`).join('\n');
  const custom = String(S.get('power.aireply.prompt', '')).trim();
  const instruction = custom ||
    'You are replying on behalf of the owner of this WhatsApp number. Be brief, warm and helpful. Reply in the SAME LANGUAGE as the last message.';
  try {
    return await callFor('autoReply', `${instruction}\n\nConversation so far:\n${ctx || '(start)'}\nThem: ${String(newMessage || '').slice(0, 1000)}\nYour reply (plain text, max 3 sentences):`, { maxTokens: 300, timeoutMs: 20000 });
  } catch { return null; }
}

/** AI pilot — does this post match the owner's picking rules? null = AI unavailable → FAIL OPEN. */
async function matches(text, criteria) {
  const input = String(text || '').trim();
  if (!input || !String(criteria || '').trim() || !usable() || paused(featureProvider('match') || providerOf())) return null;
  try {
    const out = await callFor('match', `Does this WhatsApp channel post match this rule? RULE: "${criteria}". POST: "${input.slice(0, 2000)}". Answer strictly YES or NO.`);
    return /^\s*yes[.!]?\s*$/i.test(out) ? true : /^\s*no[.!]?\s*$/i.test(out) ? false : null;
  } catch { return null; }
}


/* ══════════ v7.1: model discovery — the picker shows what each AI really offers ══════════
 * Every OpenAI-compatible provider can list its own models at <base>/models.
 * Gemini and Claude are asked in their native ways. Results are cached for
 * 10 minutes; any failure silently falls back to the curated built-in list,
 * so the picker NEVER comes up empty.
 */
const MODEL_CACHE = {};                        // provider → { at, list, error }
const MODEL_TTL = 10 * 60e3;
const JUNK = /embed|whisper|tts|dall-e|audio|rerank|moderation|imagen|veo|sora|stable-diffusion|sensevoice|deprecated|guard/i;
const MAX_LIST = 150;

function modelsEndpoint(p) {
  const conf = PROVIDERS[p] || {};
  if (p === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/models';
  if (p === 'claude') return 'https://api.anthropic.com/v1/models';
  return String(conf.url || '').replace(/\/chat\/completions.*$/, '/models');
}
/** one provider → its live model ids (throws on any failure) */
async function fetchLiveModels(p, key, timeoutMs = 12000) {
  const url = modelsEndpoint(p);
  if (!url) throw new Error('no models endpoint');
  const headers = {};
  if (p === 'claude') { headers['x-api-key'] = key; headers['anthropic-version'] = '2023-06-01'; }
  else if (key) headers.Authorization = `Bearer ${key}`;
  const full = p === 'gemini' && key ? `${url}?key=${encodeURIComponent(key)}&pageSize=200` : url;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(full, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.data || data.models || [];
    let list = raw.map((m) => String(m.id || m.name || '').trim()).filter(Boolean);
    if (p === 'gemini') {                     // "models/gemini-2.5-flash" → "gemini-2.5-flash", chat-capable only
      const capable = new Set((raw || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => String(m.name || '').replace(/^models\//, '')));
      list = list.map((x) => x.replace(/^models\//, '')).filter((x) => capable.size ? capable.has(x) : true);
    }
    list = [...new Set(list)].filter((m) => !JUNK.test(m));
    if (!list.length) throw new Error('empty list');
    list.sort((a, b) => {
      const fa = /flash|mini|haiku|small|turbo|instant|8b|20b/i.test(a) ? 0 : 1;
      const fb = /flash|mini|haiku|small|turbo|instant|8b|20b/i.test(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;                    // cheap/fast models first
      const ra = /:free|free/i.test(a) ? 0 : 1;
      const rb = /:free|free/i.test(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;                    // free tiers before paid
      return a.localeCompare(b);
    });
    return list.slice(0, MAX_LIST);
  } finally { clearTimeout(t); }
}
/** what the UI shows: live list when reachable, otherwise the curated built-ins */
async function listModels(p, { refresh = false } = {}) {
  const conf = PROVIDERS[p];
  if (!conf) throw new Error('Unknown provider.');
  const key = keyOf(p);
  const builtin = conf.models || [];
  const cached = MODEL_CACHE[p];
  if (!refresh && cached && Date.now() - cached.at < MODEL_TTL) {
    return { provider: p, name: conf.name, default: modelOf(p) || conf.model, list: cached.list, source: cached.source, live: cached.source === 'live', error: cached.error || '', canFetch: Boolean(key) || p === 'openrouter' };
  }
  let live = null, error = '';
  // OpenRouter lists its catalog publicly — try even without a key
  if (key || p === 'openrouter') {
    try { live = await fetchLiveModels(p, key, 12000); } catch (err) { error = String(err?.message || err).slice(0, 120); }
  } else {
    error = 'no API key saved yet — press Save AI settings (or Fetch live model list) and the real list from ' + conf.name + ' loads automatically';
  }
  const list = live && live.length ? live : builtin;
  const saved = modelOf(p) || conf.model;
  if (saved && !list.includes(saved)) list.unshift(saved);   // never lose a saved custom model
  MODEL_CACHE[p] = { at: Date.now(), list, source: live ? 'live' : 'builtin', error };
  return { provider: p, name: conf.name, default: saved, list, source: live ? 'live' : 'builtin', live: Boolean(live), error, canFetch: Boolean(key) || p === 'openrouter' };
}

/** Full state for the UI — includes every provider's name/key link/models/free flag. */
function state() {
  const p = providerOf();
  return {
    contentSharing: S.getBool('privacy.ai.content', false), provider: p, model: modelOf(p), hasKey: Boolean(keyOf(p)), paused: Date.now() < (pausedUntil[p] || 0),
    keyStatus: Object.fromEntries(Object.keys(PROVIDERS).map((id) => [id, Boolean(keyOf(id))])),   // v7.3.3
    pauseInfo: { until: pausedUntil[p] || 0, label: pauseLabel[p] || '' },                              // v7.3.3
    providers: Object.entries(PROVIDERS).map(([id, c]) => ({ id, name: c.name, keyUrl: c.keyUrl, free: Boolean(c.free), models: c.models }))
  };
}

module.exports = {
  beautify, regexClean, matches, translate, chat, summarize, autoReply, state, testConnection, listModels,
  call,   // v7.4.0: exposed for the AI bot-control loop (same breaker/learning, multi-message prompts)
  callFor, transcribe, FEATURES_5C,   // 5C (R54/R58): per-feature AI + voice transcription
  usable, providerOf,                 // 5D (R64): health score reads the AI state
  applyReplacements,                  // 5F (R79): exposed for per-rule unit tests
  setProvider: (p) => { if (PROVIDERS[p]) S.set('ai.provider', p); },
  setKey: (p, k) => { if (PROVIDERS[p]) S.set(`ai.key.${p}`, k); },
  setModel: (p, m) => { if (PROVIDERS[p]) S.set(`ai.model.${p}`, m); },
  clearPause,
};
