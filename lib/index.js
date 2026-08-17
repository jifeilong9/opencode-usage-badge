/**
 * opencode-usage-badge host plugin.
 *
 * Exposes one Typert Remote service, `usageBadge`: read the opencode go usage
 * report (rolling / weekly / monthly percent) for the active model provider.
 *
 * The API key is NEVER baked into this package. Per call it is resolved from
 * the live model configuration (`llm-pi-ai` settings namespace
 * `providers.<provider>.apiKeyEnv` — the same configuration the model route
 * itself uses), then through the harness credential seam, then the
 * environment variable of that name. An explicit `apiKey` / `endpoint`
 * plugin-config override exists for unusual deployments.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Agent, fetch as undiciFetch } from 'undici'

/** Stable Cordis plugin name (the Loader entry and client bundle id). */
export const name = 'opencode-usage-badge'

/** Services required before load: the Typert registry. */
export const inject = ['typert']

/** The default opencode usage endpoint. */
export const USAGE_ENDPOINT = 'https://opencode.ai/zen/go/v1/usage'

/**
 * Lifetime of the per-provider report cache (config `cacheTtlMs` override).
 * Usage is account-wide, so every session view shares one report; serving a
 * fresh-enough copy instantly avoids a network round-trip on every session
 * switch / remount and lets all open conversation views share a single fetch.
 */
export const USAGE_CACHE_TTL_MS = 5 * 60_000

/**
 * Default provider id treated as opencode (the llm-pi-ai route key).
 * Overridable through plugin config `providerId`.
 */
export const DEFAULT_PROVIDER_ID = 'opencode-go'

/**
 * Default baseURL prefix treated as opencode (trailing slash stripped).
 * Overridable through plugin config `baseUrlPrefix`.
 */
export const DEFAULT_BASE_URL_PREFIX = 'https://opencode.ai/zen/go'

/** Settings namespace owned by the llm-pi-ai model route. */
export const LLM_PI_AI_NS = settingsNamespace('llm-pi-ai')

/** Fetch attempts and backoff for the usage endpoint. */
export const USAGE_ATTEMPTS = 3
export const USAGE_TIMEOUT_MS = 30_000

/**
 * Keep-alive agent for the usage endpoint. On proxied/fake-ip DNS networks a
 * fresh TCP connection is slow (~10s) while pooled connections answer in
 * ~350ms; undici's default 4s keep-alive would re-pay that cost on every
 * poll, so hold the pool open and allow generous timeouts.
 */
const usageAgent = new Agent({
  keepAliveTimeout: 600_000,
  keepAliveMaxTimeout: 3_600_000,
  connect: { timeout: 30_000 },
  headersTimeout: 30_000,
  bodyTimeout: 30_000,
})

/**
 * Passthrough wire codec. The strict Typert registry only requires
 * `codec.schema.parse` to be a function; payloads are validated structurally
 * in the client before display, so the wire schemas stay open.
 */
const passSchema = { parse: (value) => value }

/** One JSON parameter descriptor (passthrough codec). */
function jsonParam(name, acceptsUndefined = false) {
  return {
    name,
    wire: name,
    source: 'json',
    ...acceptsUndefined ? { acceptsUndefined: true } : {},
    codec: { mode: 'strict', typeSymbol: `opencode-usage-badge#${name}`, schema: passSchema },
  }
}

/** The usageBadge Remote namespace's strict invocation descriptors. */
export const USAGE_INVOCATIONS = [
  {
    id: 'opencode-usage-badge#usageBadge/resolve',
    service: 'usageBadge',
    namespace: 'usageBadge',
    method: 'resolve',
    invocation: { kind: 'direct' },
    parameters: [jsonParam('provider')],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'opencode-usage-badge#ProviderResolution', schema: passSchema },
  },
  {
    id: 'opencode-usage-badge#usageBadge/usage',
    service: 'usageBadge',
    namespace: 'usageBadge',
    method: 'usage',
    invocation: { kind: 'direct' },
    parameters: [jsonParam('provider'), jsonParam('force', true)],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'opencode-usage-badge#UsageReport', schema: passSchema },
  },
]

