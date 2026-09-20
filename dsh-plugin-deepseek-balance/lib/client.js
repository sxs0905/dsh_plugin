/**
 * dsh-plugin-deepseek-balance — browser half.
 *
 * Hand-authored client bundle: the same `window.__ModuleLoader__.load({ id,
 * factory })` contract the harness build emits for every client plugin. It
 * resolves only baseline module-table requests (`react`, `react/jsx-runtime`),
 * so the package declares no `dsh.client.external` entries.
 *
 * Two seats over one reading:
 *
 *   - `conversation.composer.dock` — a strip in the same dock as the chat stats
 *     pills (`StatsPills`), mirroring that component's geometry, typography and
 *     palette: one pill per configured account plus a refresh pill.
 *   - `sidebar.footer.action` — the always-visible sidebar footer chip; it
 *     collapses to a single amount button when the sidebar is a narrow rail.
 *
 * Both call the host route registered by `lib/index.js` and refresh on an
 * interval, on page visibility, and on their refresh control.
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-deepseek-balance",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");

    //#region styles
    /** Unique class prefix plus the style-tag id used for one-time injection. */
    const CSS_TAG_ID = "dsh-plugin-deepseek-balance/BalanceChip.css";
    /* `.dsb_dock`/`.dsb_pill`/`.dsb_sep` deliberately restate the chat stats
       pills' own metrics. The dock slot stacks its registrants vertically, so
       the row is lifted by its measured offset onto the stats line and given
       the stats line box's height, which keeps both on ONE line. */
    const CSS = [
      ".dsb_dock{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto;padding:0 calc(var(--dsh-composer-side-clearance) + 16px);display:flex;justify-content:flex-end;align-items:center;gap:12px;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));overflow:visible;position:relative;z-index:2;pointer-events:none}",
      ".dsb_dock>*{pointer-events:auto}",
      '.dsb_dock[data-lifted="true"]{height:calc(20px + var(--dsh-content-font-delta-secondary,0px));margin-top:calc(-1 * var(--dsb-lift,0px))}',
      /* No room beside the stats pills (or no stats row at all): fall back to an
         ordinary centred row of its own instead of covering the stats text. */
      '.dsb_dock[data-lifted="false"]{height:auto;margin-top:2px;justify-content:center}',
      /* Horizontal placement beside the stats row, chosen from measurement: the
         row only overlays a side that actually has room for it, so a wide stats
         row pushes it to the other side or onto its own line instead of under it. */
      '.dsb_dock[data-side="right"]{justify-content:flex-end}',
      '.dsb_dock[data-side="left"]{justify-content:flex-start}',
      '.dsb_dock[data-side="none"]{justify-content:center}',
      ".dsb_pill{box-sizing:border-box;max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;min-width:0}",
      ".dsb_pill svg{flex:none;width:14px;height:14px}",
      "button.dsb_pill{cursor:pointer}",
      "button.dsb_pill:hover:not(:disabled),button.dsb_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      "button.dsb_pill:disabled{cursor:default;opacity:.55}",
      "button.dsb_pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}",
      ".dsb_sep{color:var(--dsw-alias-separator-primary);margin:0 6px;align-self:center}",
      ".dsb_n{text-overflow:ellipsis;min-width:0;overflow:hidden}",
      ".dsb_v{color:var(--dsw-alias-label-secondary);font-weight:500}",
      '.dsb_dock[data-tone="error"] .dsb_v{color:var(--dsw-alias-state-error-primary,#e03131)}',
      ".dsb_dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#9a9a9a);transition:background .12s ease}",
      '.dsb_dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary,#2f9e44)}',
      '.dsb_dot[data-tone="warn"]{background:var(--dsw-alias-state-warn-primary,#e8a33d)}',
      '.dsb_dot[data-tone="error"]{background:var(--dsw-alias-state-error-primary,#e03131)}',
      ".dsb_spend{flex:none;color:var(--dsw-alias-label-tertiary,#9a9a9a);font-variant-numeric:tabular-nums;font-weight:500}",
      ".dsb_icon{display:block}",
      ".dsb_busy .dsb_icon{animation:dsb-rotate .8s linear infinite}",
      "@keyframes dsb-rotate{to{transform:rotate(360deg)}}",
      "@media (prefers-reduced-motion: reduce){.dsb_busy .dsb_icon{animation:none}}",
      ".dsb_root{display:flex;align-items:center;gap:6px;width:100%;min-width:0;padding:3px 2px 3px 8px;border-radius:8px;color:var(--dsw-alias-label-secondary,#6b6b6b);font:inherit;font-size:12px;line-height:1.2;box-sizing:border-box}",
      ".dsb_root .dsb_value{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);text-align:right}",
      ".dsb_button{display:flex;align-items:center;gap:5px;width:100%;min-width:0;padding:5px 4px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:11px;line-height:1.2;cursor:pointer;text-align:center;justify-content:center;transition:background .12s ease}",
      ".dsb_button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}",
      ".dsb_button:active{background:var(--dsw-alias-interactive-bg-active,rgba(127,127,127,.18))}",
      ".dsb_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}",
      ".dsb_button .dsb_value{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}",
      ".dsb_refresh{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b6b6b);cursor:pointer;transition:background .12s ease,color .12s ease}",
      ".dsb_refresh:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#1a1a1a)}",
      ".dsb_refresh:disabled{cursor:default;opacity:.55}",
      ".dsb_refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}",
      /* Settings -> Plugins card. Geometry, typography, and palette mirror the
         cards the official plugins contribute, so this one does not read as a
         foreign body on that page. */
      ".dsb_cfg{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}",
      ".dsb_cfg:hover{border-color:var(--dsw-alias-label-dimmed)}",
      ".dsb_cfg[data-open=true]{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}",
      ".dsb_cfgHead{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
      ".dsb_cfgHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:-2px}",
      ".dsb_cfgHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
      ".dsb_cfgName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
      ".dsb_cfgDesc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}",
      ".dsb_cfgPending{flex:none;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12));border-radius:6px;padding:1px 6px;font-size:12px;line-height:1.5}",
      ".dsb_cfgChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}",
      ".dsb_cfgChevron[data-open=true]{transform:rotate(180deg)}",
      ".dsb_cfgBody{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}",
      ".dsb_cfgReadOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
      ".dsb_cfgField{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
      ".dsb_cfgField+.dsb_cfgField{border-top:.5px solid var(--dsw-alias-border-l2)}",
      ".dsb_cfgFieldHead{align-items:center;gap:8px;display:flex}",
      ".dsb_cfgLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
      ".dsb_cfgBadges{align-items:center;gap:8px;display:inline-flex}",
      ".dsb_cfgBadge{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12));border-radius:6px;padding:1px 6px;font-size:12px;line-height:1.5}",
      ".dsb_cfgReset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}",
      ".dsb_cfgReset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
      ".dsb_cfgReset:disabled{cursor:default}",
      ".dsb_cfgInput{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;box-sizing:border-box}",
      ".dsb_cfgInput:focus-visible{border-color:var(--dsw-alias-brand-primary,#4d6bfe);outline:none}",
      ".dsb_cfgInput:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
      '.dsb_cfgInput[aria-invalid="true"]{border-color:var(--dsw-alias-label-error,#e03131)}',
      ".dsb_cfgInvalid{color:var(--dsw-alias-label-error,#e03131);margin:0;font-size:12px;line-height:1.5}",
      ".dsb_cfgHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
      ".dsb_cfgToggle{align-items:center;gap:8px;display:flex;cursor:pointer}",
      ".dsb_cfgToggle input{flex:none;width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4d6bfe)}",
      ".dsb_cfgToggleText{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5}",
      ".dsb_cfgFooter{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
      ".dsb_cfgFailed{min-width:0;color:var(--dsw-alias-label-error,#e03131);flex:1;margin:0;font-size:12px;line-height:1.5}",
      ".dsb_cfgDiscard,.dsb_cfgSave{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
      ".dsb_cfgDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
      ".dsb_cfgDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
      ".dsb_cfgSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
      ".dsb_cfgDiscard:disabled,.dsb_cfgSave:disabled{opacity:.4;cursor:default}",
      ".dsb_cfgDiscard:focus-visible,.dsb_cfgSave:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:1px}",
    ].join("");
    if (
      typeof document !== "undefined"
      && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG_ID) + "]") === null
    ) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-plugin-deepseek-balance";
      tag.dataset.pluginCss = CSS_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }
    //#endregion

    //#region strings
    /** Dictionary namespace owned by this plugin. */
    const NS = "deepseek-balance";
    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      "chip.label": "余额",
      "chip.busy": "读取中…",
      "chip.refresh": "刷新余额",
      "chip.hint": "点击 ⟳ 刷新余额",
      "state.loading": "正在读取 DeepSeek 余额…",
      "state.error": "余额读取失败",
      "state.unavailable": "账户当前不可用",
      "field.total": "总余额",
      "field.granted": "赠金",
      "field.toppedUp": "充值",
      "field.fetched": "读取于",
      "field.cached": "缓存",
      "field.key": "密钥",
      "spend.today": "今日消耗",
      "spend.note": "（按插件观测到的余额下降累计，非官方账单）",
      "accounts.more": "另有 {count} 个账户",
      "settings.title": "deepseek 账户余额",
      "settings.description": "在输入框上方统计栏与侧边栏底部显示 DeepSeek 账户余额，并按观测到的余额下降推导今日消耗。",
      "settings.expand": "展开",
      "settings.collapse": "收起",
      "settings.unsaved": "未保存",
      "settings.overridden": "已覆盖",
      "settings.reset": "重置",
      "settings.save": "保存",
      "settings.saving": "保存中…",
      "settings.discard": "放弃",
      "settings.saveFailed": "保存失败，请重试。",
      "settings.readOnly": "当前设置文档只读，修改无法保存。",
      "settings.invalidNumber": "请输入一个数字。",
      "settings.invalidRange": "数值低于允许的最小值。",
      "settings.on": "已开启",
      "settings.off": "已关闭",
      "settings.apiKeyRef": "凭据引用",
      "settings.apiKeyRefHint": "默认账户读取哪个凭据（如 DEEPSEEK_API_KEY）。留空即回到该默认值；配置了 accounts 时以 accounts 为准。",
      "settings.trackDailySpend": "统计今日消耗",
      "settings.trackDailySpendHint": "按观测到的余额下降累计今日消耗并写入本地账本；关闭后不再推导，也不再写盘。",
      "settings.cacheMs": "服务端缓存（毫秒）",
      "settings.cacheMsHint": "同一账户的读数在这个窗口内直接复用，0 表示每次都向上游读取。",
      "settings.timeoutMs": "上游超时（毫秒）",
      "settings.timeoutMsHint": "单次请求 DeepSeek 余额接口的最长等待时间，最小 1000。",
      "settings.sampleMs": "后台采样间隔（毫秒）",
      "settings.sampleMsHint": "没有浏览器轮询时也按这个间隔采样，避免漏掉消耗；0 表示关闭。",
    };
    /** English dictionary, checked complete against the zh key set. */
    const en = {
      "chip.label": "Balance",
      "chip.busy": "Loading…",
      "chip.refresh": "Refresh balance",
      "chip.hint": "Click ⟳ to refresh",
      "state.loading": "Reading the DeepSeek balance…",
      "state.error": "Balance unavailable",
      "state.unavailable": "Account unavailable",
      "field.total": "Total",
      "field.granted": "Granted",
      "field.toppedUp": "Topped up",
      "field.fetched": "Fetched",
      "field.cached": "cached",
      "field.key": "Key",
      "spend.today": "Spent today",
      "spend.note": "(accumulated from observed balance drops; not an official bill)",
      "accounts.more": "{count} more account(s)",
      "settings.title": "deepseek 账户余额",
      "settings.description": "Shows the DeepSeek account balance in the composer stats strip and the sidebar footer, and derives today's spend from observed balance drops.",
      "settings.expand": "Expand",
      "settings.collapse": "Collapse",
      "settings.unsaved": "Unsaved",
      "settings.overridden": "Overridden",
      "settings.reset": "Reset",
      "settings.save": "Save",
      "settings.saving": "Saving…",
      "settings.discard": "Discard",
      "settings.saveFailed": "Save failed; please retry.",
      "settings.readOnly": "The settings document is read-only, so changes cannot be saved.",
      "settings.invalidNumber": "Enter a number.",
      "settings.invalidRange": "The value is below the allowed minimum.",
      "settings.on": "On",
      "settings.off": "Off",
      "settings.apiKeyRef": "Credential reference",
      "settings.apiKeyRefHint": "Which credential the default account reads (for example DEEPSEEK_API_KEY). Empty restores the default; a configured `accounts` list wins over this.",
      "settings.trackDailySpend": "Track today's spend",
      "settings.trackDailySpendHint": "Accumulates today's spend from observed balance drops into a local ledger; when off, nothing is derived or written.",
      "settings.cacheMs": "Server cache (ms)",
      "settings.cacheMsHint": "One account's reading is reused inside this window; 0 reads upstream every time.",
      "settings.timeoutMs": "Upstream timeout (ms)",
      "settings.timeoutMsHint": "Longest wait for one DeepSeek balance request; minimum 1000.",
      "settings.sampleMs": "Background sample interval (ms)",
      "settings.sampleMsHint": "Samples the balance on this cadence even with no browser polling, so spend is not missed; 0 disables it.",
    };
    //#endregion

    //#region helpers
    /** Host route registered by the node half of this package. */
    const API_PATH = "/deepseek-balance";
    /** Client refresh cadence; the host caches upstream reads for 15s. */
    const REFRESH_MS = 30_000;
    /** Selector for the chat stats row this dock row shares its line with. */
    const STATS_SELECTOR = "[data-composer-stats]";
    /** Re-measure delays (ms) covering a composer whose layout settles late. */
    const LIFT_RETRY_MS = [120, 500, 1500];

    /**
     * Render one amount with a currency symbol where one is conventional.
     * @param currency - `CNY`, `USD`, or an unknown code.
     * @param amount - the upstream decimal string.
     * @returns a display string.
     */
    function formatAmount(currency, amount) {
      const symbol = currency === "CNY" ? "\u00a5" : currency === "USD" ? "$" : "";
      return symbol.length > 0 ? symbol + amount : (amount + " " + currency).trim();
    }
    /**
     * Render an instant as a local wall-clock time.
     * @param iso - ISO timestamp.
     * @returns a short local time, or an empty string.
     */
    function formatTime(iso) {
      const at = Date.parse(iso);
      return Number.isNaN(at) ? "" : new Date(at).toLocaleTimeString();
    }
    /**
     * The amount to show for one account.
     * @param account - one reading from the host payload.
     * @returns a display string.
     */
    function accountValue(account) {
      if (account.ok !== true || account.primary === null || account.primary === undefined) return "—";
      return formatAmount(account.primary.currency, account.primary.total);
    }
    /**
     * The name to show for one account: its label, else the key reference for
     * a multi-account row or the generic label for the default single account.
     * @param account - one reading from the host payload.
     * @param t - the locale translator.
     * @param multiple - whether more than one account is configured.
     * @returns a display string.
     */
    function accountName(account, t, multiple, compact) {
      if (typeof account.label === "string" && account.label.length > 0) return account.label;
      if (multiple === true) return account.keyRef;
      /* Sharing the stats line is tight: a single account drops the generic
         label there and lets the tooltip carry it, which is what makes the row
         fit beside a wide stats strip. */
      return compact === true ? "" : t("chip.label");
    }
    /**
     * Accept both wire shapes: the multi-account payload (`accounts[]`) and the
     * earlier single-account payload (`primary`/`balances`/`keyRef` at the top
     * level), so a client bundle that hot-reloads before its host half restarts
     * still renders a correct reading.
     * @param data - the parsed route response.
     * @returns the multi-account payload, or the input when it is not a payload.
     */
    function withAccounts(data) {
      if (data === null || typeof data !== "object" || Array.isArray(data.accounts)) return data;
      if (data.ok !== true && data.primary === undefined && data.balances === undefined) return data;
      const legacy = {
        id: "default",
        label: "",
        ok: data.ok === true,
        fetchedAt: data.fetchedAt,
        cached: data.cached === true,
        available: data.available !== false,
        primary: data.primary ?? null,
        balances: data.balances ?? [],
        keyRef: data.keyRef,
        keySource: data.keySource,
      };
      if (data.ok !== true && data.error !== null && data.error !== undefined) legacy.error = data.error;
      return { ...data, accounts: [legacy] };
    }
    /**
     * Status tone for one account.
     * @param account - one reading from the host payload.
     * @returns `ok`, `warn`, or `error`.
     */
    function accountTone(account) {
      if (account.ok !== true) return "error";
      return account.available === false ? "warn" : "ok";
    }
    /**
     * Today's observed spend for one account, as a display string, or null when
     * tracking is off, the reading predates the feature, or nothing was spent.
     * @param account - one reading from the host payload.
     * @returns a formatted amount such as `¥1.23`, or null.
     */
    function spentTodayOf(account) {
      if (account === null || account === undefined) return null;
      if (typeof account.spentToday !== "string") return null;
      const cents = Math.round(Number.parseFloat(account.spentToday) * 100);
      if (!Number.isFinite(cents) || cents <= 0) return null;
      const currency = account.primary !== null && account.primary !== undefined ? account.primary.currency : "";
      return formatAmount(currency, account.spentToday);
    }
    /**
     * The tooltip's spend line, shown even at zero so "tracked, nothing spent"
     * is distinguishable from "not tracked".
     * @param account - one reading from the host payload.
     * @param t - the locale translator.
     * @returns the line, or null.
     */
    function spendTooltipLine(account, t) {
      if (account === null || account === undefined || typeof account.spentToday !== "string") return null;
      const currency = account.primary !== null && account.primary !== undefined ? account.primary.currency : "";
      return "   " + t("spend.today") + " " + formatAmount(currency, account.spentToday)
        + (typeof account.spentDate === "string" ? " · " + account.spentDate : "") + " " + t("spend.note");
    }
    /**
     * Build the hover tooltip: every account's balances plus provenance.
     * @param payload - the last successful host payload.
     * @param error - the last transport failure message, if any.
     * @param t - the locale translator.
     * @returns the tooltip text.
     */
    function tooltipOf(payload, error, t) {
      const lines = [];
      if (payload === null) {
        lines.push(error !== null ? t("state.error") + ": " + error : t("state.loading"));
      } else {
        for (const account of payload.accounts ?? []) {
          const name = account.label && account.label.length > 0 ? account.label : account.keyRef;
          if (account.ok !== true) {
            lines.push(name + " — " + t("state.error") + ": " + (account.error?.message ?? account.error?.code ?? ""));
            continue;
          }
          if (account.available === false) lines.push(name + " — " + t("state.unavailable"));
          for (const balance of account.balances ?? []) {
            lines.push(
              name + ": " + t("field.total") + " " + formatAmount(balance.currency, balance.total)
              + "  ·  " + t("field.granted") + " " + balance.granted
              + "  ·  " + t("field.toppedUp") + " " + balance.toppedUp,
            );
          }
          const spendLine = spendTooltipLine(account, t);
          if (spendLine !== null) lines.push(spendLine);
          lines.push(
            "   " + t("field.key") + " " + account.keyRef + "/" + (account.keySource ?? "?")
            + "  ·  " + t("field.fetched") + " " + formatTime(account.fetchedAt)
            + (account.cached === true ? " (" + t("field.cached") + ")" : ""),
          );
        }
        if (error !== null) lines.push(t("state.error") + ": " + error);
      }
      lines.push(t("chip.hint"));
      return lines.join("\n");
    }
    /**
     * The vertical distance this row must move up to share the chat stats
     * line: its own top minus the stats text top (the stats box top plus that
     * box's top padding). Order-independent, so it also holds if the two dock
     * registrants are ever composed the other way round.
     * @param rootRect - this row's bounding rect, or null when unmeasurable.
     * @param statsRect - the stats row's bounding rect, or null.
     * @param statsPadTop - the stats row's computed `padding-top` in pixels.
     * @returns a non-negative lift in pixels.
     */
    function computeLift(rootRect, statsRect, statsPadTop) {
      if (rootRect === null || statsRect === null) return 0;
      if (!Number.isFinite(rootRect.top) || !Number.isFinite(statsRect.top)) return 0;
      const padTop = Number.isFinite(statsPadTop) ? statsPadTop : 0;
      const delta = rootRect.top - (statsRect.top + padTop);
      return Number.isFinite(delta) && delta > 0 ? delta : 0;
    }
    /**
     * Measure {@link computeLift} against the live DOM, tolerating any missing
     * browser API (the chat stats row is brand-selectable, and the component
     * must still render when it is absent).
     *
     * The row's own `margin-top` is added back before measuring. That margin
     * carries the lift currently in force (and the fallback spacing when there
     * is none), while `getBoundingClientRect` reports the already-shifted
     * position — measuring on top of an applied lift would otherwise make every
     * re-measurement walk the row a little further off the line.
     * @param root - this row's element, or null.
     * @param scope - optional `{ window, document }` overrides for tests.
     * @returns the lift in pixels, or 0 when it cannot be measured.
     */
    function measureLift(root, scope) {
      if (root === null || root === undefined || typeof root.getBoundingClientRect !== "function") return 0;
      const doc = scope?.document ?? (typeof document === "undefined" ? undefined : document);
      if (doc === undefined || typeof doc.querySelector !== "function") return 0;
      const stats = doc.querySelector(STATS_SELECTOR);
      if (stats === null || stats === undefined || typeof stats.getBoundingClientRect !== "function") return 0;
      const win = scope?.window ?? (typeof window === "undefined" ? undefined : window);
      let statsPadTop = 0;
      let rootMarginTop = 0;
      if (win !== undefined && typeof win.getComputedStyle === "function") {
        statsPadTop = Number.parseFloat(win.getComputedStyle(stats)?.paddingTop ?? "0") || 0;
        rootMarginTop = Number.parseFloat(win.getComputedStyle(root)?.marginTop ?? "0") || 0;
      }
      const rootRect = root.getBoundingClientRect();
      return computeLift({ top: rootRect.top - rootMarginTop }, stats.getBoundingClientRect(), statsPadTop);
    }
    /** Minimum clear space between the stats row and an overlaid balance row. */
    const DOCK_GAP = 16;
    /**
     * Pick the side of the stats row this row can occupy without overlapping it.
     * Right is preferred (it reads as a trailing status), left is the fallback,
     * and `none` means neither side has room: the row then takes its own line
     * rather than covering the stats. Pure geometry, so it is testable directly.
     * @param bandLeft - left edge of the available content band.
     * @param bandRight - right edge of the available content band.
     * @param statsLeft - left edge of the stats row.
     * @param statsRight - right edge of the stats row.
     * @param rowWidth - width this row needs.
     * @returns `"right"`, `"left"`, or `"none"`.
     */
    function chooseSide(bandLeft, bandRight, statsLeft, statsRight, rowWidth) {
      const values = [bandLeft, bandRight, statsLeft, statsRight, rowWidth];
      if (values.some((value) => Number.isFinite(value) === false)) return "none";
      if (rowWidth <= 0) return "none";
      const needed = rowWidth + DOCK_GAP;
      if (bandRight - statsRight >= needed) return "right";
      if (statsLeft - bandLeft >= needed) return "left";
      return "none";
    }
    /**
     * The horizontal extent one row's own content occupies: the union of its
     * element children's rects, or null when none of them can be measured.
     *
     * The difference matters for the chat stats row: its `[data-composer-stats]`
     * box is a full-width, content-centred flex container, so its own rect spans
     * the whole content band no matter how short the text is. The pills it holds
     * are its element children, and their union is the part that must stay clear.
     * @param node - the row element.
     * @returns `{ left, right }`, or null when no child rect is measurable.
     */
    function childExtent(node) {
      let left = Infinity;
      let right = -Infinity;
      const children = node?.children;
      if (children !== undefined && children !== null) {
        for (const child of children) {
          if (typeof child.getBoundingClientRect !== "function") continue;
          const rect = child.getBoundingClientRect();
          if (Number.isFinite(rect.left) === false || Number.isFinite(rect.right) === false) continue;
          left = Math.min(left, rect.left);
          right = Math.max(right, rect.right);
        }
      }
      return right > left ? { left, right } : null;
    }
    /**
     * Measure which side of the stats row has room for this row. The band is
     * this row's own content box (its rect minus horizontal padding) and the
     * row's width is the union of its children, so no extra wrapper element is
     * needed and the answer holds whether the row is currently on its own line
     * or already overlaid (the lift only moves it vertically).
     * @param root - this row's element, or null.
     * @param scope - optional `{ window, document }` overrides for tests.
     * @returns `"right"`, `"left"`, or `"none"`.
     */
    function measureSide(root, scope) {
      if (root === null || root === undefined || typeof root.getBoundingClientRect !== "function") return "none";
      const doc = scope?.document ?? (typeof document === "undefined" ? undefined : document);
      if (doc === undefined || typeof doc.querySelector !== "function") return "none";
      const stats = doc.querySelector(STATS_SELECTOR);
      if (stats === null || stats === undefined || typeof stats.getBoundingClientRect !== "function") return "none";
      const win = scope?.window ?? (typeof window === "undefined" ? undefined : window);
      const rootRect = root.getBoundingClientRect();
      /* The stats pills, not the full-width box that centres them. */
      const statsRect = childExtent(stats) ?? stats.getBoundingClientRect();
      let padLeft = 0;
      let padRight = 0;
      if (win !== undefined && typeof win.getComputedStyle === "function") {
        const style = win.getComputedStyle(root);
        padLeft = Number.parseFloat(style?.paddingLeft ?? "0") || 0;
        padRight = Number.parseFloat(style?.paddingRight ?? "0") || 0;
      }
      const rowBand = childExtent(root);
      const rowWidth = rowBand === null ? 0 : rowBand.right - rowBand.left;
      return chooseSide(rootRect.left + padLeft, rootRect.right - padRight, statsRect.left, statsRect.right, rowWidth);
    }
    /**
     * Whether the dock row may leave its own line for the stats line: sharing it
     * takes both a measured gap to lift by AND a side of the stats pills with
     * room for this row. A lift alone would drop the row onto the stats text,
     * centred in the band by `data-side="none"`, which is the overlap bug.
     * @param lift - the measured gap to the stats text top, in pixels.
     * @param side - the measured side: `"right"`, `"left"`, or `"none"`.
     * @returns whether the row overlays the stats line.
     */
    function shouldOverlay(lift, side) {
      if (side !== "right" && side !== "left") return false;
      return Number.isFinite(lift) && lift > 0;
    }
    /**
     * The nearest ancestor that actually generates a box. The slot system wraps
     * every registrant in `display: contents` holders, so this row's own parent
     * is usually NOT the layout parent whose subtree gains the stats row.
     * @param element - the starting element.
     * @param win - the window-like object supplying `getComputedStyle`.
     * @returns the layout ancestor, or null when there is none.
     */
    function layoutAncestorOf(element, win) {
      let node = element === null || element === undefined ? null : element.parentElement;
      while (node !== null && node !== undefined) {
        const display = typeof win?.getComputedStyle === "function" ? win.getComputedStyle(node)?.display : undefined;
        if (display !== "contents") return node;
        node = node.parentElement;
      }
      return null;
    }
    /**
     * Keep one lift measurement fresh for as long as the row stays mounted.
     *
     * Sharing the stats line means lifting this row by the measured gap to the
     * stats text, and that gap moves for reasons this row cannot see: the stats
     * row does not exist while a session is empty (nor while its projection is
     * still loading), it appears when the first tokens arrive, the dock's own
     * pills grow when the first reading lands, and the composer shifts with the
     * sidebar, the window and the font metrics. Measuring once therefore
     * strands the row on a line of its own — a lift of 0 is precisely that bug.
     * So the gap is re-measured whenever the composer layout can have changed.
     * @param root - this row's element.
     * @param onChange - receives every freshly measured lift.
     * @param scope - optional `{ window, document, MutationObserver,
     *   ResizeObserver }` overrides for tests.
     * @returns `{ schedule, dispose }`.
     */
    function followLift(root, onChange, scope) {
      const inert = { schedule: () => {}, dispose: () => {} };
      const win = scope?.window ?? (typeof window === "undefined" ? undefined : window);
      const doc = scope?.document ?? (typeof document === "undefined" ? undefined : document);
      if (root === null || root === undefined || doc === undefined) return inert;

      const raf = typeof win?.requestAnimationFrame === "function" ? win.requestAnimationFrame.bind(win) : null;
      const caf = typeof win?.cancelAnimationFrame === "function" ? win.cancelAnimationFrame.bind(win) : null;
      const later = typeof win?.setTimeout === "function" ? win.setTimeout.bind(win)
        : (typeof setTimeout === "function" ? setTimeout : null);
      const cancelLater = typeof win?.clearTimeout === "function" ? win.clearTimeout.bind(win)
        : (typeof clearTimeout === "function" ? clearTimeout : null);
      const ResizeCtor = scope?.ResizeObserver ?? (typeof ResizeObserver === "undefined" ? null : ResizeObserver);
      const MutationCtor = scope?.MutationObserver ?? (typeof MutationObserver === "undefined" ? null : MutationObserver);

      let disposed = false;
      let pending = false;
      let cancelPending = null;
      let watchedParent = null;
      let watchedStats = null;
      let parentResize = null;
      let statsResize = null;
      let mutation = null;
      const retries = [];

      /** Publish one measurement. */
      const measure = () => {
        pending = false;
        cancelPending = null;
        if (disposed !== true) onChange(measureLift(root, scope));
      };
      /** Coalesce a burst of layout changes into one measurement per frame. */
      const schedule = () => {
        if (disposed === true || pending === true) return;
        if (raf !== null) {
          pending = true;
          /* A synchronous `requestAnimationFrame` stand-in (tests) may already
             have published the measurement by the time this returns. */
          const id = raf(measure);
          cancelPending = caf === null ? null : () => caf(id);
          return;
        }
        if (later !== null) {
          pending = true;
          const id = later(measure, 16);
          cancelPending = cancelLater === null ? null : () => cancelLater(id);
          return;
        }
        measure();
      };
      /** Follow the rows whose appearance or size changes the gap. */
      const syncTargets = () => {
        if (disposed === true) return;
        const parent = layoutAncestorOf(root, win);
        if (parent !== watchedParent) {
          parentResize?.disconnect?.();
          parentResize = null;
          watchedParent = parent;
          if (parent !== null && ResizeCtor !== null) {
            parentResize = new ResizeCtor(schedule);
            parentResize.observe(parent);
          }
        }
        const stats = typeof doc.querySelector === "function" ? doc.querySelector(STATS_SELECTOR) : null;
        if (stats !== watchedStats) {
          statsResize?.disconnect?.();
          statsResize = null;
          watchedStats = stats;
          if (stats !== null && ResizeCtor !== null) {
            statsResize = new ResizeCtor(schedule);
            statsResize.observe(stats);
          }
        }
      };
      const onLayoutChange = () => {
        syncTargets();
        schedule();
      };

      /* The first measurement is synchronous, so a layout effect can place the
         row before the browser paints it. */
      syncTargets();
      onChange(measureLift(root, scope));

      if (MutationCtor !== null && watchedParent !== null) {
        /* The stats row is inserted (and removed) inside this subtree, which is
           the usual reason the gap changes at all. */
        mutation = new MutationCtor(onLayoutChange);
        mutation.observe(watchedParent, { childList: true, subtree: true });
      }
      win?.addEventListener?.("resize", onLayoutChange);
      /* A webfont swap reflows the stats row after the first paint. */
      if (typeof doc.fonts?.ready?.then === "function") doc.fonts.ready.then(onLayoutChange, () => {});
      /* Backstop for a composer that settles without a mutation or a resize. */
      for (const delay of LIFT_RETRY_MS) {
        if (later === null) break;
        retries.push(later(onLayoutChange, delay));
      }
      return {
        schedule,
        dispose: () => {
          disposed = true;
          if (pending === true) cancelPending?.();
          pending = false;
          parentResize?.disconnect?.();
          statsResize?.disconnect?.();
          mutation?.disconnect?.();
          win?.removeEventListener?.("resize", onLayoutChange);
          for (const id of retries) cancelLater?.(id);
          retries.length = 0;
        },
      };
    }
    //#endregion

    //#region reading
    /**
     * The dock row's element plus its current lift onto the chat stats line.
     *
     * The lift cannot be measured once: see {@link followLift} for everything
     * that moves the gap. This hook keeps the measurement alive for the whole
     * mount and re-runs it after every render, so a row that mounted before the
     * stats row existed still lands on the line once it appears.
     * @returns `[ref, lift]`.
     */
    function useDockLift() {
      const rootRef = react.useRef(null);
      const [lift, setLift] = react.useState(0);
      const [side, setSide] = react.useState("none");
      const watcher = react.useRef(null);
      /* Prefer a layout effect, so the row is placed before the first paint;
         fall back to a plain effect when the runtime has only that. */
      const effect = typeof react.useLayoutEffect === "function" ? react.useLayoutEffect : react.useEffect;
      effect(() => {
        const control = followLift(rootRef.current, (next) => {
          setLift((previous) => (previous === next ? previous : next));
          /* followLift already fires on every layout change that can move the
             stats row, so the horizontal check rides the same trigger set. */
          setSide((previous) => {
            const measured = measureSide(rootRef.current);
            return previous === measured ? previous : measured;
          });
        });
        watcher.current = control;
        return () => {
          watcher.current = null;
          control.dispose();
        };
      }, []);
      effect(() => {
        /* Every render can change the row's own height (placeholder pills to a
           real reading, a spend marker appearing), which moves the gap. */
        watcher.current?.schedule();
      });
      return [rootRef, lift, side];
    }
    /**
     * One shared balance reading: initial fetch, interval poll,
     * visibility-driven catch-up, and a manual refresh control.
     * @returns `{ payload, error, busy, refresh }`.
     */
    function useBalance() {
      const [payload, setPayload] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [busy, setBusy] = react.useState(false);
      const alive = react.useRef(true);

      react.useEffect(() => () => {
        alive.current = false;
      }, []);

      const refresh = react.useCallback((force) => {
        setBusy(true);
        const url = force === true ? API_PATH + "?force=1" : API_PATH;
        return fetch(url, { headers: { accept: "application/json" }, cache: "no-store" })
          .then((response) => response.json())
          .then((raw) => {
            if (alive.current !== true) return;
            const data = withAccounts(raw);
            if (data !== null && typeof data === "object" && Array.isArray(data.accounts) && data.accounts.length > 0) {
              /* Both a healthy and an all-failed read carry per-account
                 diagnoses, so render them instead of collapsing to one line. */
              setPayload(data);
              setError(null);
            } else {
              setPayload(null);
              setError((data !== null && typeof data === "object" && data.error !== null && data.error !== undefined)
                ? String(data.error.message ?? data.error.code)
                : "unavailable");
            }
          })
          .catch((cause) => {
            if (alive.current === true) {
              setPayload(null);
              setError(String(cause?.message ?? cause));
            }
          })
          .finally(() => {
            if (alive.current === true) setBusy(false);
          });
      }, []);

      react.useEffect(() => {
        refresh(false);
        const timer = setInterval(() => {
          if (document.visibilityState !== "hidden") refresh(false);
        }, REFRESH_MS);
        const onVisible = () => {
          if (document.visibilityState === "visible") refresh(false);
        };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
          clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisible);
        };
      }, [refresh]);

      return { payload, error, busy, refresh };
    }
    //#endregion

    //#region settings
    /**
     * The fields this plugin's card edits, in render order. The names and kinds
     * mirror the host half's settings schema: the card is keyed by the settings
     * namespace, so the two halves meet there without either importing the other.
     */
    const SETTINGS_FIELDS = [
      { field: "apiKeyRef", kind: "text", label: "settings.apiKeyRef", hint: "settings.apiKeyRefHint" },
      { field: "trackDailySpend", kind: "boolean", label: "settings.trackDailySpend", hint: "settings.trackDailySpendHint" },
      { field: "cacheMs", kind: "number", min: 0, label: "settings.cacheMs", hint: "settings.cacheMsHint" },
      { field: "timeoutMs", kind: "number", min: 1000, label: "settings.timeoutMs", hint: "settings.timeoutMsHint" },
      { field: "sampleMs", kind: "number", min: 0, label: "settings.sampleMs", hint: "settings.sampleMsHint" },
    ];
    /**
     * Render one stored value as draft text.
     * @param value - the resolved value of a field.
     * @returns its text form, or an empty string when the field carries none.
     */
    function settingsTextOf(value) {
      if (value === null || value === undefined) return "";
      return String(value);
    }
    /**
     * Read one field's own layer out of a scope snapshot.
     * @param layer - the snapshot's `base` or `user` layer.
     * @param field - the field name.
     * @returns the layer's value, or undefined.
     */
    function layerValue(layer, field) {
      if (layer === null || typeof layer !== "object") return undefined;
      return layer[field];
    }
    /**
     * Whether the user layer carries this field — a field's PRESENCE there is
     * what marks it overridden, not a value comparison against the base.
     * @param layer - the snapshot's `user` layer.
     * @param field - the field name.
     * @returns whether the user overrode the field.
     */
    function layerHas(layer, field) {
      return layer !== null && typeof layer === "object" && Object.prototype.hasOwnProperty.call(layer, field);
    }
    /**
     * One field's rendered state: what the control shows, whether saving would
     * leave a user override, whether the draft is unacceptable, and the write a
     * save would perform.
     *
     * A staged edit answers for itself, so the override badge previews the save
     * instead of reporting a state the pending edit already contradicts.
     * @param spec - the field spec.
     * @param snapshot - the settings scope snapshot.
     * @param staged - this field's staged edit, or undefined.
     * @returns `{ text, checked, overridden, invalid, write }`.
     */
    function settingsFieldState(spec, snapshot, staged) {
      const value = layerValue(snapshot.value, spec.field);
      const base = layerValue(snapshot.base, spec.field);
      const overriddenNow = layerHas(snapshot.user, spec.field);
      if (staged === undefined) {
        return {
          text: settingsTextOf(value),
          checked: value === true,
          overridden: overriddenNow,
          invalid: false,
          write: undefined,
        };
      }
      if (staged.clear === true) {
        /* Saving re-inherits the composition layer, so the control previews it. */
        return {
          text: settingsTextOf(base),
          checked: base === true,
          overridden: false,
          invalid: false,
          write: { kind: "clear" },
        };
      }
      if (spec.kind === "boolean") {
        return {
          text: "",
          checked: staged.value === true,
          overridden: true,
          invalid: false,
          write: { kind: "set", value: staged.value === true },
        };
      }
      const text = typeof staged.text === "string" ? staged.text : "";
      if (text.trim().length === 0) {
        /* Emptying a control and saving is the same gesture as resetting it. */
        return { text, checked: false, overridden: false, invalid: false, write: { kind: "clear" } };
      }
      if (spec.kind === "number") {
        const parsed = Number(text.trim());
        const belowMin = Number.isFinite(parsed) && Number.isFinite(spec.min) && parsed < spec.min;
        return {
          text,
          checked: false,
          overridden: true,
          invalid: !Number.isFinite(parsed) || belowMin,
          invalidLabel: Number.isFinite(parsed) ? "settings.invalidRange" : "settings.invalidNumber",
          write: Number.isFinite(parsed) && !belowMin ? { kind: "set", value: parsed } : undefined,
        };
      }
      return { text, checked: false, overridden: true, invalid: false, write: { kind: "set", value: text } };
    }
    /**
     * Subscribe to a settings scope. React's own external-store hook is used
     * where it exists; the state mirror is the fallback for runtimes and tests
     * built on a minimal React.
     * @param scope - the bound settings scope.
     * @returns the current snapshot.
     */
    const useScopeSnapshot = typeof react.useSyncExternalStore === "function"
      ? (scope) => react.useSyncExternalStore(
        react.useCallback((listener) => scope.subscribe(listener), [scope]),
        react.useCallback(() => scope.getSnapshot(), [scope]),
      )
      : (scope) => {
        const [snapshot, setSnapshot] = react.useState(() => scope.getSnapshot());
        react.useEffect(() => {
          setSnapshot(scope.getSnapshot());
          return scope.subscribe(() => setSnapshot(scope.getSnapshot()));
        }, [scope]);
        return snapshot;
      };
    /** 24x24 chevron-down outline, drawn at 14px. */
    const CHEVRON_PATH = "M12 15.4 5.3 8.7l1.4-1.4L12 12.6l5.3-5.3 1.4 1.4z";
    /**
     * Render the disclosure chevron.
     * @param open - whether the card is open.
     * @returns the svg element.
     */
    function chevronIcon(open) {
      return react.createElement(
        "svg",
        {
          className: "dsb_cfgChevron",
          "data-open": open === true ? "true" : "false",
          viewBox: "0 0 24 24",
          width: 14,
          height: 14,
          "aria-hidden": "true",
          focusable: "false",
        },
        react.createElement("path", { fill: "currentColor", d: CHEVRON_PATH }),
      );
    }
    /**
     * Render one field's override badge and reset, when it has one.
     * @param t - the locale translator.
     * @param state - the field's rendered state.
     * @param disabled - whether editing is blocked.
     * @param onReset - stages a clear for this field.
     * @returns the badges span, or null.
     */
    function fieldBadges(t, state, disabled, onReset) {
      if (state.overridden !== true) return null;
      return react.createElement(
        "span",
        { className: "dsb_cfgBadges" },
        react.createElement("span", { className: "dsb_cfgBadge" }, t("settings.overridden")),
        react.createElement(
          "button",
          { type: "button", className: "dsb_cfgReset", disabled, onClick: onReset },
          t("settings.reset"),
        ),
      );
    }
    /**
     * Render one text or number field.
     * @param t - the locale translator.
     * @param spec - the field spec.
     * @param state - the field's rendered state.
     * @param disabled - whether editing is blocked.
     * @param onEdit - stages draft text.
     * @param onReset - stages a clear.
     * @returns the field element.
     */
    function settingsTextField(t, spec, state, disabled, onEdit, onReset) {
      const id = "dsb-setting-" + spec.field;
      return react.createElement(
        "div",
        { className: "dsb_cfgField", key: spec.field },
        react.createElement(
          "div",
          { className: "dsb_cfgFieldHead" },
          react.createElement("label", { className: "dsb_cfgLabel", htmlFor: id }, t(spec.label)),
          fieldBadges(t, state, disabled, onReset),
        ),
        react.createElement("input", {
          id,
          className: "dsb_cfgInput",
          type: "text",
          value: state.text,
          disabled,
          spellCheck: false,
          autoComplete: "off",
          ...(spec.kind === "number" ? { inputMode: "numeric" } : {}),
          ...(state.invalid === true ? { "aria-invalid": true } : {}),
          onChange: (event) => onEdit(event.target.value),
        }),
        react.createElement(
          "p",
          { className: state.invalid === true ? "dsb_cfgInvalid" : "dsb_cfgHint" },
          state.invalid === true ? t(state.invalidLabel ?? "settings.invalidNumber") : t(spec.hint),
        ),
      );
    }
    /**
     * Render one checkbox field.
     * @param t - the locale translator.
     * @param spec - the field spec.
     * @param state - the field's rendered state.
     * @param disabled - whether editing is blocked.
     * @param onEdit - stages a boolean.
     * @param onReset - stages a clear.
     * @returns the field element.
     */
    function settingsToggleField(t, spec, state, disabled, onEdit, onReset) {
      const id = "dsb-setting-" + spec.field;
      return react.createElement(
        "div",
        { className: "dsb_cfgField", key: spec.field },
        react.createElement(
          "div",
          { className: "dsb_cfgFieldHead" },
          react.createElement("label", { className: "dsb_cfgLabel", htmlFor: id }, t(spec.label)),
          fieldBadges(t, state, disabled, onReset),
        ),
        react.createElement(
          "label",
          { className: "dsb_cfgToggle", htmlFor: id },
          react.createElement("input", {
            id,
            type: "checkbox",
            checked: state.checked,
            disabled,
            onChange: (event) => onEdit(event.target.checked),
          }),
          react.createElement("span", { className: "dsb_cfgToggleText" }, t(state.checked ? "settings.on" : "settings.off")),
        ),
        react.createElement("p", { className: "dsb_cfgHint" }, t(spec.hint)),
      );
    }
    /**
     * Settings -> Plugins card for this plugin, keyed by its settings namespace.
     *
     * The card stages edits and writes them only on save: every settings write
     * is a durable, revision-fenced document mutation, so a control that
     * committed as it settled would turn one edit into a write nobody asked for.
     * @param props - slot props: the translator, and the bound settings `scope`.
     * @returns the card, or nothing while the namespace is unavailable.
     */
    function BalanceSettingsCard(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const scope = props.scope;
      const snapshot = useScopeSnapshot(scope);
      const [open, setOpen] = react.useState(false);
      const [staged, setStaged] = react.useState({});
      const [saving, setSaving] = react.useState(false);
      const [failed, setFailed] = react.useState(false);

      if (snapshot.status === "unavailable") return null;

      const rows = SETTINGS_FIELDS.map((spec) => ({ spec, state: settingsFieldState(spec, snapshot, staged[spec.field]) }));
      const dirty = Object.keys(staged).length > 0;
      const invalid = rows.some((row) => row.state.invalid === true);
      const disabled = snapshot.writable !== true || saving;

      /** Stage a draft for one field. */
      const edit = (field, value) => {
        setStaged((previous) => ({ ...previous, [field]: value }));
        setFailed(false);
      };
      /** Collect the writes a save would perform, in field order. */
      const plannedWrites = () => rows
        .map((row) => ({ field: row.spec.field, write: row.state.write }))
        .filter((row) => row.write !== undefined && staged[row.field] !== undefined);
      const save = () => {
        const writes = plannedWrites();
        setSaving(true);
        setFailed(false);
        Promise.all(writes.map((row) => (row.write.kind === "clear"
          ? scope.unset(row.field)
          : scope.set(row.field, row.write.value))))
          .then(() => {
            setStaged({});
            setOpen(false);
          })
          .catch(() => {
            setFailed(true);
          })
          .finally(() => {
            setSaving(false);
          });
      };
      const discard = () => {
        setStaged({});
        setFailed(false);
      };

      const title = t("settings.title");
      return react.createElement(
        "li",
        { className: "dsb_cfg", "data-open": open === true ? "true" : "false" },
        react.createElement(
          "button",
          {
            type: "button",
            className: "dsb_cfgHead",
            "aria-expanded": open,
            "aria-label": t(open === true ? "settings.collapse" : "settings.expand") + ": " + title,
            onClick: () => setOpen(!open),
          },
          react.createElement(
            "span",
            { className: "dsb_cfgHeadText" },
            react.createElement("span", { className: "dsb_cfgName" }, title),
            react.createElement("span", { className: "dsb_cfgDesc" }, t("settings.description")),
          ),
          dirty === true ? react.createElement("span", { className: "dsb_cfgPending" }, t("settings.unsaved")) : null,
          chevronIcon(open),
        ),
        open === false ? null : react.createElement(
          "div",
          { className: "dsb_cfgBody" },
          snapshot.writable === true
            ? null
            : react.createElement("p", { className: "dsb_cfgReadOnly", role: "status" }, t("settings.readOnly")),
          rows.map((row) => (row.spec.kind === "boolean"
            ? settingsToggleField(t, row.spec, row.state, disabled, (value) => edit(row.spec.field, { value }), () => edit(row.spec.field, { clear: true }))
            : settingsTextField(t, row.spec, row.state, disabled, (text) => edit(row.spec.field, { text }), () => edit(row.spec.field, { clear: true })))),
          react.createElement(
            "div",
            { className: "dsb_cfgFooter" },
            failed === true ? react.createElement("p", { className: "dsb_cfgFailed", role: "status" }, t("settings.saveFailed")) : null,
            react.createElement(
              "button",
              { type: "button", className: "dsb_cfgDiscard", disabled: dirty !== true || saving === true, onClick: discard },
              t("settings.discard"),
            ),
            react.createElement(
              "button",
              {
                type: "button",
                className: "dsb_cfgSave",
                disabled: dirty !== true || invalid === true || saving === true || snapshot.writable !== true,
                onClick: save,
              },
              t(saving === true ? "settings.saving" : "settings.save"),
            ),
          ),
        ),
      );
    }
    //#endregion

    //#region components
    /** 24x24 Material "refresh" outline, drawn at 14px. */
    const REFRESH_PATH = "M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z";

    /**
     * Render the refresh icon.
     * @param busy - whether a read is in flight (adds the spin animation).
     * @returns the svg element.
     */
    function refreshIcon(busy) {
      return react.createElement(
        "svg",
        {
          className: busy === true ? "dsb_icon dsb_busy" : "dsb_icon",
          viewBox: "0 0 24 24",
          width: 14,
          height: 14,
          "aria-hidden": "true",
          focusable: "false",
        },
        react.createElement("path", { fill: "currentColor", d: REFRESH_PATH }),
      );
    }

    /**
     * One status dot.
     * @param tone - `ok`, `warn`, `error`, or `idle`.
     * @returns the dot element.
     */
    function toneDot(tone) {
      return react.createElement("span", { className: "dsb_dot", "data-tone": tone });
    }

    /**
     * Composer-dock strip: one pill per account, styled to sit beside the chat
     * stats pills, plus an explicit refresh pill.
     * @param props - slot props plus `variant` and the translator (`t`).
     * @returns the dock row element.
     */
    function DockBalance(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const { payload, error, busy, refresh } = useBalance();
      const [rootRef, lift, side] = useDockLift();
      const overlaid = shouldOverlay(lift, side);
      const accounts = payload === null ? [] : (payload.accounts ?? []);
      const multiple = accounts.length > 1;

      const children = [];
      if (accounts.length === 0) {
        children.push(react.createElement(
          "span",
          { className: "dsb_pill", key: "placeholder" },
          toneDot(error !== null ? "error" : "idle"),
          react.createElement("span", { className: "dsb_n" }, t("chip.label")),
          react.createElement("span", { className: "dsb_v" }, error !== null ? "—" : "…"),
        ));
      } else {
        for (const account of accounts) {
          if (children.length > 0) {
            children.push(react.createElement("span", { className: "dsb_sep", "aria-hidden": true, key: `sep-${account.id}` }, "·"));
          }
          const name = accountName(account, t, multiple, overlaid);
          children.push(react.createElement(
            "span",
            { className: "dsb_pill", key: account.id },
            toneDot(accountTone(account)),
            name.length === 0 ? null : react.createElement("span", { className: "dsb_n" }, name),
            react.createElement("span", { className: "dsb_v" }, accountValue(account)),
            spentTodayOf(account) === null
              ? null
              : react.createElement(
                "span",
                { className: "dsb_spend", key: "spend", title: t("spend.today") + " " + spentTodayOf(account) + " " + t("spend.note") },
                "\u2193" + spentTodayOf(account),
              ),
          ));
        }
      }
      children.push(react.createElement(
        "button",
        {
          type: "button",
          className: "dsb_pill",
          key: "refresh",
          title: t("chip.refresh"),
          "aria-label": t("chip.refresh"),
          disabled: busy === true,
          onClick: () => refresh(true),
        },
        refreshIcon(busy),
      ));
      return react.createElement(
        "div",
        {
          className: "dsb_dock",
          ref: rootRef,
          "data-lifted": overlaid ? "true" : "false",
          "data-side": side,
          style: { "--dsb-lift": String(lift) + "px" },
          "data-tone": error !== null ? "error" : "ok",
          title: tooltipOf(payload, error, t),
        },
        children,
      );
    }

    /**
     * Sidebar-foot chip: the first usable account, with the rest in the
     * tooltip; collapses to one amount button on a narrow rail.
     * @param props - slot props (`wide`) plus `variant` and the translator (`t`).
     * @returns the chip element.
     */
    function FooterBalance(props) {
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const compact = props.wide === false;
      const { payload, error, busy, refresh } = useBalance();
      const accounts = payload === null ? [] : (payload.accounts ?? []);
      const shown = accounts.find((account) => account.ok === true) ?? accounts[0] ?? null;
      const extra = accounts.length > 1 ? accounts.length - 1 : 0;
      const tone = shown === null ? (error !== null ? "error" : "idle") : accountTone(shown);
      const value = shown === null ? (error !== null ? "—" : "…") : accountValue(shown);
      const tooltip = tooltipOf(payload, error, t);

      if (compact === true) {
        return react.createElement(
          "button",
          {
            type: "button",
            className: "dsb_button",
            title: tooltip,
            "aria-label": t("chip.label") + " " + value + " — " + t("chip.refresh"),
            onClick: () => refresh(true),
          },
          toneDot(tone),
          react.createElement(
            "span",
            { className: "dsb_value" },
            value,
            spentTodayOf(shown) === null ? null : react.createElement("span", { className: "dsb_spend" }, "\u2193" + spentTodayOf(shown)),
          ),
        );
      }

      return react.createElement(
        "div",
        { className: "dsb_root", "data-tone": tone, title: tooltip },
        toneDot(tone),
        react.createElement("span", { className: "dsb_label" }, busy === true && shown === null ? t("chip.busy") : t("chip.label")),
        react.createElement("span", { className: "dsb_value" }, value),
        spentTodayOf(shown) === null
          ? null
          : react.createElement(
            "span",
            { className: "dsb_spend", title: t("spend.today") + " " + spentTodayOf(shown) + " " + t("spend.note") },
            "\u2193" + spentTodayOf(shown),
          ),
        extra > 0 ? react.createElement("span", { className: "dsb_label" }, "+" + String(extra)) : null,
        react.createElement(
          "button",
          {
            type: "button",
            className: "dsb_refresh",
            title: t("chip.refresh"),
            "aria-label": t("chip.refresh"),
            disabled: busy === true,
            onClick: () => refresh(true),
          },
          refreshIcon(busy),
        ),
      );
    }
    //#endregion

    //#region plugin
    /** The slot and locale services every seat needs; `settingsScope` is optional. */
    const inject = ["slots", "locale"];

    /**
     * Client plugin body: register both seats, the dictionaries, and — where the
     * deployment composes the settings domain — this plugin's configuration card.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "deepseek-balance: dictionaries");
      /* order 1 renders below the stats pills (which register at 0), so the
         balance line sits directly above the composer. */
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "deepseek-balance",
        order: 1,
        locale: NS,
        inject: () => ({ variant: "dock" }),
      }, DockBalance));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
        name: "sidebar.footer.action",
        id: "deepseek-balance",
        order: 20,
        locale: NS,
        inject: () => ({ variant: "footer" }),
      }, FooterBalance));
      /* The Settings -> Plugins card is optional, and keyed by the settings
         namespace the host half registers, so the tab pairs the two without
         either half importing the other. A deployment without the settings
         domain keeps both balance seats and simply shows no card. */
      ctx.inject?.(["settingsScope"], (settingsCtx) => {
        const scope = settingsCtx.settingsScope.bind({ namespace: NS });
        settingsCtx.slots.inject("settings.plugin.item", () => settingsCtx.slots.register({
          name: "settings.plugin.item",
          key: NS,
          locale: NS,
          inject: () => ({ variant: "settings", scope }),
        }, BalanceSettingsCard));
      });
    }
    //#endregion

    exports.DockBalance = DockBalance;
    exports.FooterBalance = FooterBalance;
    exports.BalanceSettingsCard = BalanceSettingsCard;
    exports.SETTINGS_FIELDS = SETTINGS_FIELDS;
    exports.settingsFieldState = settingsFieldState;
    exports.useBalance = useBalance;
    exports.computeLift = computeLift;
    exports.measureLift = measureLift;
    exports.chooseSide = chooseSide;
    exports.measureSide = measureSide;
    exports.childExtent = childExtent;
    exports.shouldOverlay = shouldOverlay;
    exports.followLift = followLift;
    exports.layoutAncestorOf = layoutAncestorOf;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
