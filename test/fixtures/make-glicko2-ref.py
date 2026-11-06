"""Reference numbers for test/duels-glicko.test.mjs (#112).

A line-by-line Python transcription of melbaa/ps2ranks libs/glicko2.py (Heungsub Lee's glicko2,
BSD; rate / determine_sigma / rate_1vs1 / winpct_1vs1, same constants and quirks), kept separate from
glicko2.mjs so the two ports check each other. Regenerate: python3 test/fixtures/make-glicko2-ref.py > test/fixtures/glicko2-ref.json
"""
import json, math

MU, PHI, SIGMA, TAU, EPS, RATIO = 1500, 350, 0.06, 1.0, 0.000001, 173.7178
Q = math.log(10) / 400


class G:
    def __init__(self, tau=TAU):
        self.tau = tau

    def down(self, r):
        return ((r[0] - MU) / RATIO, r[1] / RATIO, r[2])

    def up(self, r):
        return (r[0] * RATIO + MU, r[1] * RATIO, r[2])

    def g(self, r):
        return 1 / math.sqrt(1 + (3 * r[1] ** 2) / (math.pi ** 2))

    def e(self, r, o, impact):
        return 1. / (1 + math.exp(-impact * (r[0] - o[0])))

    def sigma(self, r, difference, variance):
        phi = r[1]
        d2 = difference ** 2
        alpha = math.log(r[2] ** 2)

        def f(x):
            tmp = phi ** 2 + variance + math.exp(x)
            return math.exp(x) * (d2 - tmp) / (2 * tmp ** 2) - (x - alpha) / (self.tau ** 2)
        a = alpha
        if d2 > phi ** 2 + variance:
            b = math.log(d2 - phi ** 2 - variance)
        else:
            k = 1
            while f(alpha - k * math.sqrt(self.tau ** 2)) < 0:
                k += 1
            b = alpha - k * math.sqrt(self.tau ** 2)
        fa, fb = f(a), f(b)
        while abs(b - a) > EPS:
            c = a + (a - b) * fa / (fb - fa)
            fc = f(c)
            if fc * fb < 0:
                a, fa = b, fb
            else:
                fa /= 2
            b, fb = c, fc
        return math.exp(1) ** (a / 2)

    def rate(self, rating, series):
        r = self.down(rating)
        vi = diff = 0
        for s, o in series:
            o = self.down(o)
            im = self.g(o)
            ex = self.e(r, o, im)
            vi += im ** 2 * ex * (1 - ex)
            diff += im * (s - ex)
        diff /= vi
        var = 1. / vi
        sig = self.sigma(r, diff, var)
        ps = math.sqrt(r[1] ** 2 + sig ** 2)
        phi = 1 / math.sqrt(1 / ps ** 2 + 1 / var)
        mu = r[0] + phi ** 2 * (diff / var)
        return self.up((mu, phi, sig))

    def rate_1vs1(self, r1, r2):
        return self.rate(r1, [(1., r2)]), self.rate(r2, [(0., r1)])

    def winpct(self, r1, r2):
        a, b = self.down(r1), self.down(r2)
        return [self.e(a, b, self.g(a)) * 100, self.e(b, a, self.g(b)) * 100]


out = {}
env = G(tau=0.5)
r = env.rate((1500, 200, 0.06), [(1, (1400, 30, 0.06)), (0, (1550, 100, 0.06)), (0, (1700, 300, 0.06))])
out["glickman"] = list(r)
env = G(tau=0.3)
seqs = {"a_wins": [1] * 25, "mixed": [1, 0, 0, 1, 1, 1, 0, 1, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1], "b_wins": [0] * 22}
for name, s in seqs.items():
    a = (1500, 100, 0.02)
    b = (1500, 100, 0.02)
    tr = []
    for k in s:
        a = (a[0], max(30, a[1]), a[2])
        b = (b[0], max(30, b[1]), b[2])
        if k:
            a, b = env.rate_1vs1(a, b)
        else:
            b, a = env.rate_1vs1(b, a)
        tr.append(list(a) + list(b))
    out[name] = {"seq": s, "traj": tr, "winpct": env.winpct(a, b)}
out["winpct_uneven"] = [[1620, 80, 1450, 200], env.winpct((1620, 80, 0.02), (1450, 200, 0.02))]
print(json.dumps(out))
