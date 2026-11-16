# Algoritmes

What the code computes now (v0.58.0, 16 Nov 2026), as formulas. Each section
cites `file:function`. Plans say what was meant; this file says what runs.

**Wijzigen.** Any change to one of these algorithms (formula, parameter, peer
set, weights, thresholds) updates this file in the same commit; the reason
goes in `docs/decisions.md`.

Contents: 1 Woonscore · 2 Wizard and profiles · 3 Mijn stapel ·
4 Kaartkleuren and Ranglijst · 5 Area detail · 6 Derived metrics ·
7 Dashboard.

## Notation (all sections)

- $A$: the peer set, the areas of one level in one scope; $a \in A$.
- $x_{a,m}$: raw value of metric $m$ in area $a$; $\bot$ = missing.
- $A_m = \{a \in A : x_{a,m} \neq \bot\}$, $n_m = |A_m|$.
- $N_a$: inwoners of $a$; $\pi(a)$: parent area (buurt → wijk).
- $\mathbb{1}[\cdot]$: indicator. Rounding to 1 decimal: $\mathrm{r}_1(\cdot)$.

### Percentile rank with mid-rank ties (used in §1, §3, §4b, §5)

Known method: **empirical CDF / percentile rank, mid-rank tie handling**
(the rank of `PERCENTRANK.INC` with averaged ties). Code:
`score.js:percentileRanks` (0..1), `ranking.js:percentileScores` (0–100),
`area-detail.js:peerRank` (0–100). Counting by binary search (`countBelow`).

$$
b_{a,m} = \big|\{c \in A_m : x_{c,m} < x_{a,m}\}\big|,\qquad
e_{a,m} = \big|\{c \in A_m : x_{c,m} = x_{a,m}\}\big|
$$

$$
p_{a,m} =
\begin{cases}
\bot & x_{a,m} = \bot \\
\tfrac12 & n_m = 1 \\
\dfrac{b_{a,m} + (e_{a,m}-1)/2}{n_m - 1} & \text{otherwise}
\end{cases}
\qquad p \in [0,1]
$$

All values equal gives $b=0, e=n$, so $p = \tfrac12$. A monotone transform
(log1p, the `log` flag) leaves $p$ unchanged.

### Bounded robust z-score (used in §1 for crime metrics, v0.58.0)

Known method: **robust standardisation (median/MAD z-score) on the log
scale, mapped through the standard normal CDF**. Code:
`score.js:robustZFactors`, `normalCdf` (Abramowitz–Stegun 7.1.26 erf,
error $< 1.5\cdot10^{-7}$, mirrored so $\Phi(0) = \tfrac12$).

$$
y_a = \log(1 + \max(x_{a,m}, 0)),\qquad
\tilde y = \mathrm{median}_{A_m}(y),\qquad
\mathrm{MAD} = \mathrm{median}_{A_m}|y - \tilde y|
$$

$$
z_a = \mathrm{clip}\Big(\frac{y_a - \tilde y}{1.4826\,\mathrm{MAD}},\ -3,\ 3\Big),\qquad
r_{a,m} =
\begin{cases}
\Phi(z_a) & \text{higher}\\
\Phi(-z_a) & \text{lower}
\end{cases}
\qquad r \in [\Phi(-3), \Phi(3)] = [0.0013, 0.9987]
$$

Fallback: $n_m < 5$ or $\mathrm{MAD} = 0$ gives $r = p$ (higher) or $1 - p$
(lower). Equal values get equal $r$; the median area gets $\tfrac12$.
Unlike $p$, $r$ keeps the distance: Rotterdam Centrum (232 misdrijven per
1.000, wijk median 63) gets $z = 3$ (clipped), $r = 0.0013$.

---

## 1. Woonscore

Context: one 0–100 score per area against its peers, with the active preset
(`presets.js:scoreWithPreset` → `score.js:scoreAreas`).

**Peer set $A$.**
- City: the city's wijken; separately its buurten with $\pi$ = wijk
  (`areas.js`, `app.js` → `presets.js:assignScore`).
- Nederland: all NL wijken; all NL buurten with $\pi$ = wijk
  (`nl-areas.js:loadNlLevel`, `rescoreNlAreas`); all gemeenten; all
  provincies (`presets.js:rowsWithWoonscore`, no $\pi$).
- Geen woonwijk removed first: $A = \{a : \mathrm{residential}(a)\}$
  (`woongebied.js:classifyWoongebied`, rule-based classifier). With $W_a$
  woningen, $R_a$ niet-woningen, $F_a$ bedrijfsvestigingen, codes WK/BU only:

