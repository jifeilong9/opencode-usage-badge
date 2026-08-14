"use strict";

/**
 * opencode-usage-badge client plugin: the browser half.
 *
 * Watches the active session's model selection; while the provider is
 * `opencode-go`, renders a usage badge into the composer's left tool row
 * (`conversation.input.left`) and polls the host `usageBadge` Remote every
 * 10 minutes (click to refresh immediately; hovering shows monthly percent +
 * reset countdowns). Failed polls fall back to the last successful report
 * (marked as cached), so the badge never flickers empty.
 *
 * This file is the esbuild source; build.mjs wraps it in the ModuleLoader
 * handshake into lib/client.js. react / react-dom / @deepseek-ai/* stay
 * external (the app's module system provides them).
 */
const React = require("react");

/** Locale namespace owned by this plugin. */
const NS = "opencode-usage-badge";

const zh = {
  badge: "用量 {rolling}% · 周 {weekly}%",
  badgeTitle: "用量：滚动 {rolling}% · 周 {weekly}% · 月 {monthly}%",
  badgeError: "用量获取失败：{message}",
  reload: "点击刷新",
  resetAll: "重置：滚动 {rolling} · 周 {weekly} · 月 {monthly}",
  resetNow: "即将重置",
  resetMin: "{m}分钟",
  resetHM: "{h}小时{m}分",
  resetH: "{h}小时",
  resetDH: "{d}天{h}小时",
  resetD: "{d}天",
  resetMD: "{m}月{d}天",
  resetMonth: "{m}月",
  staleSuffix: "（缓存数据，来自上次成功获取）",
};

const en = {
  badge: "Usage {rolling}% · weekly {weekly}%",
  badgeTitle: "Usage: rolling {rolling}% · weekly {weekly}% · monthly {monthly}%",
  badgeError: "Usage fetch failed: {message}",
  reload: "Click to refresh",
  resetAll: "Reset: rolling {rolling} · weekly {weekly} · monthly {monthly}",
  resetNow: "resets now",
  resetMin: "{m}m",
  resetHM: "{h}h {m}m",
  resetH: "{h}h",
  resetDH: "{d}d {h}h",
  resetD: "{d}d",
  resetMD: "{m}mo {d}d",
  resetMonth: "{m}mo",
  staleSuffix: "(cached from the last successful fetch)",
};

const STYLES = [
  ".ocu-usage{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;",
  "border-radius:24px;font-size:12px;line-height:18px;font-weight:500;",
  "color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;",
  "background:0 0;border:none;font-family:inherit;max-width:320px;}",
  ".ocu-usage:hover{background:var(--dsw-alias-interactive-bg-hover);}",
  ".ocu-usage-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}",
  ".ocu-usage-warn{color:var(--dsw-alias-state-warn-label);}",
  ".ocu-usage-danger{color:var(--dsw-alias-state-error-primary);}",
].join("\n");

