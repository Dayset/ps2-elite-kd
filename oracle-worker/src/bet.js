/**
 * Betting on alert winners with virtual points (never purchasable, never cashable).
 *
 * Pricing: a logarithmic market scoring rule (LMSR) seeded from the oracle's
 * current win probabilities, re-seeded at every bet. A small stake pays about
 * the displayed probability; a bigger stake moves the price against itself.
 * Prices can never go stale relative to the model, so a bettor only profits by
 * knowing better than the oracle.
 *
 *   shares for net stake m on outcome X with model prob p:
 *     s = b · ln(1 + (e^(m/b) − 1) / p)          (each share pays 1 point if X wins)
 *
 * Fees (owner-approved ladder, oracle/goal/GOAL.md): 5 % after 50 % of the alert,
 * 15 % after 80 %, 30 % after 90 %, +10 % when the pick is above 75 %. Fees are a
 * points sink (refunded in full when a market is voided). Betting closes at 95 % of
 * the alert, and while the live map data looks corrupt; decided outcomes can't be bet.
 * Anti-throwing: a VS/NC/TR character may back only its own faction (NSO: any).
 */
import { FACS } from "./engine.js";
import { accountFromRequest } from "./auth.js";

export const BET = Object.freeze({
  LIQUIDITY: 2000, STAKES: [25, 50, 100, 200], START_BALANCE: 1000,
  CLOSE_AT: 0.95, MIN_PCT: 1, MAX_PCT: 99, MAX_DRIFT_PCT: 3,
  AUTO_PER_HOUR: 5, AUTO_CAP: 20, MANUAL_BONUS: 25,
  OWN_FACTION_ONLY: true,
});

export function feeRate(progress, pct) {
  let f = progress >= 0.9 ? 0.3 : progress >= 0.8 ? 0.15 : progress >= 0.5 ? 0.05 : 0;
  if (pct > 75) f += 0.1;
  return f;
}

/** LMSR quote seeded at the model probabilities. pct = outcome win % (0-100). */
export function quote(stake, pct, progress, b = BET.LIQUIDITY) {
  const p = pct / 100;
  const fee = Math.round(stake * feeRate(progress, pct) * 100) / 100;
  const net = stake - fee;
  const shares = b * Math.log(1 + (Math.exp(net / b) - 1) / p);
  return { stake, fee, net, shares: Math.round(shares * 100) / 100, payout: Math.round(shares * 100) / 100,
    avg_price: Math.round((net / shares) * 10000) / 10000, pct };
}

const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Wallet row for an account, created on first use; applies the automatic top-up lazily. */
export async function wallet(db, cid, now) {
  let w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
  if (!w) {
    await db.prepare("INSERT OR IGNORE INTO wallet (cid, balance, created, last_auto_at) VALUES (?,?,?,?)").bind(cid, BET.START_BALANCE, now, now).run();
    w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
  }
  if (w.balance < BET.AUTO_CAP) {
    const hours = Math.floor((now - w.last_auto_at) / 3600);
    if (hours >= 1) {
      const add = Math.min(BET.AUTO_CAP - w.balance, hours * BET.AUTO_PER_HOUR);
      await db.prepare("UPDATE wallet SET balance=balance+?, last_auto_at=? WHERE cid=? AND last_auto_at=?").bind(add, w.last_auto_at + hours * 3600, cid, w.last_auto_at).run();
      w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
    }
  } else if (now - w.last_auto_at >= 3600) {
    await db.prepare("UPDATE wallet SET last_auto_at=? WHERE cid=?").bind(now, cid).run();
  }
  return w;
}