/** The usageBadge service member of the host manifest. */
const USAGE_SERVICE = {
  key: 'usageBadge',
  exportName: 'UsageBadgeRuntime',
  description: 'Read the opencode usage report (rolling/weekly/monthly percent) for one model provider.',
  tags: [],
  members: [
    {
      kind: 'method',
      name: 'resolve',
      signature: 'resolve(provider: string, signal?: AbortSignal): Promise<ProviderResolution>',
    },
    {
      kind: 'method',
      name: 'usage',
      signature: 'usage(provider: string, force?: boolean, signal?: AbortSignal): Promise<UsageReport>',
    },
  ],
  types: [],
}

/** The single host manifest for this package (one package face per package). */
export const TYPERT_MANIFEST = {
  package: 'opencode-usage-badge',
  face: 'host',
  schemas: [],
  model: {
    services: [USAGE_SERVICE],
    events: [],
    objects: [],
  },
  invocations: USAGE_INVOCATIONS,
}

/**
 * Normalize a URL for prefix comparison: strip a trailing slash and fold
 * scheme/host to lower case (path case is preserved).
 * @param url - the URL to normalize.
 * @returns the normalized string.
 */
export function normalizeUrlPrefix(url) {
  const trimmed = String(url).trim().replace(/\/+$/, '')
  const schemeEnd = trimmed.indexOf('://')
  if (schemeEnd === -1) return trimmed
  const scheme = trimmed.slice(0, schemeEnd).toLowerCase()
  const rest = trimmed.slice(schemeEnd + 3)
  const hostEnd = rest.search(/[/?#]/)
  const host = (hostEnd === -1 ? rest : rest.slice(0, hostEnd)).toLowerCase()
  return scheme + '://' + host + (hostEnd === -1 ? '' : rest.slice(hostEnd))
}

/**
 * The baseURL a provider route declares in the `llm-pi-ai` settings
 * namespace (`providers.<provider>.baseURL`), or undefined when it declares
 * none (an installed pi-ai catalog route without an override).
 * @param ctx - owning cordis context.
 * @param providerId - the model provider id the client reports.
 * @returns the declared baseURL, or undefined.
 */
export function providerBaseUrl(ctx, providerId) {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  try {
    const section = settings.get(LLM_PI_AI_NS)
    if (section == null || typeof section !== 'object') return undefined
    const providers = section.providers
    if (providers == null || typeof providers !== 'object') return undefined
    const entry = providers[providerId]
    if (entry == null || typeof entry !== 'object') return undefined
    if (typeof entry.baseURL === 'string' && entry.baseURL.length > 0) return entry.baseURL
  } catch {
    // the llm-pi-ai namespace is not registered — treat as no declaration
  }
  return undefined
}

/**
 * Read the API-key reference a model provider declares in the `llm-pi-ai`
 * settings namespace — the same `providers.<provider>.apiKeyEnv` the model
 * route itself uses. Nothing opencode-specific is baked in: any provider
 * entry with an `apiKeyEnv` works.
 * @param ctx - owning cordis context.
 * @param providerId - the model provider id the client reports.
 * @returns the credential reference name, or undefined when the provider
 *   declares none.
 */
export function providerApiKeyReference(ctx, providerId) {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  try {
    const section = settings.get(LLM_PI_AI_NS)
    if (section == null || typeof section !== 'object') return undefined
    const providers = section.providers
    if (providers == null || typeof providers !== 'object') return undefined
    const entry = providers[providerId]
    if (entry == null || typeof entry !== 'object') return undefined
    if (typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv.length > 0) return entry.apiKeyEnv
  } catch {
    // the llm-pi-ai namespace is not registered — treat as no reference
  }
  return undefined
}

/**
 * Resolve the API key for one provider, per call: plugin-config override,
 * then the provider's declared `apiKeyEnv` reference through the harness
 * credential seam, then the environment variable of that name.
 * @param ctx - owning cordis context (services are optional).
 * @param config - resolved plugin configuration.
 * @param providerId - the model provider id the client reports.
 * @returns the bearer key.
 * @throws when no key can be resolved, naming the exact configuration to fix.
 */
export async function resolveApiKey(ctx, config, providerId) {
  if (config?.apiKey != null && typeof config.apiKey === 'string' && config.apiKey.length > 0) {
    return config.apiKey
  }
  const reference = providerApiKeyReference(ctx, providerId)
  if (reference === undefined) {
    throw new Error(
      `opencode-usage-badge: provider "${providerId}" declares no apiKeyEnv under llm-pi-ai.providers in the settings document — add it there (the web Models page writes it) or set the plugin config apiKey`,
    )
  }
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    try {
      const hit = await credentials.resolve(credentialRef(reference))
      if (hit != null && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
    } catch {
      // fall through to the ambient environment
    }
  }
  const ambient = process.env[reference]
  if (typeof ambient === 'string' && ambient.length > 0) return ambient
  throw new Error(
    `opencode-usage-badge: no value for "${reference}" (llm-pi-ai.providers.${providerId}.apiKeyEnv) — store it through the harness credentials (the web Models page) or set the environment variable`,
  )
}

/**
 * Fetch the usage report from the opencode usage endpoint, retrying transient
 * connect failures. On proxied/fake-ip networks the first TCP connection is
 * slow and frequently times out, while the retry on the pooled connection
 * answers in hundreds of milliseconds.
 * @param apiKey - bearer key.
 * @param endpoint - the usage endpoint (config override or the default).
 * @param signal - caller lifetime; an abort rejects the fetch immediately.
 * @returns the `usage` object (`{ rolling, weekly, monthly }`).
 */
export async function fetchUsageReport(apiKey, endpoint, signal) {
  let lastError
  for (let attempt = 0; attempt < USAGE_ATTEMPTS; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(USAGE_TIMEOUT_MS)
    const combined = signal !== undefined ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await undiciFetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: combined,
        dispatcher: usageAgent,
      })
      if (!response.ok) {
        throw new Error(`opencode usage endpoint responded HTTP ${response.status}`)
      }
      const body = await response.json()
      const usage = body != null && typeof body === 'object' ? body.usage : undefined
      if (usage == null || typeof usage !== 'object') {
        throw new Error('opencode usage endpoint returned no usage object')
      }
      // The endpoint occasionally answers with an empty/incomplete usage
      // structure; treat it like a failed fetch (retry / stale fallback)
      // instead of surfacing meaningless "?" values to the badge.
      for (const key of ['rolling', 'weekly', 'monthly']) {
        const entry = usage[key]
        if (entry == null || typeof entry !== 'object' || typeof entry.percent !== 'number' || typeof entry.resetsAt !== 'string') {
          throw new Error(`opencode usage endpoint returned an incomplete "${key}" window`)
        }
      }
      return usage
    } catch (error) {
      if (signal !== undefined && signal.aborted === true) throw error
      lastError = error
      if (attempt < USAGE_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
    }
  }
  throw lastError
}