$$
\mathrm{kind}(a) =
\begin{cases}
\text{wonen/weinig} & N_a \ge 200 \ \lor\ W_a \ge 100 \\
\text{bedrijven} & R_a \ge 20 \land R_a \ge 3W_a \land (W_a < 20 \lor R_a \ge 10W_a) \land F_a \ge 0.2R_a \\
\text{overig} & \text{same, } F_a < 0.2R_a \\
\text{onbewoond} & N_a < 20 \land W_a < 10 \\
\text{wonen/weinig} & \text{otherwise (weinig if } N_a < 300)
\end{cases}
$$

  Excluded areas get $S_a = \bot$ and move no percentile or quantile.

**Step 1 – targets from peer quantiles** (`presets.js:resolveTargets`).
Known method: **sample quantile, linear interpolation (Hyndman–Fan type 7)**.
For a target $\{q, s\}$ on metric $m$:

$$
\mu_m = Q_m(q),\qquad
\tau_m = s\cdot
\begin{cases}
\tfrac12\big(Q_m(0.75) - Q_m(0.25)\big) & \text{IQR} > 0\\
\max(0.1\,|\mu_m|,\ 10^{-6}) & \text{IQR} = 0
\end{cases}
\qquad s = 1 \text{ by default}
$$

**Step 2 – preset → factor weights** (`presets.js:resolvePreset`).
Theme $t$ has weight $W_t$ and metrics $m \in M_t$ with share $w_m$ (default 1).
Only metrics with $n_m \ge 1$ count ($M_t^{*}$); themes with $W_t = 0$ or
$M_t^* = \emptyset$ drop out. Known method: **hierarchical (two-level)
weighting, normalised**.

$$
\tilde w_m = W_t\,\frac{w_m}{\sum_{k \in M_t^*} w_k},\qquad
\omega_m = \frac{\tilde w_m}{\sum_{t}\sum_{k \in M_t^*} \tilde w_k},\qquad \sum_m \omega_m = 1
$$

Guards: an origin metric (`ORIGIN_KEYS`) is kept only with pref `higher` and
no target (`originAllowed`); theme `situatie` likewise (`situatieAllowed`).

**Step 2b – parent value for missing optional metrics** (v0.58.0,
`score.js:imputeFromParent`, `presets.js:IMPUTE_KEYS`). For
$m \in \{\text{eduScore}, \text{noiseNeighbourPct}\}$ and every preset except
Gelijk (`impute: false`):

$$
x_{a,m} := x_{\pi(a),m} \quad \text{if } x_{a,m} = \bot \land x_{\pi(a),m} \ne \bot
$$

with $\pi$ = buurt → wijk (the parents given, raw wijk values) and wijk →
gemeente (the loaded onderwijs/milieu files, `presets.js:gemeenteImputeValues`).
One level only: a buurt whose wijk also lacks the value keeps $\bot$, and then
the optional rule of step 6 applies. The filled value is a peer like any
other (it enters $A_m$, the ranks and the robust z of everyone); the factor
row carries `imputed: true, imputedFrom: π(a)` and the modal's Sterk/Zwak
says "(waarde van de wijk)" / "(waarde van de gemeente)"
(`area-detail.js:factorLabel`). NL gemeenten and provincies have no $\pi$.

**Step 3 – shrinkage** (`score.js:shrinkRate`, `shrinkAreas`). Known method:
**empirical-Bayes shrinkage / Bühlmann credibility weighting** toward the
parent. Only if the preset has `shrink: true`, $\pi$ exists, and
$m \in$ `RATE_KEYS` (unit "per 1.000": crime rates, welfarePer1000):

$$
z_a = \frac{N_a}{N_a + k},\qquad
x'_{a,m} =
\begin{cases}
x_{a,m} & x_{\pi(a),m} = \bot\\
z_a\,x_{a,m} + (1-z_a)\,x_{\pi(a),m} & \text{otherwise}
\end{cases}
\qquad k = 300,\ z_a = 0 \text{ if } N_a \le 0 \lor N_a = \bot
$$

