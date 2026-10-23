/**
 * Alert-winner voting with BonusCheques, a meme currency.
 *
 * BonusCheques have no cash value: they can't be bought, sold, traded or cashed
 * out, and nothing is ever paid out in any form. Voting exists to pull players
 * into the fight: back your faction, then go help it win. Fair play only, which is
 * why voting needs a character verified by an in-game logout, and why a VS/NC/TR
 * character may vote only for its own faction (NSO: any), so nobody gains from
 * throwing a fight.
 *
 * Odds: a logarithmic market scoring rule (LMSR) seeded from the oracle's current
 * win probabilities, re-seeded at every vote. A small vote returns about what the
 * displayed probability implies; a bigger one moves the odds against itself. You
 * only come out ahead by reading the fight better than the oracle.
 *
 *   cheques back for net amount m on outcome X with model prob p:
 *     s = b · ln(1 + (e^(m/b) − 1) / p)
 *
 * Late-vote fee (owner-approved ladder, oracle/goal/GOAL.md): 5 % after 50 % of the
 * alert, 15 % after 80 %, 30 % after 90 %, +10 % when the pick is above 75 %. Fees
 * just disappear (refunded in full when a vote is voided). Voting closes at 95 % of
 * the alert and while the live map data looks corrupt; decided outcomes can't be voted.
 */
import { FACS } from "./engine.js";
import { accountFromRequest } from "./auth.js";

export const VOTE = Object.freeze({
  LIQUIDITY: 2000, AMOUNTS: [25, 50, 100, 200], START_BALANCE: 1000,
  CLOSE_AT: 0.95, MIN_PCT: 1, MAX_PCT: 99, MAX_DRIFT_PCT: 3,
  AUTO_PER_HOUR: 5, AUTO_CAP: 20, DAILY_BONUS: 25,
  OWN_FACTION_ONLY: true,
});

export function feeRate(progress, pct) {
  let f = progress >= 0.9 ? 0.3 : progress >= 0.8 ? 0.15 : progress >= 0.5 ? 0.05 : 0;
  if (pct > 75) f += 0.1;
  return f;
}

/** LMSR odds seeded at the model probabilities. pct = outcome win % (0-100). */
export function quote(amount, pct, progress, b = VOTE.LIQUIDITY) {
  const p = pct / 100;
  const fee = Math.round(amount * feeRate(progress, pct) * 100) / 100;
  const net = amount - fee;
  const shares = b * Math.log(1 + (Math.exp(net / b) - 1) / p);
  const back = Math.round(shares * 100) / 100;
  return { amount, fee, net, reward: back, odds: Math.round((net / shares) * 10000) / 10000, pct };
}

const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const r2 = (x) => Math.round((x || 0) * 100) / 100;

/** Wallet row for an account, created on first use; applies the automatic top-up lazily. */
export async function wallet(db, cid, now) {
  let w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
  if (!w) {
    await db.prepare("INSERT OR IGNORE INTO wallet (cid, balance, created, last_auto_at) VALUES (?,?,?,?)").bind(cid, VOTE.START_BALANCE, now, now).run();
    w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
  }
  if (w.balance < VOTE.AUTO_CAP) {
    const hours = Math.floor((now - w.last_auto_at) / 3600);
    if (hours >= 1) {
      const add = Math.min(VOTE.AUTO_CAP - w.balance, hours * VOTE.AUTO_PER_HOUR);
      await db.prepare("UPDATE wallet SET balance=balance+?, last_auto_at=? WHERE cid=? AND last_auto_at=?").bind(add, w.last_auto_at + hours * 3600, cid, w.last_auto_at).run();
      w = await db.prepare("SELECT * FROM wallet WHERE cid=?").bind(cid).first();
    }
  } else if (now - w.last_auto_at >= 3600) {
    await db.prepare("UPDATE wallet SET last_auto_at=? WHERE cid=?").bind(now, cid).run();
  }
  return w;
}