/** The usageBadge Remote service: one usage report per provider. */
export class UsageBadgeRuntime extends TypertRemoteService {
  /**
   * Register the service under the `usageBadge` key (the wire namespace).
   * @param ctx - owning cordis context.
   * @param config - resolved plugin configuration.
   */
  constructor(ctx, config) {
    super(ctx, 'usageBadge')
    this.config = config ?? {}
    /** Fresh report per provider, served instantly (config `cacheTtlMs`). */
    this.reportCache = new Map()
    /** In-flight fetch per provider, shared by concurrent callers. */
    this.inflight = new Map()
    /** Provider id treated as opencode (config override, default opencode-go). */
    this.providerId = typeof this.config.providerId === 'string' && this.config.providerId.length > 0
      ? this.config.providerId
      : DEFAULT_PROVIDER_ID
    /** BaseURL prefix treated as opencode (config override). */
    this.baseUrlPrefix = typeof this.config.baseUrlPrefix === 'string' && this.config.baseUrlPrefix.length > 0
      ? this.config.baseUrlPrefix
      : DEFAULT_BASE_URL_PREFIX
    /** Report cache lifetime in ms (config override, default 5 minutes). */
    this.cacheTtlMs = typeof this.config.cacheTtlMs === 'number' && Number.isFinite(this.config.cacheTtlMs) && this.config.cacheTtlMs > 0
      ? this.config.cacheTtlMs
      : USAGE_CACHE_TTL_MS
  }

