from tools.model_eval import run_evals


def test_model_eval_scenarios_pass() -> None:
    assert run_evals() == []