$\mathrm{shrunk}_a = \mathbb{1}[\exists m: x' \ne x] \cdot \mathbb{1}[N_a < k]$.
Shown values stay $x$; only the score uses $x'$.

**Step 4 – factor** $f_{a,m} \in [0,1]$ (`score.js:preferenceFactor`,
`targetFactor`, `robustZFactors`). $p_{a,m}$ = percentile rank of $x'_{a,m}$ in $A_m$.
A factor with `scale: 'robustZ'` uses $r_{a,m}$ (bounded robust z-score, see
Notation) on $x'$ instead of $p$ / $1-p$: every crime metric
(`presets.js:ROBUST_Z_KEYS`, keys `crime*` with lower = better: the rates per
1.000 and crimeDensity/crimeNearby per km²) in every preset except Gelijk
(`scale: 'rank'`), so Standaard, the levenstypes, Zelf samenstellen and Jouw
score. welfarePer1000 and all other metrics keep the rank.
Target: **truncated, rescaled Gaussian kernel**, $\sigma = \tau_m$:

$$
f_{a,m} =
\begin{cases}
p_{a,m} & \text{higher}\\
1 - p_{a,m} & \text{lower}\\
\dfrac{e^{-z^2/2} - e^{-2}}{1 - e^{-2}}\ \mathbb{1}[|z| < 2],\quad
z = \dfrac{g(x_{a,m}) - g(\mu_m)}{\tau_m} & \text{target}
\end{cases}
$$

$g = \log(1 + \max(\cdot, 0))$ when the target has `log`, else identity.
$f = \bot$ when $x = \bot$ (target: also when $\tau \le 0$).

**Step 5 – score.** Known method: **weighted arithmetic mean over available
factors (renormalised)**. $U_a = \{m : f_{a,m} \ne \bot\}$:

$$
c_{a,m} = 100\,\frac{\omega_m f_{a,m}}{\sum_{k \in U_a}\omega_k},\qquad
S_a = \sum_{m \in U_a} c_{a,m}
$$

**Step 6 – coverage** (v0.54.0 `optional`). $O$ = optional metrics:

$$
\mathrm{cov}_a = \frac{\sum_{m \in U_a}\omega_m}{1 - \sum_{m \in O,\ f_{a,m} = \bot}\omega_m},
\qquad
S_a := \bot \ \text{ if } U_a = \emptyset \ \lor\ \mathrm{cov}_a < \theta - 10^{-9}
$$

**Step 7 – filters.** $\mathrm{filtered}_a = \exists\,(m,\ell,u):\ x_{a,m} = \bot \lor x_{a,m} < \ell \lor x_{a,m} > u$;
then the shown value is $\bot$ (result kept). Origin keys are never filters.

**Step 8 – explain** (`score.js:explain`, `presets.js:themeBreakdown`):

$$
\iota_{a,m} = 100\,\frac{\omega_m\,(f_{a,m} - \tfrac12)}{\sum_{k \in U_a}\omega_k},\qquad
\mathrm{plus} = \mathrm{top}_3\{\iota > 0\},\ \
\mathrm{minus} = \mathrm{top}_3\{\iota < 0,\ \mathrm{theme} \notin \{\text{gemeenschap},\text{situatie}\}\}
$$

$$
\mathrm{points}_{a,t} = \sum_{m \in t \cap U_a} c_{a,m},\qquad \sum_t \mathrm{points}_{a,t} = S_a
$$

Rank (`score.js:scoreRank`, competition ranking):
$\mathrm{rank}_a = 1 + |\{c : S_c > S_a\}|$ over non-filtered peers.

**Parameters.**

| Symbol | Value | Code |
|---|---|---|
| $k$ | 300 inwoners | `score.js:SHRINK_K` |
| $\theta$ | 0.6 (Standaard, Jouw); 0 (Gelijk) | `score.js:MIN_COVERAGE`, `presets.js:GELIJK` |
| kernel cut | $\lvert z\rvert = 2$ | `score.js:targetFactor` |
| crimeNearby share | 1 | `presets.js:NEARBY_W` |
| explain top | 3 | `area-detail.js:woonscoreDetail` |
| robust z clip | $\lvert z\rvert = 3$ | `score.js:ROBUST_Z_CLIP` |
| robust z minimum $n$ | 5 | `score.js:ROBUST_Z_MIN_N` |
| MAD scale | 1.4826 | `score.js:robustZFactors` |
| imputed keys | eduScore, noiseNeighbourPct | `presets.js:IMPUTE_KEYS` |

**Standaard weights** (`presets.js:PROFILES.standaard`). $W$ = 20/10/15/15/10
(Veiligheid 20 = Heel belangrijk since v0.58.0, was 15), Woningmarkt 0
(dropped), $\sum \tilde w = 70$:

| Theme $W_t$ | Metric ($w_m$) | Pref | $\omega_m$ |
|---|---|---|---|
| Veiligheid 20 | crimeRate, crimeBurglary, crimeViolence, crimeStreetRobbery, crimeVandalism, crimeNearby (1 each, robustZ) | lower | 3.33/70 = 4.76 % each (28.6 %) |
| Welvaart 15 | avgIncome (2) | higher | 10/70 = 14.3 % |
| | welfarePer1000 (1) | lower | 5/70 = 7.1 % |
| Voorzieningen 10 | distGP, distSupermarket, distSchool, distStation, distKinderopvang (1 each) | lower | 2/70 = 2.86 % each (14.3 %) |
| Opleiding 15 | eduScore (2, optional, parent value) | higher | 14.3 % |
| | highEdu (1) | higher | 7.1 % |
| Milieu 10 | noiseNeighbourPct (1, optional, parent value) | lower | 14.3 % |
| Woningmarkt 0 | ownerOccupiedPct | higher | 0 |

Missing for all peers ($n_m = 0$): the theme's weight moves to its other
metrics (step 2). Missing for one area and its parent: renormalised in step 5;
without eduScore and noiseNeighbourPct the effective weights are $\omega/0.714$:
Veiligheid 40 %, avgIncome 20 %, Voorzieningen 20 %, welfare 10 %, highEdu 10 %.
NL gemeenten (crimeRate, avgIncome, highEdu only): 40/30/30 %.

**Gelijk gewogen** (`presets.js:GELIJK`): $W_t = 1$ per directional dataset with
`inOverall !== false`, no shrinkage, $\theta = 0$ (equals the Ranglijst
Totaalscore, §4b).

**Bekende zwaktes.**
- Rank-based outside the crime metrics: magnitude is lost there (welfare,
  income, distances). Crime uses the robust z, which saturates at $|z| = 3$:
  beyond that, worse is no longer worse.
- Per-inwoner crime rates are inflated by visitors in centres; 5 of 6
  Veiligheid metrics are such rates.
- Optional metrics renormalise onto the rest when the parent lacks them too:
  up to 29 % of the weight moves to other themes. A parent value is a
  stand-in: a buurt without a school gets its wijk's basisschoolscore.
- More Veiligheid weight lowers the coverage of areas without crime figures:
  one NL gemeente (GM0088) fell under $\theta$ with v0.58.0.
- Coverage is per weight, not per theme: a whole theme can be missing.
- Crime rates are $\bot$ below 1.000 (wijk) / 200 (buurt) inwoners (§6).
- Shrinkage needs $\pi$: wijken, gemeenten and provincies are never shrunk.
- Relative to the peer set: the same buurt scores differently in city and NL scope.

**Waar vastgelegd.** plan-woonscore §1–2; decisions W1 (engine, log1p,
shrinkage), W7 (geen woonwijk), W8 (crimeNearby), v0.54.0 (Standaard,
optional), plan-levenstype-gewichten addendum (Woningmarkt 0), v0.58.0
(Veiligheid 20, parent value, robust z for crime).

---

## 2. Wizard, levenstype profiles, Jouw vs Standaard

Context: answers → a preset scored with §1 (`wizard-model.js:answersToPreset`,
appliers `APPLY` in `APPLY_ORDER`).

**Notation.** Base weights $B_t$ after the steps; importance level
$\ell_t \in \{0..4\}$; slider weight $W_t$; Gemeenschap share $g$ (%).

**Steps (additive construction of the theme set).**
1. Start from Standaard; a levenstype replaces all `PROFILE_THEMES` by
   `PROFILES[key]` (table below). Bouwstijl adds theme nieuwbouw, $W = 5$.
2. Budget koop, ceiling $C$ (`budgetCeiling`): theme budget $W = 20$,
   wozValue target $\mu = 0.85\,C$, $\tau = 0.3\,C$ (kernel zero outside
   $[0.25C,\ 1.45C]$); "verberg te duur": filter $x \le 1.2\,C$. Huur:
   rentalPct higher in Woningmarkt ($B = 0$).
3. Stress: a metric's share becomes $w_m := \max(w_m, w_{\text{new}})$ (never
   multiplied). Fiets: crimeBike 3; ov: distOv 3; lopen: distSupermarket,
   distGP 2; auto: crimeVehicle 2, and without Sfeer a Sfeer theme $W = 8$
   with density lower; each chosen crime type 3 (`STRESS_W`).