/** Market for a live alert from its stored state: {pcts, progress, open, reason}. */
export function marketFor(alert, now) {
  if (!alert || alert.status !== "live" || !alert.state) return { open: false, reason: "not_live" };
  const st = typeof alert.state === "string" ? JSON.parse(alert.state) : alert.state;
  const progress = Math.max(0, (now - alert.start_ts) / (alert.dur * 60));
  if (progress >= BET.CLOSE_AT) return { open: false, reason: "closed", progress };
  if (now - st.ts > 180) return { open: false, reason: "odds_stale", progress };
  if (st.suspect && st.suspect.length) return { open: false, reason: "data_suspect", progress, suspect: st.suspect };
  const pcts = Object.fromEntries(FACS.map((f) => [f, st.win[f].pct]));
  return { open: true, pcts, progress, state_ts: st.ts };
}

/**
 * Settle every open bet of settled/canceled/unresolved alerts. Returns statements to batch.
 * Void (draw, canceled, unresolved, or flagged "bets_void" because the map data was
 * corrupt and disagreed with Census) refunds the full stake, fee included: players
 * don't pay for a market we couldn't settle.
 */
export function settleStatements(db, alerts, now) {
  const out = [];
  for (const a of alerts) {
    const flags = typeof a.flags === "string" ? JSON.parse(a.flags || "[]") : a.flags || [];
    if (a.status === "settled" && FACS.includes(a.winner) && !flags.includes("bets_void")) {
      out.push(db.prepare("UPDATE bet SET status=CASE WHEN outcome=? THEN 'won' ELSE 'lost' END, payout=CASE WHEN outcome=? THEN shares ELSE 0 END, settled_ts=? WHERE key=? AND status='open'")
        .bind(a.winner, a.winner, now, a.key));
    } else {
      out.push(db.prepare("UPDATE bet SET status='void', payout=stake, settled_ts=? WHERE key=? AND status='open'").bind(now, a.key));
    }
  }
  // Credit everything just settled (payout once: credited=0 -> 1).
  out.push(db.prepare(`UPDATE wallet SET balance = balance + COALESCE((SELECT SUM(payout) FROM bet WHERE bet.cid = wallet.cid AND bet.settled_ts IS NOT NULL AND bet.credited = 0), 0)
    WHERE cid IN (SELECT cid FROM bet WHERE settled_ts IS NOT NULL AND credited = 0)`));
  out.push(db.prepare("UPDATE bet SET credited = 1 WHERE settled_ts IS NOT NULL AND credited = 0"));
  return out;
}

