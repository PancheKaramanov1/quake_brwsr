# Browser Multiplayer Security

## Threat model (browser FPS)

Clients are untrusted. Anything the browser can forge (position, health, damage, fire rate, score) must be ignored as authority. Practical defense is **server simulation + validation + rate limits**, not client anti-tamper.

## Authority rules

| Claim from client | Server behavior |
| ----------------- | --------------- |
| Position / velocity | Ignored; derived from inputs via shared movement + AABBs |
| Fire / hit / splash | Server runs `tryFireRocket`, projectile step, splash |
| Health / kills | Server-only; clients display events/snapshots |
| Display name | Validated; sanitized length/charset; deduped |
| Protocol version | Must equal `PROTOCOL_VERSION` (1) |
| Input timestamps / ticks | Skew outside −120…+6 server ticks → drop + log |

## Controls implemented

| Control | Where |
| ------- | ----- |
| Origin allowlist on WS upgrade | `GameServer.verifyClient` + `ALLOWED_ORIGINS` |
| Max WS payload 64 KiB | `ws` `maxPayload` + decode/`handleMessage` |
| Message rate ≤ 120/s | `RateLimiter.allowMessage` |
| Input rate ≤ 90/s | `RateLimiter.allowInput` |
| Display name 1–16, `[a-zA-Z0-9_\- ]+` | `validateDisplayName` |
| Seq monotonicity | Ignore `seq <= lastSeq` |
| Tick skew check | `movementViolation` / drop input |
| Move axes clamped / diagonal normalized | −1…1 then length ≤ 1 |
| Pending input queue | Max 32 queued; max 2 applied per tick |
| Non-finite input rejection | NaN/Inf/negative seq/tick dropped |
| Reconnect tokens | Random `sessionId` + `reconnectToken` (16 bytes hex each); grace expiry |
| Security logging | `SecurityLogger` (`[security]` lines); tokens never logged |
| Shutdown drain | Stop accepting; notify; close sockets |
| Production config validation | Refuses `ALLOWED_ORIGINS=*`; validates ports/rates |

Weapon fire rate, ammo (capacity 8), and reload are enforced in shared `weapons.ts` on the server world — clients cannot invent rockets. Inputs are **queued and drained on the server tick** (not applied immediately on packet arrival) to prevent speed hacks from burst delivery.

## Configuration hardening

```bash
NODE_ENV=production
ALLOWED_ORIGINS=https://your-client-origin.example
TRUST_PROXY=false
```

- Production rejects missing `Origin` and refuses `ALLOWED_ORIGINS=*`.
- `TRUST_PROXY=true` only affects logging of `X-Forwarded-For` — never auth.
- Restrict `/metrics` at the reverse proxy.
- Never put secrets in the Vite client bundle.

## Fuzz coverage

`tests/protocol/fuzz.test.ts` exercises empty/truncated/oversized packets, bad versions, invalid names, and NaN/Inf input floods. Offending connections are scoped; the process continues serving healthy clients.

## What is not included (yet)

- Account auth / bans DB
- Match tickets or signed join tokens
- Per-IP connection caps / global ban list
- Encrypted reconnect tokens at rest (in-memory only)
- Globally scalable multi-region allocation

Treat current bar as **casual single-server FFA + server authority**, not a ranked competitive or globally scalable production service.

## XSS / HUD

Render display names as text nodes. Do not `innerHTML` raw names if extending UI.

## Incident signals

Watch logs for: `reject … origin`, `invalid_message`, `rate_limit`, `movement_violation`. Correlate with `/metrics` `rejects` / `invalidMessages` / `movementViolations`.