function interpolate(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

function adoptStyles() {
  if (typeof document === "undefined") return;
  const tagId = "opencode-usage-badge/styles";
  if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "opencode-usage-badge";
  tag.dataset.pluginCss = tagId;
  tag.textContent = STYLES;
  document.head.appendChild(tag);
}

/** Passthrough wire codec; payloads are validated structurally before display. */
const PASS_SCHEMA = { parse: (value) => value };

/** One JSON parameter descriptor (passthrough codec). */
function jsonParam(name, acceptsUndefined = false) {
  return {
    name,
    wire: name,
    source: "json",
    ...(acceptsUndefined ? { acceptsUndefined: true } : {}),
    codec: { mode: "strict", typeSymbol: "opencode-usage-badge#" + name, schema: PASS_SCHEMA },
  };
}

/** The usageBadge Remote namespace's client contribution. */
const USAGE_REMOTE = {
  package: "opencode-usage-badge",
  descriptors: [
    {
      id: "opencode-usage-badge#usageBadge/resolve",
      service: "usageBadge",
      namespace: "usageBadge",
      method: "resolve",
      invocation: { kind: "direct" },
      parameters: [jsonParam("provider")],
      cancellation: { parameter: "signal" },
      result: { mode: "strict", typeSymbol: "opencode-usage-badge#ProviderResolution", schema: PASS_SCHEMA },
    },
    {
      id: "opencode-usage-badge#usageBadge/usage",
      service: "usageBadge",
      namespace: "usageBadge",
      method: "usage",
      invocation: { kind: "direct" },
      parameters: [jsonParam("provider")],
      cancellation: { parameter: "signal" },
      result: { mode: "strict", typeSymbol: "opencode-usage-badge#UsageReport", schema: PASS_SCHEMA },
    },
  ],
};

// ── usage badge ──────────────────────────────────────────────────────────────

function toneOf(percent) {
  if (percent === null) return "";
  if (percent >= 90) return "ocu-usage-danger";
  if (percent >= 70) return "ocu-usage-warn";
  return "";
}

function percentOf(usage, key) {
  const entry = usage != null && typeof usage === "object" ? usage[key] : undefined;
  return entry != null && typeof entry.percent === "number" ? entry.percent : null;
}

/** The reset timestamp (epoch ms) of one usage window, or null when absent. */
function resetsAtOf(usage, key) {
  const entry = usage != null && typeof usage === "object" ? usage[key] : undefined;
  if (entry == null || typeof entry.resetsAt !== "string") return null;
  const target = Date.parse(entry.resetsAt);
  return Number.isFinite(target) ? target : null;
}

/** Humanized countdown from `now` to `resetsAt`, or null when absent. */
function countdownTextOf(resetsAt, now, t, fmt) {
  if (resetsAt === null) return null;
  const totalMinutes = Math.floor(Math.max(0, resetsAt - now) / 60000);
  if (totalMinutes < 1) return fmt("resetNow", {});
  if (totalMinutes < 60) return fmt("resetMin", { m: String(totalMinutes) });
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) {
    return minutes > 0 ? fmt("resetHM", { h: String(hours), m: String(minutes) }) : fmt("resetH", { h: String(hours) });
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  if (days < 31) {
    return restHours > 0 ? fmt("resetDH", { d: String(days), h: String(restHours) }) : fmt("resetD", { d: String(days) });
  }
  const months = Math.floor(days / 30);
  const restDays = days % 30;
  return restDays > 0 ? fmt("resetMD", { m: String(months), d: String(restDays) }) : fmt("resetMonth", { m: String(months) });
}

function UsageBadge(props) {
  const sessionId = typeof props.sessionId === "string" ? props.sessionId : props.session && props.session.id;
  const models = props.models;
  const usageCall = props.usage;
  const resolveCall = props.resolve;
  const [current, setCurrent] = React.useState(null);
  const [resolved, setResolved] = React.useState(null); // { provider, isOpencode } | null
  const [usage, setUsage] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [nonce, setNonce] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());

  // The badge shows when the host confirms the provider route is opencode:
  // its id is the configured opencode provider id, or its declared baseURL
  // points at the opencode endpoint (`sessions.models` never carries
  // baseURL to the browser, so the host resolves this from settings).
  const active = resolved !== null && current !== null && current !== undefined &&
    resolved.provider === current.provider && resolved.isOpencode === true;

  // Minute-granular clock so hover reset countdowns stay fresh.
  React.useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [active]);

  // Track the session's live model selection (provider/model/reasoningEffort).
  React.useEffect(() => {
    if (typeof sessionId !== "string" || sessionId.length === 0 || models === undefined) return undefined;
    let directory;
    try {
      directory = models.directoryFor(sessionId);
    } catch (err) {
      console.warn("[opencode-usage-badge] model directory unavailable:", err);
      return undefined;
    }
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      try {
        setCurrent(directory.store.getSnapshot().current);
      } catch (err) {
        // snapshot shape is a runtime detail; ignore transient reads
      }
    };
    sync();
    directory.load().then(sync, () => {});
    const stop = directory.store.subscribe(sync);
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId, models]);

  // Ask the host whether the active provider route is opencode (provider id
  // or baseURL match). Only the newest provider's answer wins the race.
  React.useEffect(() => {
    const provider = current !== null && current !== undefined ? current.provider : undefined;
    if (provider === undefined || resolveCall === undefined) return undefined;
    let cancelled = false;
    Promise.resolve()
      .then(() => resolveCall(provider))
      .then((result) => {
        if (cancelled) return;
        if (result != null && result.ok === true && result.value != null) {
          setResolved({ provider, isOpencode: result.value.isOpencode === true });
        } else {
          setResolved({ provider, isOpencode: false });
        }
      }, () => {
        if (cancelled) return;
        setResolved({ provider, isOpencode: false });
      });
    return () => {
      cancelled = true;
    };
  }, [current, resolveCall]);

  // Poll the host Remote while the opencode-go provider is active. The
  // provider id travels with the call so the host resolves the API key from
  // the live model configuration (`llm-pi-ai.providers.<provider>.apiKeyEnv`).
  // Polling starts only after the host confirmed the route is opencode.
  React.useEffect(() => {
    const provider = current !== null && current !== undefined ? current.provider : undefined;
    if (!active || provider === undefined || usageCall === undefined) return undefined;
    let cancelled = false;
    let timer = null;
    const refresh = () => {
      Promise.resolve()
        .then(() => usageCall(provider))
        .then((result) => {
          if (cancelled) return;
          if (result != null && result.ok === true) {
            setUsage(result.value);
            setError(null);
          } else if (result != null) {
            setUsage(null);
            setError(result.error && result.error.message ? String(result.error.message) : String(result.error));
          } else {
            setUsage(null);
            setError("no result");
          }
        }, (err) => {
          if (cancelled) return;
          setUsage(null);
          setError(String(err && err.message ? err.message : err));
        });
    };
    refresh();
    timer = setInterval(refresh, 600000);
    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
    };
  }, [active, usageCall, nonce, current]);

  if (!active) return null;

  const t = (key) => {
    try {
      return props.t(key);
    } catch (err) {
      return key;
    }
  };
  const fmt = (key, values) => interpolate(t(key), values);
  const rolling = percentOf(usage, "rolling");

  if (error !== null) {
    const message = error.length > 48 ? error.slice(0, 48) + "…" : error;
    return React.createElement(
      "button",
      {
        type: "button",
        className: "ocu-usage ocu-usage-danger",
        title: fmt("reload", {}),
        onClick: () => setNonce((n) => n + 1),
        "aria-label": message,
      },
      React.createElement("span", { className: "ocu-usage-dot" }),
      React.createElement("span", null, fmt("badgeError", { message }))
    );
  }

  const weekly = percentOf(usage, "weekly");
  const monthly = percentOf(usage, "monthly");
  const values = {
    rolling: usage === null ? "…" : (rolling !== null ? String(rolling) : "?"),
    weekly: usage === null ? "…" : (weekly !== null ? String(weekly) : "?"),
    monthly: usage === null ? "…" : (monthly !== null ? String(monthly) : "?"),
  };
  const resetValues = {
    rolling: usage !== null ? countdownTextOf(resetsAtOf(usage, "rolling"), now, t, fmt) ?? "?" : "?",
    weekly: usage !== null ? countdownTextOf(resetsAtOf(usage, "weekly"), now, t, fmt) ?? "?" : "?",
    monthly: usage !== null ? countdownTextOf(resetsAtOf(usage, "monthly"), now, t, fmt) ?? "?" : "?",
  };
  const stale = usage !== null && usage.stale === true;
  const title = usage !== null
    ? fmt("badgeTitle", values) + "\n" + fmt("resetAll", resetValues) + (stale ? "\n" + t("staleSuffix") : "")
    : fmt("reload", {});
  const label = fmt("badge", values);
  return React.createElement(
    "button",
    {
      type: "button",
      className: "ocu-usage " + toneOf(rolling),
      title,
      onClick: () => setNonce((n) => n + 1),
      "aria-label": label,
    },
    React.createElement("span", { className: "ocu-usage-dot" }),
    React.createElement("span", null, label)
  );
}