/** Voting state for a live alert from its stored state: {pcts, progress, open, reason}. */
export function marketFor(alert, now) {
  if (!alert || alert.status !== "live" || !alert.state) return { open: false, reason: "not_live" };
  const st = typeof alert.state === "string" ? JSON.parse(alert.state) : alert.state;
  const progress = Math.max(0, (now - alert.start_ts) / (alert.dur * 60));
  if (progress >= VOTE.CLOSE_AT) return { open: false, reason: "closed", progress };
  if (now - st.ts > 180) return { open: false, reason: "odds_stale", progress };
  if (st.suspect && st.suspect.length) return { open: false, reason: "data_suspect", progress, suspect: st.suspect };
  const pcts = Object.fromEntries(FACS.map((f) => [f, st.win[f].pct]));
  return { open: true, pcts, progress, state_ts: st.ts };
}

/**
 * Settle every open vote of settled/canceled/unresolved alerts. Returns statements to batch.
 * Void (draw, canceled, unresolved, or flagged "votes_void" because the map data was
 * corrupt and disagreed with Census) gives back the full amount, fee included.
 */
export function settleStatements(db, alerts, now) {
  const out = [];
  for (const a of alerts) {
    const flags = typeof a.flags === "string" ? JSON.parse(a.flags || "[]") : a.flags || [];
    if (a.status === "settled" && FACS.includes(a.winner) && !flags.includes("votes_void")) {
      out.push(db.prepare("UPDATE vote SET status=CASE WHEN outcome=? THEN 'won' ELSE 'lost' END, reward=CASE WHEN outcome=? THEN potential ELSE 0 END, settled_ts=? WHERE key=? AND status='open'")
        .bind(a.winner, a.winner, now, a.key));
    } else {
      out.push(db.prepare("UPDATE vote SET status='void', reward=amount, settled_ts=? WHERE key=? AND status='open'").bind(now, a.key));
    }
  }
  // Credit everything just settled, once (credited=0 -> 1).
  out.push(db.prepare(`UPDATE wallet SET balance = balance + COALESCE((SELECT SUM(reward) FROM vote WHERE vote.cid = wallet.cid AND vote.settled_ts IS NOT NULL AND vote.credited = 0), 0)
    WHERE cid IN (SELECT cid FROM vote WHERE settled_ts IS NOT NULL AND credited = 0)`));
  out.push(db.prepare("UPDATE vote SET credited = 1 WHERE settled_ts IS NOT NULL AND credited = 0"));
  return out;
}

