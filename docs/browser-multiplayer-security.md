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
| Move axes clamped | −1…1 before `applyInput` |
| Reconnect tokens | Random `sessionId` + `reconnectToken` (16 bytes hex each) |
| Security logging | `SecurityLogger` (`[security]` lines) |
| Shutdown drain | Stop accepting; notify; close sockets |

Weapon fire rate, ammo (capacity 8), and reload are enforced in shared `weapons.ts` on the server world — clients cannot invent rockets.

## Configuration hardening

```bash
NODE_ENV=production
ALLOWED_ORIGINS=https://your-client-origin.example
```

- Production rejects missing `Origin` (dev allows empty for non-browser tools).
- Avoid `ALLOWED_ORIGINS=*` in public deployments.
- Restrict `/metrics` at the reverse proxy (see deployment doc).
- Never put secrets in the Vite client bundle; only `VITE_GAME_SERVER_URL` is needed for connect.

## What is not included (yet)

- Account auth / bans DB (`Banned` / `AuthFailed` reasons exist for future use)
- Match tickets or signed join tokens
- Per-IP connection caps / global ban list
- Encrypted reconnect tokens at rest (in-memory only)
- Full movement anomaly scoring beyond tick skew + sim clamp

Treat current bar as **casual FFA + server authority**, suitable for a prototype, not a ranked competitive product.

## XSS / HUD

Render display names as text nodes (menu already builds DOM via JS strings carefully). Do not `innerHTML` raw names if extending UI.

## Incident signals

Watch logs for: `reject … origin`, `invalid_message`, `rate_limit`, `movement_violation`, `weapon_violation`. Correlate with `/metrics` `rejects` / `errors`.
