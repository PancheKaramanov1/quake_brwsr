# Multiplayer Weapon Matrix

Inventory of weapons present in the codebase and their multiplayer status.

| Weapon | Current SP behavior | MP implementation | Authority model | Tests | Status |
| ------ | ------------------- | ----------------- | --------------- | ----- | ------ |
| Rocket launcher | Only usable SP weapon. Fire rate from shared constants. Infinite ammo in SP (`Player.ts` keeps ammo display). Babylon mesh + particle trail presentation. | Fully networked. Ammo capacity 8, fire interval 0.5s, reload 2s, splash + direct hit, self-damage ×0.5. | Server owns ammo, cooldown, reload, spawn origin (eye + aim), projectile sim, world/player collision, splash, damage, death, scoring. Client predicts presentation only; no victim ID or damage amount from client. | `tests/simulation/projectiles.test.ts`, `combat.test.ts`, `adversarial.test.ts`, load/soak bots fire rockets | **Complete** |

## Existing weapons found

Only **one** usable weapon exists in single-player and multiplayer: the rocket launcher.

- SP: [`src/WeaponSystem.ts`](../src/WeaponSystem.ts) (now imports damage/speed/ammo/fire-rate from shared constants)
- MP: [`src/shared/simulation/weapons.ts`](../src/shared/simulation/weapons.ts)

No shotgun, railgun, lightning gun, nailgun, grenade launcher, or hitscan weapons exist in this repository. Therefore lag-compensated hitscan rewind is **not applicable**.

## Intentionally not invented

This hardening pass does **not** add a classic Quake arsenal. New weapons would require shared definitions, protocol events, prediction, and rewind policy — tracked as future work, not blockers.

## Shared definition rule

Movement and rocket combat constants live in [`src/shared/simulation/constants.ts`](../src/shared/simulation/constants.ts). SP presentation must not silently diverge on damage, splash radius, projectile speed, fire interval, or ammo capacity.