export async function handleVote(request, env, url, json, now = Math.floor(Date.now() / 1000)) {
  const db = env.DB;
  const p = url.pathname;
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};
  const ns = { "Cache-Control": "no-store" };

  if (p === "/vote/quote") {
    const q = request.method === "POST" ? body : Object.fromEntries(url.searchParams);
    const a = await db.prepare("SELECT * FROM alert WHERE key=?").bind(String(q.key || "")).first();
    const m = marketFor(a, now);
    if (!m.open) return json({ open: false, reason: m.reason, ...(m.suspect ? { suspect: m.suspect } : {}) }, 200, ns);
    const out = {};
    for (const f of FACS) {
      out[f] = m.pcts[f] < VOTE.MIN_PCT || m.pcts[f] > VOTE.MAX_PCT ? null
        : Object.fromEntries(VOTE.AMOUNTS.map((s) => [s, quote(s, m.pcts[f], m.progress)]));
    }
    return json({ open: true, progress: Math.round(m.progress * 1000) / 1000, fee_rate: Object.fromEntries(FACS.map((f) => [f, feeRate(m.progress, m.pcts[f])])),
      pcts: m.pcts, quotes: out, own_faction_only: VOTE.OWN_FACTION_ONLY }, 200, ns);
  }

  if (p === "/vote/leaderboard") {
    const rows = (await db.prepare(`SELECT a.name, a.faction, w.balance, COUNT(v.id) AS votes,
        SUM(CASE WHEN v.status IN ('won','lost','void') THEN v.reward - v.amount ELSE 0 END) AS gain,
        SUM(CASE WHEN v.status='won' THEN 1 ELSE 0 END) AS won
      FROM wallet w JOIN account a ON a.cid = w.cid LEFT JOIN vote v ON v.cid = w.cid
      GROUP BY w.cid HAVING votes >= 1 ORDER BY gain DESC LIMIT 20`).all()).results || [];
    return json({ leaders: rows.map((r) => ({ ...r, gain: r2(r.gain), balance: r2(r.balance) })) }, 200, { "Cache-Control": "public, max-age=30" });
  }

  const acct = await accountFromRequest(request, db);
  if (!acct) return json({ error: "not_signed_in" }, 401, ns);
  // The oracle predicts PC alerts: PlayStation sign-ins (us-/eu-<cid>, #61) can't vote.
  if (!/^\d{5,25}$/.test(String(acct.cid))) return json({ error: "pc_only" }, 403, ns);

  if (p === "/vote/me") {
    const w = await wallet(db, acct.cid, now);
    const votes = (await db.prepare("SELECT id, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward FROM vote WHERE cid=? ORDER BY placed_ts DESC LIMIT 50").bind(acct.cid).all()).results || [];
    const settledRows = votes.filter((v) => v.status !== "open");
    return json({ balance: r2(w.balance), bonus_available: w.last_manual_day !== day(now),
      own_faction: acct.faction, votes, gain: r2(settledRows.reduce((s, v) => s + v.reward - v.amount, 0)) }, 200, ns);
  }

  if (p === "/vote/bonus" && request.method === "POST") {
    await wallet(db, acct.cid, now);
    const r = await db.prepare("UPDATE wallet SET balance=balance+?, last_manual_day=? WHERE cid=? AND (last_manual_day IS NULL OR last_manual_day != ?)")
      .bind(VOTE.DAILY_BONUS, day(now), acct.cid, day(now)).run();
    if (!r.meta.changes) return json({ error: "already_claimed_today" }, 409, ns);
    const w = await wallet(db, acct.cid, now);
    return json({ ok: true, balance: r2(w.balance) }, 200, ns);
  }

  if (p === "/vote/place" && request.method === "POST") {
    const amount = +body.amount;
    const outcome = String(body.outcome || "");
    if (!VOTE.AMOUNTS.includes(amount)) return json({ error: "bad_amount", amounts: VOTE.AMOUNTS }, 400, ns);
    if (!FACS.includes(outcome)) return json({ error: "bad_outcome" }, 400, ns);
    if (VOTE.OWN_FACTION_ONLY && FACS.includes(acct.faction) && outcome !== acct.faction) return json({ error: "own_faction_only", faction: acct.faction }, 403, ns);
    const a = await db.prepare("SELECT * FROM alert WHERE key=?").bind(String(body.key || "")).first();
    const m = marketFor(a, now);
    if (!m.open) return json({ error: m.reason }, 409, ns);
    const pct = m.pcts[outcome];
    if (pct < VOTE.MIN_PCT || pct > VOTE.MAX_PCT) return json({ error: "decided" }, 409, ns);
    if (body.seen_pct != null && Math.abs(+body.seen_pct - pct) > VOTE.MAX_DRIFT_PCT) return json({ error: "odds_changed", pct }, 409, ns);
    await wallet(db, acct.cid, now);
    const q = quote(amount, pct, m.progress);
    const id = crypto.randomUUID();
    const [debit] = await db.batch([
      db.prepare("UPDATE wallet SET balance = balance - ? WHERE cid = ? AND balance >= ?").bind(amount, acct.cid, amount),
      db.prepare(`INSERT INTO vote (id, cid, key, outcome, amount, fee, net, potential, pct, progress, placed_ts, status, reward, credited)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,'open',0,0 WHERE changes() = 1`)
        .bind(id, acct.cid, a.key, outcome, amount, q.fee, q.net, q.reward, pct, Math.round(m.progress * 1000) / 1000, now),
    ]);
    if (!debit.meta || !debit.meta.changes) return json({ error: "insufficient_balance" }, 409, ns);
    const w = await db.prepare("SELECT balance FROM wallet WHERE cid=?").bind(acct.cid).first();
    return json({ ok: true, vote: { id, key: a.key, outcome, ...q }, balance: r2(w.balance) }, 200, ns);
  }

  return json({ error: "not_found" }, 404, ns);
}