/** Required services: slots, the gateway Remote face, locale, and the model directory. */
const inject = ["slots", "remote", "locale", "modelDirectories"];

/**
 * Compose the plugin.
 * @param ctx - client root context.
 */
function apply(ctx) {
  adoptStyles();
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "opencode-usage-badge: dictionaries");

  // The mounted namespace handles resolve through the service store
  // (`ctx.reflect.get`), not through dotted `ctx.remote.<ns>` reads: the
  // generated-style dotted read walks the cordis fiber chain, which stops at
  // the Loader's runtime-less internal forks between a plugin entry and the
  // root fiber — the namespace services mounted under the gateway entry are
  // unreachable that way (the store path resolves them by isolation label).
  //
  // Mounting is async; every call site awaits this promise so the first
  // usage poll can never race the mount.
  const remotesPromise = (async () => {
    // One contribution per package: a single $mount carries the descriptor.
    const dispose = await ctx.remote.$mount({
      package: "opencode-usage-badge",
      descriptors: USAGE_REMOTE.descriptors,
    });
    const usageRemote = ctx.reflect.get("remote.usageBadge");
    if (usageRemote === undefined) {
      throw new Error("opencode-usage-badge: the usageBadge Remote namespace did not mount");
    }
    return { usageRemote, dispose };
  })();
  ctx.effect(() => () => {
    void remotesPromise.then(({ dispose }) => {
      void dispose();
    }, () => {});
  }, "opencode-usage-badge: remote cleanup");

  const usage = async (provider) => {
    try {
      const { usageRemote } = await remotesPromise;
      return usageRemote.usage(provider);
    } catch (err) {
      return { ok: false, error: { code: "MOUNT_FAILED", message: String(err && err.message ? err.message : err) } };
    }
  };

  const resolve = async (provider) => {
    try {
      const { usageRemote } = await remotesPromise;
      return usageRemote.resolve(provider);
    } catch (err) {
      return { ok: false, error: { code: "MOUNT_FAILED", message: String(err && err.message ? err.message : err) } };
    }
  };

  // Usage badge: composer left tool row.
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "opencode-usage-badge-usage",
    locale: NS,
    inject: () => ({
      usage,
      resolve,
      models: ctx.get("modelDirectories"),
    }),
  }, UsageBadge));
}

module.exports = { inject, apply };
