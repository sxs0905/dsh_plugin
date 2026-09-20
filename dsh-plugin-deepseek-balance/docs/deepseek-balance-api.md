# DeepSeek Account Balance API — Reference Report

Researched against DeepSeek's official documentation (`api-docs.deepseek.com`, `platform.deepseek.com`) on 2026-09-20 (docs copyright shows © 2026 DeepSeek, Inc.; latest change-log entry 2026-09-10).

## 1. Endpoint & method

| Item | Value |
| --- | --- |
| Method | `GET` |
| Path | `/user/balance` |
| Base URL (OpenAI format) | `https://api.deepseek.com` |
| Full URL | `https://api.deepseek.com/user/balance` |

Confirmed: the API reference documents exactly `GET /user/balance` — "Get user current balance".
Source: [Get User Balance | DeepSeek API Docs](https://api-docs.deepseek.com/api/get-user-balance/)
Base URL source: [Your First API Call | DeepSeek API Docs](https://api-docs.deepseek.com/) and [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing)

```bash
curl https://api.deepseek.com/user/balance \
  -H "Accept: application/json" \
  -H "Authorization: Bearer ${DEEPSEEK_API_KEY}"
```

## 2. Authentication

- The DeepSeek API uses `Authorization: Bearer <API_KEY>`; the official first-call example sends
  `-H "Authorization: Bearer ${DEEPSEEK_API_KEY}"` to `https://api.deepseek.com`.
  Source: [Your First API Call](https://api-docs.deepseek.com/)
- API keys are created at [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys).
- A wrong/absent key yields **`401 - Authentication Fails`**.
  Source: [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)

Caveat (flag): the `/user/balance` reference page itself does **not** restate the header or an auth section; there is no per-endpoint auth block. The Bearer/token-type statement is inferred from the platform-wide auth format, not from the balance page. Empirically, an unauthenticated `GET https://api.deepseek.com/user/balance` returns HTTP 401 `Authentication Fails (governor)`, which confirms the endpoint requires an API key.

## 3. Response schema (HTTP 200, `application/json`)

| Field | Type | Required | Notes (official description) |
| --- | --- | --- | --- |
| `is_available` | `boolean` | — | Whether the user's balance is sufficient for API calls. |
| `balance_infos` | `object[]` | — | Array of per-currency balance objects. |
| `balance_infos[].currency` | `string` | — | Possible values: `CNY`, `USD`. The currency of the balance. |
| `balance_infos[].total_balance` | `string` | — | Total available balance, including granted + topped-up balance. |
| `balance_infos[].granted_balance` | `string` | — | The total **not expired** granted balance. |
| `balance_infos[].topped_up_balance` | `string` | — | The total topped-up balance. |

Amounts are **strings**, not numbers (the schema types all three balance fields as `string`).
Source: [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)
Chinese page (same schema, wording): [查询余额](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/)

### Sample response (from official docs)

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

Source: [Get User Balance — Example (from schema)](https://api-docs.deepseek.com/api/get-user-balance/) (mirrored, including the JSON sample, at [deepseek-docs raw markdown](https://raw.githubusercontent.com/thevibeworks/deepseek-docs/main/content/en/api/get-user-balance.md))

## 4. Errors & rate limits

- The balance reference documents **only the 200 response**; no endpoint-specific 4xx/5xx bodies are documented.
  Source: [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)
- Platform-wide error codes (apply to the API in general, not specifically documented for this endpoint):
  `400 Invalid Format`, `401 Authentication Fails`, `402 Insufficient Balance`, `422 Invalid Parameters`,
  `429 Rate Limit Reached`, `500 Server Error`, `503 Server Overloaded`.
  Source: [Error Codes](https://api-docs.deepseek.com/quick_start/error_codes)
- Rate limits are documented as **account-level concurrency limits per model** (deepseek-flash 2500, deepseek-v4-pro 500; over-limit → HTTP 429). No request-per-minute limit and no balance-endpoint-specific limit are documented.
  Source: [Rate Limit & Isolation](https://api-docs.deepseek.com/quick_start/rate_limit)

## 5. Other balance/usage/cost APIs & the `/v1` question

- The API Reference navigation contains **only**: Chat Completions, Responses API, FIM Completion (Beta), Lists Models, Get User Balance, Files. There is **no documented usage/cost/quota endpoint and no balance or billing webhook**.
  Source: [API Docs nav / API Reference](https://api-docs.deepseek.com/api/get-user-balance/)
- Usage/billing history is available only in the **web console**, not via a documented account API (Dashboard/Usage on [platform.deepseek.com](https://platform.deepseek.com/)).
- Per-request token usage *is* returned in chat completion responses; the docs treat the API‑returned `usage` as the source of truth for token counts, but it is not an account balance/usage query.
  Source: [Token & Token Usage](https://api-docs.deepseek.com/quick_start/token_usage)
- **OpenAI-compatible base URL `/v1`:** current official docs list the OpenAI base URL as `https://api.deepseek.com` and **no longer mention** `https://api.deepseek.com/v1`. Whether `/v1/user/balance` is served is **not documented** (see flags).

## 6. Currency, granted vs topped-up

- `currency` is an enum of `CNY` or `USD`; `balance_infos` is an **array**, so an account can report more than one currency entry. The docs do not explain which accounts receive which currency.
  Source: [Get User Balance](https://api-docs.deepseek.com/api/get-user-balance/)
- `total_balance` = granted balance + topped-up balance (official: "including the granted balance and the topped-up balance"). `granted_balance` counts only the **not expired** grant.
- Spend is deducted from both pools, **granted balance first**: "The corresponding fees will be directly deducted from your topped-up balance or granted balance, with a preference for using the granted balance first when both balances are available."
  Source: [Models & Pricing — Deduction Rules](https://api-docs.deepseek.com/quick_start/pricing)
- The docs do **not** state the decimal precision or that amounts are in major currency units; the sample `"110.00"` for `CNY` implies major units (yuan) with 2 decimals.

## Which docs page each fact came from

| Fact | Source page |
| --- | --- |
| `GET /user/balance`, schema, sample JSON, amounts are strings | [api/get-user-balance](https://api-docs.deepseek.com/api/get-user-balance/) |
| Same schema in Chinese, granted = not-expired grant | [zh-cn/api/get-user-balance](https://api-docs.deepseek.com/zh-cn/api/get-user-balance/) |
| Base URL, `Authorization: Bearer ${DEEPSEEK_API_KEY}` | [api-docs.deepseek.com](https://api-docs.deepseek.com/) |
| Base URL table, granted-first deduction rule | [quick_start/pricing](https://api-docs.deepseek.com/quick_start/pricing) |
| 400/401/402/422/429/500/503 error codes | [quick_start/error_codes](https://api-docs.deepseek.com/quick_start/error_codes) |
| Concurrency limits (no balance-specific limit) | [quick_start/rate_limit](https://api-docs.deepseek.com/quick_start/rate_limit) |
| No usage/cost endpoint or webhook in API Reference | [API Reference nav](https://api-docs.deepseek.com/api/get-user-balance/) |
| Usage returned by API is source of truth for tokens | [quick_start/token_usage](https://api-docs.deepseek.com/quick_start/token_usage) |

## Could not confirm from official docs (flags)

1. **`/v1/user/balance`**: not documented. Current docs list only `https://api.deepseek.com` as the OpenAI base URL; there is no statement that `/v1` prefixes account endpoints. An unauthenticated probe returned `401 Authentication Fails` for `/user/balance`, `/v1/user/balance`, `/v1/models`, `/models`, **and** a deliberately nonexistent path — so status codes cannot distinguish route existence. Use `https://api.deepseek.com/user/balance`.
2. **Per-endpoint auth/headers**: the balance page has no auth section or curl example; Bearer is inferred from platform-wide docs plus the observed 401.
3. **Units/precision**: strings confirmed, but the docs do not explicitly define the decimal precision or "major units vs minor units".
4. **Currency assignment**: docs do not say when `CNY` vs `USD` is returned, nor whether multiple entries always appear.
5. **Endpoint-specific error bodies and rate limits**: only the 200 response is documented; the global error list is not endpoint-specific.
6. **Usage/cost API or webhook**: none documented — absence based on the full API Reference nav, not on an explicit "no such API" statement.
