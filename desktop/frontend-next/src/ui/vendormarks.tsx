// vendormarks.tsx — vendor artwork keyed by the slug a preset declares.
const FILES = import.meta.glob("../assets/vendor-marks/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const MARKS: Record<string, { file: string; name: string }> = {
  deepseek: { file: "deepseek-color", name: "DeepSeek" },
  zhipu: { file: "zhipu-color", name: "Zhipu" },
  kimi: { file: "kimi-color", name: "Kimi" },
  minimax: { file: "minimax-color", name: "MiniMax" },
  qwen: { file: "qwen-color", name: "Qwen" },
  mimo: { file: "xiaomimimo", name: "MiMo" },
  longcat: { file: "longcat-color", name: "LongCat" },
  stepfun: { file: "stepfun-color", name: "StepFun" },
  openrouter: { file: "openrouter", name: "OpenRouter" },
  openai: { file: "openai", name: "OpenAI" },
  google: { file: "gemini-color", name: "Google" },
  nvidia: { file: "nvidia-color", name: "NVIDIA" },
  ollama: { file: "ollama", name: "Ollama" },
  volcengine: { file: "volcengine-color", name: "Volcengine" },
  opencode: { file: "opencode", name: "OpenCode" },
  anthropic: { file: "anthropic", name: "Anthropic" },
  meta: { file: "meta-color", name: "Meta" },
  mistral: { file: "mistral-color", name: "Mistral" },
  perplexity: { file: "perplexity-color", name: "Perplexity" },
  azure: { file: "azure-color", name: "Azure" },
  hunyuan: { file: "hunyuan-color", name: "Hunyuan" },
  doubao: { file: "doubao-color", name: "Doubao" },
  magpie: { file: "magpie", name: "Magpie" },
  xai: { file: "xai", name: "xAI" },
  copilot: { file: "copilot", name: "GitHub Copilot" },
  cursor: { file: "cursor", name: "Cursor" },
  modelscope: { file: "modelscope-color", name: "ModelScope" },
  groq: { file: "groq", name: "Groq" },
  antigravity: { file: "antigravity-color", name: "Antigravity" },
  baiducloud: { file: "baiducloud-color", name: "Baidu Cloud" },
  huaweicloud: { file: "huaweicloud-color", name: "Huawei Cloud" },
  tencentcloud: { file: "tencentcloud-color", name: "Tencent Cloud" },
  huggingface: { file: "huggingface", name: "Hugging Face" },
  novita: { file: "novita", name: "Novita AI" },
  kilocode: { file: "kilocode", name: "Kilo Code" },
  gmi: { file: "gmi", name: "GMI Cloud" },
  "token-rhythm": { file: "token-rhythm", name: "Token Rhythm" },
};

const SOURCE = new Map<string, string>();
for (const [slug, { file }] of Object.entries(MARKS)) {
  const raw = FILES[`../assets/vendor-marks/${file}.svg`];
  if (raw) SOURCE.set(slug, raw.replace(/<title>.*?<\/title>/, "").replace(/ style="[^"]*"/, ""));
}

// The door a person names is not the family its models belong to: an account
// renamed magpie shows magpie's mark however its models read. One table for the
// doors, matched on the account's own name — separate from FAMILY_KEYS above,
// because a provider and a model vendor are two different labels.
const PROVIDER_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  [/magpie|喜鹊/i, "magpie"],
  [/copilot/i, "copilot"],
  [/cursor/i, "cursor"],
  [/modelscope|魔搭/i, "modelscope"],
  [/groq/i, "groq"],
  [/antigravity/i, "antigravity"],
  [/baidu/i, "baiducloud"],
  [/huawei/i, "huaweicloud"],
  [/tencent/i, "tencentcloud"],
  [/grok|xai/i, "xai"],
  [/xiaomi|mimo/i, "mimo"],
  [/openrouter/i, "openrouter"],
  [/ollama/i, "ollama"],
];

export function markForProvider(name: string | undefined): string | undefined {
  if (!name) return undefined;
  for (const [re, slug] of PROVIDER_KEYS) {
    if (re.test(name) && SOURCE.has(slug)) return slug;
  }
  return undefined;
}

export function hasVendorMark(slug: string | undefined): slug is string {
  return !!slug && SOURCE.has(slug);
}

// The family a model id names, by the keywords in it. A relay's models read as
// the family they name — deepseek-chat behind a magpie door is DeepSeek — so
// the mark follows the model and not the door it came through. One table, one
// place to add a family; a slug without artwork falls back to the door's mark,
// so a new family needs nothing but its svg to start working.
const FAMILY_KEYS: ReadonlyArray<readonly [RegExp, string]> = [
  [/deepseek/i, "deepseek"],
  [/glm|chatglm|zhipu|bigmodel/i, "zhipu"],
  [/qwen|qwq|qvq|tongyi/i, "qwen"],
  [/kimi|moonshot/i, "kimi"],
  [/doubao|seed[-_]?\d/i, "doubao"],
  [/hunyuan/i, "hunyuan"],
  [/minimax|abab/i, "minimax"],
  [/gemini|google/i, "google"],
  [/claude/i, "anthropic"],
  [/gpt|chatgpt|davinci|\bo[134]\b/i, "openai"],
  [/llama/i, "meta"],
  [/mistral|mixtral|codestral/i, "mistral"],
  [/nemotron/i, "nvidia"],
  [/sonar/i, "perplexity"],
  [/(^|[-_/])mimo/i, "mimo"],
  [/longcat/i, "longcat"],
  [/stepfun|step-\d/i, "stepfun"],
  [/grok|xai/i, "xai"],
];

// Some relays name their goods in private shorthand: qoder's single-letter
// models are the families they proxy, and no keyword in the id says so. One
// exact table for the names a relay has already shipped — the family the name
// stands for, matched on the bare id or its last path segment, so a provider
// prefix changes nothing. The NAMES themselves are not guessed here: a door
// that serves display names has them read through the refresh, and this table
// only carries the mark for the ids that say no family.
const MODEL_ALIASES: Readonly<Record<string, string>> = {
  fast: "qwen", qmodel_latest: "qwen", qmodel_38max: "qwen", qfmodel: "qwen",
  dmodel: "deepseek", dfmodel: "deepseek",
  gmodel: "zhipu", gfmodel: "zhipu",
  kmodel_latest: "kimi", kmodel: "kimi",
  jmodel: "stepfun",
  mmodel: "minimax", mmmodel: "minimax",
};

export function markForModelId(modelId: string | undefined): string | undefined {
  if (!modelId) return undefined;
  const bare = modelId.trim().toLowerCase();
  for (const candidate of [bare, bare.split("/").pop() ?? ""]) {
    const slug = MODEL_ALIASES[candidate];
    if (slug && SOURCE.has(slug)) return slug;
  }
  for (const [re, slug] of FAMILY_KEYS) {
    if (re.test(modelId) && SOURCE.has(slug)) return slug;
  }
  return undefined;
}

export function vendorName(slug: string): string {
  return MARKS[slug]?.name ?? slug;
}

/** Slugs in declaration order, for galleries that list every known vendor. */
export function vendorSlugs(): string[] {
  return [...SOURCE.keys()];
}

export function VendorMark({ slug, size = 18 }: { slug: string; size?: number }) {
  const svg = SOURCE.get(slug);
  if (!svg) return null;
  return <i className="vendor-mark" data-mark={slug} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}