export async function handleBet(request, env, url, json, now = Math.floor(Date.now() / 1000)) {
  const db = env.DB;
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const ns = { "Cache-Control": "no-store" };

  if (p === "/bet/quote") {
    const q = request.method === "POST" ? body : Object.fromEntries(url.searchParams);
    const a = await db.prepare("SELECT * FROM alert WHERE key=?").bind(String(q.key || "")).first();
    const m = marketFor(a, now);
    if (!m.open) return json({ open: false, reason: m.reason, ...(m.suspect ? { suspect: m.suspect } : {}) }, 200, ns);
    const out = {};
    for (const f of FACS) {
      out[f] = m.pcts[f] < BET.MIN_PCT || m.pcts[f] > BET.MAX_PCT ? null
        : Object.fromEntries(BET.STAKES.map((s) => [s, quote(s, m.pcts[f], m.progress)]));
    }
    return json({ open: true, progress: Math.round(m.progress * 1000) / 1000, fee_rate: Object.fromEntries(FACS.map((f) => [f, feeRate(m.progress, m.pcts[f])])),
      pcts: m.pcts, quotes: out, own_faction_only: BET.OWN_FACTION_ONLY }, 200, ns);
  }

  if (p === "/bet/leaderboard") {
    const rows = (await db.prepare(`SELECT a.name, a.faction, w.balance, COUNT(b.id) AS bets,
        SUM(CASE WHEN b.status IN ('won','lost','void') THEN b.payout - b.stake ELSE 0 END) AS profit,
        SUM(CASE WHEN b.status='won' THEN 1 ELSE 0 END) AS won
      FROM wallet w JOIN account a ON a.cid = w.cid LEFT JOIN bet b ON b.cid = w.cid
      GROUP BY w.cid HAVING bets >= 1 ORDER BY profit DESC LIMIT 20`).all()).results || [];
    return json({ leaders: rows.map((r) => ({ ...r, profit: Math.round((r.profit || 0) * 100) / 100, balance: Math.round(r.balance * 100) / 100 })) }, 200, { "Cache-Control": "public, max-age=30" });
  }

  const acct = await accountFromRequest(request, db);
  if (!acct) return json({ error: "not_signed_in" }, 401, ns);

  if (p === "/bet/me") {
    const w = await wallet(db, acct.cid, now);
    const bets = (await db.prepare("SELECT id, key, outcome, stake, fee, net, shares, pct, progress, placed_ts, status, payout FROM bet WHERE cid=? ORDER BY placed_ts DESC LIMIT 50").bind(acct.cid).all()).results || [];
    const settledRows = bets.filter((b) => b.status !== "open");
    return json({ balance: Math.round(w.balance * 100) / 100, bonus_available: w.last_manual_day !== day(now),
      own_faction: acct.faction, bets, profit: Math.round(settledRows.reduce((s, b) => s + b.payout - b.stake, 0) * 100) / 100 }, 200, ns);
  }

  if (p === "/bet/bonus" && request.method === "POST") {
    await wallet(db, acct.cid, now);
    const r = await db.prepare("UPDATE wallet SET balance=balance+?, last_manual_day=? WHERE cid=? AND (last_manual_day IS NULL OR last_manual_day != ?)")
      .bind(BET.MANUAL_BONUS, day(now), acct.cid, day(now)).run();
    if (!r.meta.changes) return json({ error: "already_claimed_today" }, 409, ns);
    const w = await wallet(db, acct.cid, now);
    return json({ ok: true, balance: Math.round(w.balance * 100) / 100 }, 200, ns);
  }

  if (p === "/bet/place" && request.method === "POST") {
    const stake = +body.stake;
    const outcome = String(body.outcome || "");
    if (!BET.STAKES.includes(stake)) return json({ error: "bad_stake", stakes: BET.STAKES }, 400, ns);
    if (!FACS.includes(outcome)) return json({ error: "bad_outcome" }, 400, ns);
    if (BET.OWN_FACTION_ONLY && FACS.includes(acct.faction) && outcome !== acct.faction) return json({ error: "own_faction_only", faction: acct.faction }, 403, ns);
    const a = await db.prepare("SELECT * FROM alert WHERE key=?").bind(String(body.key || "")).first();
    const m = marketFor(a, now);
    if (!m.open) return json({ error: m.reason }, 409, ns);
    const pct = m.pcts[outcome];
    if (pct < BET.MIN_PCT || pct > BET.MAX_PCT) return json({ error: "decided" }, 409, ns);
    if (body.seen_pct != null && Math.abs(+body.seen_pct - pct) > BET.MAX_DRIFT_PCT) return json({ error: "odds_changed", pct }, 409, ns);
    await wallet(db, acct.cid, now);
    const q = quote(stake, pct, m.progress);
    const id = crypto.randomUUID();
    const [debit] = await db.batch([
      db.prepare("UPDATE wallet SET balance = balance - ? WHERE cid = ? AND balance >= ?").bind(stake, acct.cid, stake),
      db.prepare(`INSERT INTO bet (id, cid, key, outcome, stake, fee, net, shares, pct, progress, placed_ts, status, payout, credited)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,'open',0,0 WHERE changes() = 1`)
        .bind(id, acct.cid, a.key, outcome, stake, q.fee, q.net, q.shares, pct, Math.round(m.progress * 1000) / 1000, now),
    ]);
    if (!debit.meta || !debit.meta.changes) return json({ error: "insufficient_balance" }, 409, ns);
    const w = await db.prepare("SELECT balance FROM wallet WHERE cid=?").bind(acct.cid).first();
    return json({ ok: true, bet: { id, key: a.key, outcome, ...q }, balance: Math.round(w.balance * 100) / 100 }, 200, ns);
  }

  return json({ error: "not_found" }, 404, ns);
}
