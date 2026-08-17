window.__ModuleLoader__.load({ id: 'opencode-usage-badge', factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";

// src/client.js
var React = require("react");
var NS = "opencode-usage-badge";
var zh = {
  badge: "\u7528\u91CF {rolling}% \xB7 \u5468 {weekly}% \xB7 \u6708 {monthly}%",
  badgeError: "\u7528\u91CF\u83B7\u53D6\u5931\u8D25\uFF1A{message}",
  reload: "\u70B9\u51FB\u5237\u65B0",
  resetAll: "\u91CD\u7F6E\uFF1A\u6EDA\u52A8 {rolling} \xB7 \u5468 {weekly} \xB7 \u6708 {monthly}",
  resetNow: "\u5373\u5C06\u91CD\u7F6E",
  resetMin: "{m}\u5206\u949F",
  resetHM: "{h}\u5C0F\u65F6{m}\u5206",
  resetH: "{h}\u5C0F\u65F6",
  resetDH: "{d}\u5929{h}\u5C0F\u65F6",
  resetD: "{d}\u5929",
  resetMD: "{m}\u6708{d}\u5929",
  resetMonth: "{m}\u6708",
  staleSuffix: "\uFF08\u7F13\u5B58\u6570\u636E\uFF0C\u6765\u81EA\u4E0A\u6B21\u6210\u529F\u83B7\u53D6\uFF09"
};
var en = {
  badge: "Usage {rolling}% \xB7 weekly {weekly}% \xB7 monthly {monthly}%",
  badgeError: "Usage fetch failed: {message}",
  reload: "Click to refresh",
  resetAll: "Reset: rolling {rolling} \xB7 weekly {weekly} \xB7 monthly {monthly}",
  resetNow: "resets now",
  resetMin: "{m}m",
  resetHM: "{h}h {m}m",
  resetH: "{h}h",
  resetDH: "{d}d {h}h",
  resetD: "{d}d",
  resetMD: "{m}mo {d}d",
  resetMonth: "{m}mo",
  staleSuffix: "(cached from the last successful fetch)"
};
var STYLES = [
  ".ocu-usage{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;",
  "border-radius:24px;font-size:12px;line-height:18px;font-weight:500;",
  "color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;",
  "background:0 0;border:none;font-family:inherit;max-width:320px;}",
  ".ocu-usage:hover{background:var(--dsw-alias-interactive-bg-hover);}",
  ".ocu-usage-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none;}",
  ".ocu-usage-warn{color:var(--dsw-alias-state-warn-label);}",
  ".ocu-usage-danger{color:var(--dsw-alias-state-error-primary);}"
].join("\n");
function interpolate(template, values) {
  return template.replace(
    /\{(\w+)\}/g,
    (match, key) => Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
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
var PASS_SCHEMA = { parse: (value) => value };
function jsonParam(name, acceptsUndefined = false) {
  return {
    name,
    wire: name,
    source: "json",
    ...acceptsUndefined ? { acceptsUndefined: true } : {},
    codec: { mode: "strict", typeSymbol: "opencode-usage-badge#" + name, schema: PASS_SCHEMA }
  };
}
var USAGE_REMOTE = {
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
      result: { mode: "strict", typeSymbol: "opencode-usage-badge#ProviderResolution", schema: PASS_SCHEMA }
    },
    {
      id: "opencode-usage-badge#usageBadge/usage",
      service: "usageBadge",
      namespace: "usageBadge",
      method: "usage",
      invocation: { kind: "direct" },
      parameters: [jsonParam("provider"), jsonParam("force", true)],
      cancellation: { parameter: "signal" },
      result: { mode: "strict", typeSymbol: "opencode-usage-badge#UsageReport", schema: PASS_SCHEMA }
    }
  ]
};
function toneOf(percent) {
  if (percent === null) return "";
  if (percent >= 90) return "ocu-usage-danger";
  if (percent >= 70) return "ocu-usage-warn";
  return "";
}
function percentOf(usage, key) {
  const entry = usage != null && typeof usage === "object" ? usage[key] : void 0;
  return entry != null && typeof entry.percent === "number" ? entry.percent : null;
}
function resetsAtOf(usage, key) {
  const entry = usage != null && typeof usage === "object" ? usage[key] : void 0;
  if (entry == null || typeof entry.resetsAt !== "string") return null;
  const target = Date.parse(entry.resetsAt);
  return Number.isFinite(target) ? target : null;
}
function countdownTextOf(resetsAt, now, t, fmt) {
  if (resetsAt === null) return null;
  const totalMinutes = Math.floor(Math.max(0, resetsAt - now) / 6e4);
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
  const [resolved, setResolved] = React.useState(null);
  const [usage, setUsage] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [nonce, setNonce] = React.useState(0);
  const [now, setNow] = React.useState(() => Date.now());
  const forceRef = React.useRef(false);
  const active = resolved !== null && current !== null && current !== void 0 && resolved.provider === current.provider && resolved.isOpencode === true;
  React.useEffect(() => {
    if (!active) return void 0;
    const timer = setInterval(() => setNow(Date.now()), 6e4);
    return () => clearInterval(timer);
  }, [active]);
  React.useEffect(() => {
    if (typeof sessionId !== "string" || sessionId.length === 0 || models === void 0) return void 0;
    let directory;
    try {
      directory = models.directoryFor(sessionId);
    } catch (err) {
      console.warn("[opencode-usage-badge] model directory unavailable:", err);
      return void 0;
    }
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      try {
        setCurrent(directory.store.getSnapshot().current);
      } catch (err) {
      }
    };
    sync();
    directory.load().then(sync, () => {
    });
    const stop = directory.store.subscribe(sync);
    return () => {
      cancelled = true;
      stop();
    };
  }, [sessionId, models]);
  React.useEffect(() => {
    const provider = current !== null && current !== void 0 ? current.provider : void 0;
    if (provider === void 0 || resolveCall === void 0) return void 0;
    let cancelled = false;
    Promise.resolve().then(() => resolveCall(provider)).then((result) => {
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
  React.useEffect(() => {
    const provider = current !== null && current !== void 0 ? current.provider : void 0;
    if (!active || provider === void 0 || usageCall === void 0) return void 0;
    let cancelled = false;
    let timer = null;
    const refresh = () => {
      const force = forceRef.current === true;
      forceRef.current = false;
      Promise.resolve().then(() => usageCall(provider, force)).then((result) => {
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
    timer = setInterval(refresh, 6e5);
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
  const fmt = (key, values2) => interpolate(t(key), values2);
  const rolling = percentOf(usage, "rolling");
  if (error !== null) {
    const message = error.length > 48 ? error.slice(0, 48) + "\u2026" : error;
    return React.createElement(
      "button",
      {
        type: "button",
        className: "ocu-usage ocu-usage-danger",
        title: fmt("reload", {}),
        onClick: () => {
          forceRef.current = true;
          setNonce((n) => n + 1);
        },
        "aria-label": message
      },
      React.createElement("span", { className: "ocu-usage-dot" }),
      React.createElement("span", null, fmt("badgeError", { message }))
    );
  }
  const weekly = percentOf(usage, "weekly");
  const monthly = percentOf(usage, "monthly");
  const values = {
    rolling: usage === null ? "\u2026" : rolling !== null ? String(rolling) : "?",
    weekly: usage === null ? "\u2026" : weekly !== null ? String(weekly) : "?",
    monthly: usage === null ? "\u2026" : monthly !== null ? String(monthly) : "?"
  };
  const resetValues = {
    rolling: usage !== null ? countdownTextOf(resetsAtOf(usage, "rolling"), now, t, fmt) ?? "?" : "?",
    weekly: usage !== null ? countdownTextOf(resetsAtOf(usage, "weekly"), now, t, fmt) ?? "?" : "?",
    monthly: usage !== null ? countdownTextOf(resetsAtOf(usage, "monthly"), now, t, fmt) ?? "?" : "?"
  };
  const stale = usage !== null && usage.stale === true;
  const title = usage !== null ? fmt("resetAll", resetValues) + (stale ? "\n" + t("staleSuffix") : "") : fmt("reload", {});
  const label = fmt("badge", values);
  return React.createElement(
    "button",
    {
      type: "button",
      className: "ocu-usage " + toneOf(rolling),
      title,
      onClick: () => {
        forceRef.current = true;
        setNonce((n) => n + 1);
      },
      "aria-label": label
    },
    React.createElement("span", { className: "ocu-usage-dot" }),
    React.createElement("span", null, label)
  );
}
var inject = ["slots", "remote", "locale", "modelDirectories"];
function apply(ctx) {
  adoptStyles();
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "opencode-usage-badge: dictionaries");
  const remotesPromise = (async () => {
    const dispose = await ctx.remote.$mount({
      package: "opencode-usage-badge",
      descriptors: USAGE_REMOTE.descriptors
    });
    const usageRemote = ctx.reflect.get("remote.usageBadge");
    if (usageRemote === void 0) {
      throw new Error("opencode-usage-badge: the usageBadge Remote namespace did not mount");
    }
    return { usageRemote, dispose };
  })();
  ctx.effect(() => () => {
    void remotesPromise.then(({ dispose }) => {
      void dispose();
    }, () => {
    });
  }, "opencode-usage-badge: remote cleanup");
  const usage = async (provider, force) => {
    try {
      const { usageRemote } = await remotesPromise;
      return usageRemote.usage(provider, force);
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
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "opencode-usage-badge-usage",
    locale: NS,
    inject: () => ({
      usage,
      resolve,
      models: ctx.get("modelDirectories")
    })
  }, UsageBadge));
}
module.exports = { inject, apply };
return module.exports; } });