4. Sfeer slider $s \in [0,1]$, $s := \min(1, s + 0.15)$ with auto:
   targets density at $q = \mathrm{clip}(1-s,\ 0.05,\ 0.95)$ ($w=2$),
   distCentrum at $q = \mathrm{clip}(s,\ 0.05,\ 0.95)$ ($w=1$), resolved per
   peer set (§1 step 1); horeca1km higher if $s \le 0.35$.
   $W$ = profile's Sfeer weight, else 20.
5. Dichtbij, items $i$ with level $\lambda_i$:
   $W = \min(5\sum_i \lambda_i,\ 40)$, metric share
   $w_m \mathrel{+}= \mathrm{r}_2(\lambda_i w_{i,m} / \sum_k w_{i,k})$, pref lower.
6. Situatie, $W = 30$: education level replaces Opleiding; income band
   replaces avgIncome by a target (`incomeTarget`, log tolerance 0.3); lowest
   bands move welfarePer1000 here as higher.
7. Importance (**ordinal scale → multiplicative factor**):

$$
W_t = \mathrm{r}_1\!\big(\beta_t\,\phi(\ell_t)\big),\quad
\phi = (0,\ 0.5,\ 1,\ 1.5,\ 2),\quad
\beta_t = \begin{cases} B_t & B_t > 0\\ 10 & B_t = 0\ (\texttt{NOMINAL\_BASE})\end{cases}
$$

   Displayed level for unset $\ell_t$: $\arg\min_\ell |\phi(\ell) - W_t/\beta_t|$
   (Standaard's 15 shows as Gemiddeld).
8. Gemeenschap, last, one origin metric higher, **fixed share of the total**:

$$
W_{\text{gem}} = \mathrm{r}_1\!\left(\frac{g}{100-g}\sum_{t \ne \text{gem}} W_t\right)
\ \Rightarrow\ \frac{W_{\text{gem}}}{\sum_t W_t} = \frac{g}{100},\qquad
g \in \{5,10,20,30\},\ \text{default } 20
$$

9. `guardOrigin`; shrink and $\theta$ as Standaard.

**Profiles** (`presets.js:PROFILES`, $W_t$; Woningmarkt 0 everywhere):

| Profile | Veiligh. | Voorz. | Welvaart | Opleid. | Levenstype | Sfeer |
|---|---|---|---|---|---|---|
| student | 10 | 30 | 0 | 0 | 20 | 40 druk |
| starter | 20 | 30 | 10 | 5 | 15 | 20 druk |
| stel | 25 | 25 | 10 | 5 | 15 | 20 druk |
| gezin | 35 | 35 | 10 | 0 | 15 | 5 rustig |
| nieuwkomer | 30 | 50 | 5 | 0 | 5 | 10 (no metrics until answered) |
| 50plus | 30 | 30 | 15 | 5 | 10 | 10 rustig |
| senior | 35 | 40 | 5 | 0 | 10 | 10 rustig |
| soloMensen | 20 | 25 | 10 | 5 | 10 | 30 druk |
| soloRust | 30 | 25 | 15 | 5 | 5 | 20 rustig |

`SFEER_METRICS`: druk = density↑ (2), horeca1km↑ (2), distCentrum↓, distPodium↓;
rustig = density↓ (2), distCentrum↑, waterPct↑. A levenstype has no Milieu.

**Jouw vs Standaard** (`presets.js:recordStandaard`,
`dashboard-personal.js:standardScores`, `scoreShift`, `jwShift`).
Same $A$ and $\pi$, preset Standaard: $S^{\text{std}}_a$. Nederland dashboard,
gemeente $G$ with wijken $a \in G$ (**population-weighted mean**):

$$
\bar S_G = \frac{\sum_{a \in G} N_a S_a}{\sum_{a \in G} N_a},\qquad
\Delta_G = \bar S^{\text{jouw}}_G - \bar S^{\text{std}}_G
$$

City: $\Delta_a = S^{\text{jouw}}_a - S^{\text{std}}_a$ per wijk. Panel: top 5
with $\Delta > 0$ and top 5 with $\Delta < 0$. Theme shares:
$W_t / \sum_{t'} W_{t'}$ over themes with metrics (`themeShares`).

**Bekende zwaktes.**
- All of §1.
- Additive weights dilute: each extra answer lowers every other theme's share.
- Sfeer quantiles are per peer set: "rustig" differs between city and NL.
- NL dashboard compares means of wijk scores, not gemeente scores.

### 2a. Zelf samenstellen (building blocks, v0.57.0)

Levenstype `custom` ("Zelf samenstellen") starts from Standaard and adds the
chosen building blocks (`presets.js BUILDING_BLOCKS`), each cut from a profile
above. A block gives per theme t an extra weight θ_b(t) and metric tuples with
shares s_b,m:

| Block | Hash | Theme + weight: metrics (share) | From |
|---|---|---|---|
| Kinderen | k | Voorzieningen +20: distSchool 3, eduNearScore 3, distKinderopvang 3; Leeftijd +10: hhWithKidsPct | gezin |
| Levendig | l | Sfeer +20: SFEER_METRICS.druk | soloMensen |
| Rustig | r | Sfeer +20: SFEER_METRICS.rustig; Milieu +5: noiseNeighbourPct (optional) | soloRust |
| Groen & natuur | g | Voorzieningen +15: distGroen 2, distOpenNatuur 1 | soloRust |
| Ouder worden | o | Voorzieningen +20: distGP 3, distSupermarket 2, distOv 2 | senior |
| Veilig | v | Veiligheid +15: VEILIG_STD | standaard |
| Bereikbaar | b | Voorzieningen +15: distStation 2, distOv 2 | starter |

Per metric (`customProfile`):

    W(m) = θ_std(t)·s_std,m / Σ s_std  +  Σ_b θ_b(t)·s_b,m / Σ_m' s_b,m'
    θ(t) = θ_std(t) + Σ_b θ_b(t)

W(m) (rounded to 4 decimals) becomes the metric's share in the profile tuple, so
`resolvePreset` gives every metric with data exactly W(m)/ΣW. No block = Standaard.
A metric in two parts adds up; it stays optional only if optional in every part.
Levendig and Rustig exclude each other (switching one on switches the other off;
a hash with both drops both). Hash: `lc` + block letters (`lckg`); old `l<letter>`
links are unchanged. The importance sliders take θ(t) as their Gemiddeld base.

**Waar vastgelegd.** plan-woonscore §3–5, plan-levenstype-gewichten,
plan-wizard-v2; decisions W3, W4, v0.23.0, W22, v0.45.0, v0.46.0, v0.54.0.

---

## 3. Mijn stapel

Context: the user's own 2–6 layer map, not the Woonscore
(`stapel.js:stackValues`).

Items $j = 1..J$, $2 \le J \le 6$, direction $d_j \in \{h, l\}$, weight
$v_j \in \{1,2,3\}$; $A$ = the list shown (city wijken, city buurten, NL per
level; all areas, no woongebied filter). Raw value in the crime mode
(Per 1000 / Absoluut). **Weighted arithmetic mean of percentile scores with a
coverage threshold**:

$$
s_{a,j} = \begin{cases} 100\,p_{a,j} & d_j = h\\ 100\,(1 - p_{a,j}) & d_j = l \end{cases},\qquad
V_a = \sum_{j : s_{a,j} \ne \bot} v_j
$$

$$
\mathrm{Stapel}_a =
\begin{cases}
\dfrac{\sum_{j} v_j s_{a,j}}{V_a} & V_a > 0 \land V_a \ge \left\lceil \tfrac12 \sum_j v_j \right\rceil\\
\bot & \text{otherwise}
\end{cases}
$$

Default $d_j$: from `higherIsBetter`, wozValue = $l$, neutral layers need a
choice (`defaultDirection`). Old ids via `resolveLayerKey` (§6).

**Bekende zwaktes.**
- Rank-based, also for crime (the §1 robust z is not used here); no shrinkage.
- Non-residential areas are in the percentile set.
- A stack with the Woonscore ranks a rank.

**Waar vastgelegd.** plan-laagstapel; decisions v0.50.0.

---

## 4. Kaartkleuren and Ranglijst

### 4a. Colour classes (`scale.js:buildScale`)

Context: one scale for every choropleth, legend and bar.
$X = $ sorted values $x_{(1)} \le \dots \le x_{(n)}$, $D$ = number of distinct values,
$K = 7$ (`CLASS_COUNT`). Quantile $Q(p)$: **type 7**, $h = (n-1)p$,
$Q = x_{(\lfloor h\rfloor+1)} + (h - \lfloor h \rfloor)(x_{(\lfloor h\rfloor+2)} - x_{(\lfloor h\rfloor+1)})$.

**Kwantiel** (default, **quantile classification / equal-count classes**,
`quantileClasses`):

$$
\text{breaks} =
\begin{cases}
\text{distinct values } u_2 < \dots < u_D & D \le K\\
\{Q(i/K) : i = 1..K-1,\ Q(i/K) > x_{(1)},\ \text{strictly increasing}\} & D > K
\end{cases}
$$

$\mathrm{class}(x) = |\{\beta \in \text{breaks} : x \ge \beta\}|$; empty classes
are removed and breaks reset to each class minimum. Colour of class $i$ of
$m$: ramp index $\mathrm{round}(i(K-1)/(m-1))$, $m = 1$ → middle
(`classColor`).

**Lineair** (**linear min–max scaling**):
$t = (\mathrm{clip}(x, x_{(1)}, x_{(n)}) - x_{(1)})/(x_{(n)} - x_{(1)})$ on a
continuous ramp; $x_{(1)} = x_{(n)}$ → middle colour.

**Outliers** (`fences`, **Tukey fences, raw and log1p, union of the wider
fence**):

$$
L = \min\!\big(Q_1 - 1.5\,\mathrm{IQR},\ \mathrm{expm1}(Q_1^{\log} - 1.5\,\mathrm{IQR}^{\log})\big),\quad
H = \max\!\big(Q_3 + 1.5\,\mathrm{IQR},\ \mathrm{expm1}(Q_3^{\log} + 1.5\,\mathrm{IQR}^{\log})\big)
$$

log terms only if $x_{(1)} \ge 0$. No outliers if $\mathrm{IQR} = 0$, $D \le 7$,
or kind = origin (herkomst). Outlier = $x < L \lor x > H$; it is labelled,
its fill stays the class colour.

**Bekende zwaktes.**
- Equal-count classes hide magnitude; the Woonscore (a rank) is ranked again.
- Breaks depend on the areas shown.

**Waar vastgelegd.** decisions "Robust colour scale" (quantile, Tukey + log1p).

### 4b. Ranglijst (`ranking.js`)

Context: rank every area on one key. $\mathcal D^*$ = datasets with
`higherIsBetter` ∈ {true, false} and `inOverall !== false`.

$$
\sigma_{a,m} = \begin{cases}100\,p_{a,m} & \text{higher is better}\\ 100(1-p_{a,m}) & \text{lower}\end{cases},\qquad
\mathrm{Totaal}_a = \frac{1}{|U_a|}\sum_{m \in U_a}\sigma_{a,m},\ \ U_a = \{m \in \mathcal D^* : \sigma_{a,m} \ne \bot\}
$$

(**unweighted arithmetic mean of percentile scores**, `scoreAreas`).
Rank value $r_a$ (`rankValue`): Totaal; $\sigma$ for a directional dataset;
the raw value for a neutral dataset, the Woonscore and Mijn stapel.
**Competition ranking** (`rankRows`, `applyRankMode`):

$$
\mathrm{rank}_a = 1 + |\{c : r_c > r_a\}|,\qquad r_a = \bot \Rightarrow \mathrm{rank}_a = \bot \text{ (last, by name)}
$$

Sort (`sortRows`): stable, $\bot$ last in both directions. Rank mode Vast
keeps the ranks; Volgt sortering recomputes them on the sort column.
Non-residential areas are not ranked (`list.js`).

**Bekende zwaktes.**
- Totaal weighs every dataset equally: ten crime categories outweigh one income.

**Waar vastgelegd.** decisions "Score = percentile rank 0–100 within the shown
list", W20.

---

## 5. Area detail: rank and "Opvallend" (`area-detail.js`)

Context: rank one area among residential areas of its level, in words.
$P$ = peer values, plus $x_a$ if absent; $n = |P|$.

$$
\mathrm{fromHigh} = 1 + |\{y \in P : y > x_a\}|,\quad
\mathrm{fromLow} = 1 + |\{y \in P : y < x_a\}|,\quad
\mathrm{pct} = 100\,p_a \ (n = 1 \Rightarrow 50)
$$

Side (`rankPhrase`):
$\mathrm{side} = \text{high}$ if fromHigh < fromLow, low if >, on equality the
good end (judged) or high (neutral); $r^{*}$ = rank from that side.

**Opvallend** (`isExtreme`, **top/bottom-decile rule**):

$$
\mathrm{extreme} = \mathbb{1}[n \ge 5]\cdot \mathbb{1}\!\left[r^* \le \max(1, \lceil 0.1\,n \rceil)\right]
$$

Only for residential areas; `originDutchPct` skipped. Median difference
(`formatDiff`): pp for %, else $\mathrm{round}(100(x - \tilde x)/|\tilde x|)$ %
($\tilde x = 0$: absolute). Outlier side from §4a over $P$.

| Parameter | Value |
|---|---|
| `EXTREME_SHARE` | 0.1 |
| `MIN_PEERS_FOR_EXTREME` | 5 |

**Bekende zwaktes.**
- 10 % of 21 wijken is 3 places per end; of ~14.000 NL buurten 1.400.
- Herkomst can be "Opvallend" (neutral colour).

**Waar vastgelegd.** decisions "Area detail modal".

---

## 6. Derived metrics

**Diversiteit** (`datasets.js:diversityFrom`):
$\mathrm{div}_a = \mathrm{r}_1(100 - \mathrm{NL}_a)$, $\bot$ if $\mathrm{NL}_a = \bot$.

**Stilte-index** (`milieu.js:combinedHinder`, **probability of the union of
independent events**), sources $s \in$ {wegverkeer, trein, vliegverkeer,
windturbines, buren}, $h_s$ = % ernstig gehinderd:

$$
\mathrm{noiseAny}_a = \mathrm{r}_1\!\Big(100\Big[1 - \prod_s \big(1 - \min(100, h_s)/100\big)\Big]\Big),\quad \bot \text{ if any } h_s = \bot
$$

**PFAS distance** (`milieu.js:nearestKm`, **nearest neighbour, haversine
great-circle distance**), $c_a$ = buurt centre from
`data/nl/buurt-centres-2025.json`, $\Phi$ = presumptive sources:

$$
\mathrm{pfas}_a = \min_{\phi \in \Phi} d_{\mathrm{hav}}(c_a, \phi)\ \text{km}
$$

**Aggregation buurt → wijk/gemeente/provincie** (milieu, build;
`milieu.js:weightedMeans`, **population-weighted mean**), $B$ = buurten of the
parent with $N_b > 0$ and $x_b \ne \bot$:
$\bar x = \mathrm{r}_1\big(\sum_B N_b x_b / \sum_B N_b\big)$, $\bot$ if $B = \emptyset$.

**Buurt 2024 → 2025** (`milieu.js:mapBuurten`, `largestOverlap`,
**area overlap estimated by point sampling**):

$$
\mu(b_{25}) =
\begin{cases}
b_{25} & b_{25} \in \mathcal B_{24}\\
\arg\max_{b \in \mathcal B_{24}} |\{\text{sample points of } b_{25} \text{ inside } b\}| & \text{otherwise (ties: lowest code)}\\
\bot & \text{no hit}
\end{cases}
$$

**Herkomst per land via postcode** (`scripts/build-pc4-herkomst.mjs`,
`herkomst-pc4.js:sharesOf`; **areal interpolation by address weights /
dasymetric allocation**). CBS 83503NED count $y_{P,g}$ per PC4 $P$ and group
$g$ (1 jan 2023), $\alpha_{P,b}$ = addresses of $P$ in buurt $b$ (CBS
pc6huisnr 2023):

$$
\hat y_{b,g} = \sum_P y_{P,g}\,\frac{\alpha_{P,b}}{\sum_{b'}\alpha_{P,b'}},\qquad
\hat y_{W,g} = \sum_{b \in W}\hat y_{b,g},\qquad
\mathrm{share}_{b,g} = \begin{cases} \min\!\big(100,\ \mathrm{r}_1(100\,\hat y_{b,g}/\hat y_{b,\text{tot}})\big) & \hat y_{b,\text{tot}} \ge 50\\ \bot & \text{otherwise}\end{cases}
$$

Europa buiten de EU $= y_{\text{Europa}} - y_{\text{EU}} - y_{\text{Turkije}}$. Only codes that exist in
the 2025 indeling. Gemeenten (NL scope) use CBS 85458NED directly
(`herkomst-gemeente.js:withDetailShares`).

**Rate per 1.000** (`areas.js:per1000`, `crimeRatePer1000`):
$\rho_a = \mathrm{r}_1(1000\,y_a/N_a)$, $\bot$ if $N_a < N_{\min}$;
$N_{\min}$ = 200 (`PER1000_MIN_POPULATION`, buurt crime), 1.000 (wijk crime,
`CRIME_MIN_POPULATION`).

**Crime in de omgeving** (`omgeving.js:addOmgeving`, **pooled density**),
$\mathcal N(a)$ = neighbours (shared border) incl. $a$, with crimes $y$ and
land area $L > 0$:
$\mathrm{nearby}_a = \mathrm{r}_1\big(\sum_{\mathcal N(a)} y / \sum_{\mathcal N(a)} L\big)$ per km²;
$\bot$ without own land area or adjacency.

**Retired layer ids** (`datasets.js:RETIRED_LAYERS`, `resolveLayerKey`; used
by `stapel.js:parseStack`, `share-link.js`, `list.js`): a lookup map
originDutchPct, bornAbroadPct → diversityPct; originEuropePct →
hr_westEuropa; nonWesternPct → hr_zuidAmerika; any other key unchanged.

**Bekende zwaktes.**
- Stilte-index assumes independent sources.
- PFAS distance from one centre point, not from where people live.
- Postcode estimate assumes an even mix over a postcode's addresses; 2023 data on the 2025 indeling.
- nonWesternPct → one region (Zuid-Amerika) is an arbitrary landing.

**Waar vastgelegd.** decisions Milieu phase 1/2, v0.25.0, W8, W9, v0.53.0.

---

## 7. Dashboard panels

Context: city/national figures and short lists (`dashboard-data.js`,
`dashboard-panels.js`). For a set $A$ (`aggregateAreas`):

$$
\text{SUM: } X = \sum_{a} x_a \quad (\text{population, totalCrimes, crime counts, housingStock, nonResidentialStock})
$$

$$
\text{WEIGHTED: } \bar x = \frac{\sum_{a:\,x_a \ne \bot,\ \nu_a > 0} \nu_a x_a}{\sum \nu_a},\quad
\nu = \begin{cases} N & \text{per-person keys (POP\_KEYS, PERSONAL\_KEYS, incl. woonscore)}\\ \text{housingStock} & \text{dwelling keys (fallback } N)\end{cases}
$$

Crime rates from the sums: $\rho = 1000\,\sum y / \sum N$. Trend from the
summed totals: $\mathrm{prev} = \sum_a t_a/(1 + \delta_a/100)$,
$\delta = 100(\sum t - \mathrm{prev})/\mathrm{prev}$ (areas with
$\delta_a \le -100$ skipped).

City figure (`cityValue`): SUM if key = population or (Absoluut and a crime
dataset), else WEIGHTED by $N$.

**lowestCrime** (**bottom-$k$ selection**, $k = 5$, ties by name; `rankBy`
over `listEligible` = residential, value present, $N_a \ge N_{\min}$):
Nederland → gemeenten, $N_{\min} = 0$; city → buurten with
$N_{\min}$ = `LIST_MIN_POPULATION` = 1.000; no such buurten → the units with
the context minimum.

**Bekende zwaktes.**
- $N_{\min}$ = 1.000 for buurten skips most buurten.
- Visitor bias of per-inwoner crime rates (§1).

**Waar vastgelegd.** plan-dashboard; decisions W19, W23.
