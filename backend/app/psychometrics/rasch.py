"""Marginal maximum likelihood with Gauss–Hermite integration; EAP person scores.

Latent SD is fixed to one logit (Rasch slope=1). Item mean difficulty is
constrained to zero; latent mean is estimated. Extreme patterns have finite
EAP estimates under the recorded normal population prior, never finite MLEs.
"""
import numpy as np
from numpy.polynomial.hermite import hermgauss
from scipy.optimize import minimize
from scipy.special import expit, logsumexp


def probability(theta, difficulty):
    return expit(np.asarray(theta) - np.asarray(difficulty))


def pcm_probabilities(theta: float, steps):
    steps = np.asarray(steps, dtype=float)
    if steps.ndim != 1 or not len(steps) or not np.all(np.isfinite(steps)) or not np.isfinite(theta):
        raise ValueError('Invalid PCM parameters')
    logits = np.r_[0.0, np.cumsum(theta - steps)]
    return np.exp(logits - logsumexp(logits))


def _data(responses):
    x = np.asarray(responses, dtype=float)
    if x.ndim != 2 or x.shape[0] < 2 or x.shape[1] < 2 or np.isinf(x).any():
        raise ValueError('At least two persons and items required; missing values must be NaN')
    if (np.sum(np.isfinite(x), axis=0) == 0).any() or (np.sum(np.isfinite(x), axis=1) == 0).any():
        raise ValueError('Remove entirely missing persons/items')
    return x


def _quadrature(mean=0.0, sd=1.0, points=41):
    nodes, weights = hermgauss(points)
    return mean + np.sqrt(2) * sd * nodes, np.log(weights) - .5 * np.log(np.pi)


def estimate_ability(responses, difficulties, prior_mean=0.0, prior_sd=1.0):
    x, b = np.asarray(responses, float), np.asarray(difficulties, float)
    mask = np.isfinite(x)
    if not mask.any() or x.shape != b.shape or not np.all(np.isfinite(b)) or prior_sd <= 0:
        raise ValueError('Invalid ability data')
    if not np.isin(x[mask], [0, 1]).all():
        raise ValueError('Binary responses required')
    nodes, logw = _quadrature(prior_mean, prior_sd, 61)
    logits = nodes[:, None] - b[mask]
    ll = (x[mask] * -np.logaddexp(0, -logits) + (1 - x[mask]) * -np.logaddexp(0, logits)).sum(axis=1)
    posterior = np.exp(ll + logw - logsumexp(ll + logw))
    theta = float(posterior @ nodes)
    se = float(np.sqrt(posterior @ (nodes - theta) ** 2))
    return theta, se


def calibrate(responses):
    x = _data(responses)
    mask = np.isfinite(x)
    if not np.isin(x[mask], [0, 1]).all():
        raise ValueError('Rasch requires binary item scores')
    filled = np.nan_to_num(x)
    n, k = x.shape
    nodes0, logw = _quadrature()

    def unpack(params):
        return np.r_[params[:-1], -sum(params[:-1])], params[-1]

    def objective(params):
        b, mu = unpack(params)
        logits = nodes0[:, None] + mu - b
        yes, no = -np.logaddexp(0, -logits), -np.logaddexp(0, logits)
        ll = filled @ yes.T + (mask.astype(float) - filled) @ no.T
        return -float(logsumexp(ll + logw, axis=1).sum())

    result = minimize(objective, np.zeros(k), method='BFGS', options={'gtol': 1e-4, 'maxiter': 600})
    b, mu = unpack(result.x)
    abilities = [estimate_ability(row, b, mu) for row in x]
    p = probability(np.array([v[0] for v in abilities])[:, None], b)
    information = (p * (1 - p) * mask).sum(axis=0)
    se = 1 / np.sqrt(np.maximum(information, 1e-12))
    rates = np.nanmean(x, axis=0)
    residual = np.where(mask, (filled - p) ** 2, 0)
    infit = residual.sum(axis=0) / np.maximum((p * (1 - p) * mask).sum(axis=0), 1e-12)
    flags = []
    if not result.success: flags.append('optimizer_not_converged')
    if np.any((rates == 0) | (rates == 1)): flags.append('extreme_items')
    if np.max(se) > .5: flags.append('imprecise_items')
    if np.max(np.abs(b)) > 5: flags.append('extreme_difficulties')
    if np.any((infit < .5) | (infit > 1.5)): flags.append('item_misfit')
    # No participant-count cutoff confers validity. External review is always required.
    diagnostics = {'converged': bool(result.success), 'iterations': int(result.nit),
        'negative_log_likelihood': float(result.fun), 'persons': n, 'items': k,
        'missing_fraction': float(1 - mask.mean()), 'latent_mean': float(mu), 'latent_sd': 1.0,
        'identification': 'mean item difficulty = 0; normal latent SD = 1',
        'method': 'marginal maximum likelihood, 41-point Gauss-Hermite; EAP abilities',
        'standard_errors': 'conditional item information approximation; excludes calibration uncertainty',
        'infit': infit.tolist(), 'flags': flags, 'requires_external_validation': True}
    return {'difficulties': b.tolist(), 'standard_errors': se.tolist(), 'abilities': abilities, 'diagnostics': diagnostics}


def calibrate_pcm(responses, max_categories):
    """MML PCM for genuine ordered categories. Binary subparts should use calibrate.

    Category counts are provided by the rubric, not inferred from observed maxima.
    Global step mean=0; latent mean estimated, latent SD=1. Diagnostic-only until reviewed.
    """
    x = _data(responses)
    counts = np.asarray(max_categories, int)
    if len(counts) != x.shape[1] or np.any(counts < 1):
        raise ValueError('One positive maximum category per item required')
    for j, c in enumerate(counts):
        observed = x[np.isfinite(x[:, j]), j]
        if np.any((observed < 0) | (observed > c) | (observed != np.floor(observed))):
            raise ValueError('Invalid PCM categories')
    offsets = np.r_[0, np.cumsum(counts)]
    nodes, logw = _quadrature(points=31)
    size = int(sum(counts))

    def unpack(v):
        all_steps = np.r_[v[:-1], -sum(v[:-1])]
        return [all_steps[offsets[j]:offsets[j+1]] for j in range(len(counts))], v[-1]

    def objective(v):
        steps, mu = unpack(v)
        ll = np.zeros((len(x), len(nodes)))
        for j, thresholds in enumerate(steps):
            logits = np.column_stack([np.zeros(len(nodes)), np.cumsum(nodes[:, None] + mu - thresholds, axis=1)])
            logp = logits - logsumexp(logits, axis=1, keepdims=True)
            observed = np.isfinite(x[:, j])
            ll[observed] += logp[:, x[observed, j].astype(int)].T
        return -float(logsumexp(ll + logw, axis=1).sum())

    fit = minimize(objective, np.zeros(size), method='BFGS', options={'maxiter': 600, 'gtol': 1e-4})
    steps, mu = unpack(fit.x)
    return {'steps': [s.tolist() for s in steps], 'latent_mean': float(mu),
        'diagnostics': {'converged': bool(fit.success), 'iterations': int(fit.nit),
        'negative_log_likelihood': float(fit.fun), 'requires_external_validation': True,
        'identification': 'global mean step = 0; latent SD = 1',
        'missing_categories': [j for j, c in enumerate(counts) if len(np.unique(x[np.isfinite(x[:, j]), j])) < c+1]}}