  /**
   * Whether one model provider route should show the usage badge: its id is
   * the configured opencode provider id, or its declared baseURL points at
   * the configured opencode baseURL prefix. The wire never carries baseURL
   * (`sessions.models` sends only provider/model), so this host-side check
   * reads the `llm-pi-ai` settings document directly.
   * @param provider - the model provider id the client reports.
   * @returns `{ provider, isOpencode, baseURL }` for the client to gate on.
   */
  async resolve(provider) {
    const isOpencode = provider === this.providerId
    const baseURL = isOpencode ? undefined : providerBaseUrl(this.ctx, provider)
    return {
      provider,
      isOpencode: isOpencode || (baseURL !== undefined && normalizeUrlPrefix(baseURL).startsWith(normalizeUrlPrefix(this.baseUrlPrefix))),
      baseURL: baseURL ?? null,
    }
  }

  /**
   * Read the current usage report for one model provider, serving a shared
   * per-provider cache when a fresh-enough copy exists: usage is account-wide,
   * so every session view (and every badge instance) reads the same report —
   * concurrent callers are deduplicated onto one fetch, and the cached copy is
   * returned instantly, with no per-session-switch network round-trip.
   * @param provider - the model provider id the client reports.
   * @param force - bypass the cache and fetch a fresh report (badge click).
   * @param signal - caller lifetime; an abort rejects the fetch.
   * @returns the `{ rolling, weekly, monthly }` usage report (with `stale:
   *   true` when the fetch failed and the last successful report is served).
   */
  async usage(provider, force, signal) {
    if (force !== true) {
      const hit = this.reportCache.get(provider)
      if (hit !== undefined && Date.now() - hit.at < this.cacheTtlMs) return hit.usage
      const pending = this.inflight.get(provider)
      if (pending !== undefined) return pending
    }
    const fetch = (async () => {
      const apiKey = await resolveApiKey(this.ctx, this.config, provider)
      const endpoint = this.config?.endpoint != null && typeof this.config.endpoint === 'string' && this.config.endpoint.length > 0
        ? this.config.endpoint
        : USAGE_ENDPOINT
      try {
        const usage = await fetchUsageReport(apiKey, endpoint, signal)
        this.reportCache.set(provider, { at: Date.now(), usage })
        return usage
      } catch (error) {
        // Serve the last successful report (any age) marked stale instead of
        // surfacing an error; the client already shows a stale suffix.
        const cached = this.reportCache.get(provider)
        if (cached !== undefined) return { ...cached.usage, stale: true }
        throw error
      }
    })()
    if (force !== true) {
      this.inflight.set(provider, fetch)
      fetch.finally(() => {
        if (this.inflight.get(provider) === fetch) this.inflight.delete(provider)
      }).catch(() => {})
    }
    return fetch
  }
}

/**
 * Mount the service and the host manifest.
 * @param ctx - host cordis context.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx, config) {
  new UsageBadgeRuntime(ctx, config)
  ctx.effect(() => {
    const dispose = ctx.typert.register(TYPERT_MANIFEST)
    return () => {
      void dispose()
    }
  }, 'opencode-usage-badge: typert manifest')
}
