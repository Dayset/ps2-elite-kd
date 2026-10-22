# PlayStation room cache (#55)

PS4 / PS5 players on **Genudine** (Census namespace `ps2ps4us`) and **Ceres** (`ps2ps4eu`). PS5 players play on the same two servers.

This tree is completely separate from the PC cache in `data/`:

- written only by `.github/workflows/refresh-ps.yml` (`scripts/refresh-ps.mjs`, then `scripts/build-ranks.mjs --room ps`), never by the PC refresh;
- the site reads it only in the PlayStation room (`?room=ps`); searches, Rankings, positions and every percentile pool use PS players only;
- identity is server + Census character id: `players/us-<cid>.json`, `players/eu-<cid>.json`. Names are labels. Two characters with the same name get different slugs (`shadow`, `shadow-eu`) and different files;
- review lists are the room's own (`hidden.json`, `reviewed.json`, `farm.json`, `not-farm.json`, same formats as PC). PC decisions never apply here.

## Files

```
index.json          catalog: name, slug, file, key (us-/eu-<cid>), ns, server, savedAt, last
players/<key>.json  per-character payload (same shape as PC, plus room / ns / server)
names.json          slim startup list: [name, savedAt, file, slug]
ranks.json          Rankings rows (PS pool only; trailing "srv" column: us / eu)
ranks-lite.json     the few columns the main page needs at startup
discovery.json      one resumable login sweep per server + the cap ladder
refresh-state.json  attempts / failures per key
schedule.json       when the next PS run is due (read by the cache Worker cron)
status.json         last run summary
```

## Not in the PS room (yet)

- 🤝 Assists / 🪳 Zerg and other Honu-based numbers: Honu coverage of the PS servers is unverified, so PS players have none.
- Fresh-account auto-hide: its thresholds were measured on PC players.
- Live and the Oracle: PC only.
