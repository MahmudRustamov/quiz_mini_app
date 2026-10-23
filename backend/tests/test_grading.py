import math
import pytest
from app.services.grading import grade_answer,normalize,convert_essay,validate_lookup,certificate_grade,standardize


def test_deterministic_grading_and_uzbek_spelling():
    assert grade_answer('A',['A'])==(1.,'correct')
    assert grade_answer('B',['A'])==(0.,'incorrect')
    assert grade_answer('', ['A'])==(0.,'unanswered')
    assert grade_answer("  O'QUVCHI ",['o‘quvchi'])==(1.,'correct')
    assert grade_answer('oquvchi',['o‘quvchi'])==(0.,'incorrect')
    assert grade_answer('g‘alati',['aniq'],manual_review=True)==(None,'pending')
    assert grade_answer('A',['A'],weight=2)==(2.,'correct')
    assert grade_answer('a',['A'],case_sensitive=True)==(0.,'incorrect')


def test_official_conversion_requires_explicit_table():
    # Deliberately synthetic nonlinear fixture, never an official table.
    table={f'{i/2:.1f}':round((i/48)**2*75,4) for i in range(49)}
    table=validate_lookup(table)
    assert convert_essay(12,table)==18.75
    assert convert_essay(12,table)!=12/24*75
    assert (convert_essay(12,table)+convert_essay(24,table))/2==46.875
    with pytest.raises(ValueError):convert_essay(12,{})
    with pytest.raises(ValueError):convert_essay(12.1,table)
    with pytest.raises(ValueError):validate_lookup({'0.0':0})


@pytest.mark.parametrize('value,grade',[(70,'A+'),(69.999,'A'),(65,'A'),(60,'B+'),(55,'B'),(50,'C+'),(46,'C'),(45.999,'C dan past')])
def test_grade_boundaries(value,grade):assert certificate_grade(value)==grade


def test_standardization():
    assert standardize(2,1,.5)==(2,70)
    for values in [(1,0,0),(1,0,-1),(math.nan,0,1)]:
        with pytest.raises(ValueError):standardize(*values)


def test_configurable_certificate_thresholds():
    table={'A+':80,'A':75,'B+':70,'B':65,'C+':60,'C':55}
    assert certificate_grade(70,table)=='B+'
