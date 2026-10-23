import numpy as np
import pytest
from app.psychometrics.rasch import probability,estimate_ability,calibrate,pcm_probabilities,calibrate_pcm
from app.services.grading import standardize


def test_rasch_probability_and_extreme_patterns():
    assert probability(0,0)==.5
    assert probability(2,0)>probability(1,0)>probability(-1,0)
    b=np.linspace(-2,2,20)
    high,se=estimate_ability(np.ones(20),b);low,_=estimate_ability(np.zeros(20),b)
    assert np.isfinite([high,low,se]).all() and high>0>low
    theta,_=estimate_ability([1,np.nan,0],[-1,0,1])
    assert abs(theta)<1e-8
    with pytest.raises(ValueError):estimate_ability([np.nan,np.nan],[0,1])


def test_rasch_simulation_recovers_parameters_with_missingness():
    rng=np.random.default_rng(42);b=np.linspace(-1.6,1.6,16);theta=rng.normal(.3,1,800)
    x=rng.binomial(1,probability(theta[:,None],b)).astype(float);x[rng.random(x.shape)<.07]=np.nan
    result=calibrate(x)
    assert result['diagnostics']['converged'],result['diagnostics']
    estimated=np.array(result['difficulties'])
    assert abs(estimated.mean())<1e-10
    assert np.corrcoef(b,estimated)[0,1]>.97
    assert np.sqrt(np.mean((b-estimated)**2))<.25
    assert abs(result['diagnostics']['latent_mean']-.3)<.2
    assert result['diagnostics']['requires_external_validation']


def test_small_or_unstable_cohort_never_confers_automatic_validity():
    rng=np.random.default_rng(2);x=rng.binomial(1,.5,(10,8)).astype(float);x[:,0]=1
    result=calibrate(x)
    assert result['diagnostics']['requires_external_validation']
    assert 'extreme_items' in result['diagnostics']['flags']
    assert 'imprecise_items' in result['diagnostics']['flags']
    with pytest.raises(ValueError):calibrate([[np.nan,1],[np.nan,0]])
    with pytest.raises(ValueError):calibrate([[0,2],[1,0]])


def test_partial_credit_probabilities_and_calibration():
    assert np.allclose(pcm_probabilities(0,[0,0]),[1/3]*3)
    assert np.argmax(pcm_probabilities(5,[-1,1]))==2
    rng=np.random.default_rng(3);theta=rng.normal(.2,1,500)
    steps=[[-1.5,-.5],[-.5,.5],[.5,1.5]]
    x=np.array([[rng.choice(3,p=pcm_probabilities(t,s)) for s in steps] for t in theta],float)
    x[0,0]=np.nan
    fit=calibrate_pcm(x,[2,2,2])
    assert fit['diagnostics']['converged'],fit
    estimated=np.array(fit['steps'])
    assert abs(estimated.mean())<1e-10
    assert np.corrcoef(estimated.ravel(),np.array(steps).ravel())[0,1]>.9
    assert fit['diagnostics']['requires_external_validation']
