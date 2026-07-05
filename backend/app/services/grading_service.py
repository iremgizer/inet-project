"""Server-side grading service.

Runs simulation on the submitted network, then compares results to the
assignment's expected solution. Supports all challenge types used in the
demo classroom. Client-side grading (challengeGrading.ts) remains the
fallback when this endpoint is unreachable.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from app.models import AlgorithmConfig, NetworkInput, SimulationRequest
from app.services.simulation_service import SimulationService

_simulation_svc = SimulationService()


# ── Public entry point ────────────────────────────────────────────────────────

def grade_attempt(
    submitted_network: NetworkInput,
    algorithm_config: AlgorithmConfig,
    submitted_answers: Dict[str, Any],
    assignment: Dict[str, Any],
    hints_used: int = 0,
) -> Dict[str, Any]:
    """Grade a challenge attempt or exercise submission server-side.

    1. Runs simulation on *submitted_network*.
    2. Grades the result against *assignment.expectedSolution* /
       *assignment.challengeConfig* using the same rules as the frontend.
    3. Returns a dict compatible with ChallengeGradingResult on the frontend.
    """
    # ── Run simulation ────────────────────────────────────────────────────────
    try:
        sim_result = _simulation_svc.simulate(
            SimulationRequest(network=submitted_network, algorithmConfig=algorithm_config)
        )
    except Exception as exc:
        return _error_result(str(exc))

    challenge_config: Optional[Dict[str, Any]] = assignment.get("challengeConfig")
    grading_rules: Dict[str, Any] = assignment.get("gradingRules") or {}
    max_score: int = int(grading_rules.get("maxScore", 100))

    # ── Challenge mode ────────────────────────────────────────────────────────
    if challenge_config:
        challenge_type: str = challenge_config.get("challengeType", "")
        target: Dict[str, Any] = challenge_config.get("target") or {}
        hints: List[Dict[str, Any]] = challenge_config.get("hints") or []

        result = _grade_challenge_type(
            challenge_type, submitted_answers, sim_result, target, max_score
        )

        # Apply hint penalty (same formula as frontend)
        penalty_pct = sum(
            h.get("revealCostPenalty", 0) for h in hints[:hints_used]
        )
        final_score = max(0, result["score"] - round(max_score * penalty_pct / 100))
        result["score"] = final_score
        result["percentage"] = round(final_score / max_score * 100) if max_score else 0
        result["hintsUsed"] = hints_used

    # ── Exercise mode ─────────────────────────────────────────────────────────
    else:
        task = assignment.get("studentTask") or {}
        expected = assignment.get("expectedSolution") or {}
        result = _grade_exercise(
            task.get("taskType", ""),
            submitted_answers,
            sim_result,
            expected,
            max_score,
            grading_rules,
        )

    result.setdefault("simulationRunId", getattr(sim_result, "simulationRunId", None))
    result["gradingMode"] = "server"
    return result


# ── Challenge-type dispatcher ─────────────────────────────────────────────────

def _grade_challenge_type(
    challenge_type: str,
    answers: Dict[str, Any],
    sim,
    target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    dispatch = {
        "IDENTIFY_CONGESTED_LINKS": _grade_identify_congested,
        "REDUCE_CONGESTION": _grade_reduce_congestion,
        "FIND_ECMP_WEIGHTS": _grade_reduce_congestion,
        "COMPUTE_DV_TABLE": _grade_dv_table,
        "COMPUTE_ECMP_SPLIT": _grade_ecmp_split,
        "PREDICT_SHORTEST_PATH": _grade_predict_shortest_path,
    }
    fn = dispatch.get(challenge_type)
    if fn is None:
        return _not_implemented(challenge_type, max_score)
    return fn(answers, sim, target, max_score)


# ── IDENTIFY_CONGESTED_LINKS ──────────────────────────────────────────────────

def _grade_identify_congested(
    answers: Dict[str, Any],
    sim,
    _target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    actual_congested: Set[str] = {
        lr.linkId for lr in sim.linkResults if lr.isCongested
    }

    raw = answers.get("congestedLinks", [])
    if isinstance(raw, list):
        submitted: Set[str] = set(raw)
    elif isinstance(raw, str):
        submitted = {s.strip() for s in raw.split(",") if s.strip()}
    else:
        submitted = set()

    correct = submitted & actual_congested
    wrong = submitted - actual_congested
    missed = actual_congested - submitted
    is_correct = not wrong and not missed and bool(submitted)

    feedback: List[Dict[str, Any]] = []
    lr_map = {lr.linkId: lr for lr in sim.linkResults}

    if actual_congested and not submitted:
        feedback.append(_fb("info", "No answer submitted",
                            "Enter the congested link IDs and try again."))

    if correct:
        feedback.append(_fb(
            "success",
            f"{'All congested links identified correctly' if is_correct else f'{len(correct)} correct link(s) identified'}",
            f"Correctly selected: {', '.join(sorted(correct))}",
            link_ids=sorted(correct),
        ))

    for lid in sorted(wrong):
        lr = lr_map.get(lid)
        pct = round(lr.utilization * 100, 1) if lr else "?"
        feedback.append(_fb(
            "error", f"Link {lid} is not congested",
            f"Utilization is {pct}%, which is within capacity.",
            link_ids=[lid],
        ))

    for lid in sorted(missed):
        lr = lr_map.get(lid)
        pct = round(lr.utilization * 100, 1) if lr else "?"
        feedback.append(_fb(
            "error", f"Missed congested link: {lid}",
            f"Link {lid} has utilization {pct}% — it exceeds capacity.",
            link_ids=[lid],
        ))

    partial = (
        round(max_score * len(correct) / max(len(actual_congested), 1))
        if actual_congested else 0
    )
    score = (
        max_score if is_correct
        else (max(0, partial - len(wrong) * 10) if wrong else partial)
    )

    return {
        "isCorrect": is_correct,
        "score": score, "maxScore": max_score,
        "percentage": round(score / max_score * 100) if max_score else 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": feedback,
        "summary": (
            f"Correct! All {len(actual_congested)} congested link(s) identified."
            if is_correct else
            f"You identified {len(correct)} of {len(actual_congested)} congested link(s)."
            + (f" {len(wrong)} incorrect." if wrong else "")
            + (f" {len(missed)} missed." if missed else "")
        ),
        "nextSuggestion": (
            "Well done! Try a harder challenge." if is_correct
            else "Check each link's utilization — look for values over 100%."
        ),
        "highlightedLinks": (
            [{"linkId": lid, "status": "correct"} for lid in sorted(correct)] +
            [{"linkId": lid, "status": "wrong"} for lid in sorted(wrong)] +
            [{"linkId": lid, "status": "missed"} for lid in sorted(missed)]
        ),
        "highlightedNodes": [],
        "expected": sorted(actual_congested),
        "received": sorted(submitted),
    }


# ── REDUCE_CONGESTION / FIND_ECMP_WEIGHTS ─────────────────────────────────────

def _grade_reduce_congestion(
    answers: Dict[str, Any],
    sim,
    target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    max_util_target: float = float(target.get("maxUtilizationTarget", 1.0))
    actual_max_util: float = sim.maxUtilization or 0.0
    congested_count: int = sim.congestedLinkCount or 0

    is_correct = actual_max_util <= max_util_target + 1e-6
    feedback: List[Dict[str, Any]] = []

    congested_link_ids = [lr.linkId for lr in sim.linkResults if lr.isCongested]
    if is_correct:
        feedback.append(_fb(
            "success",
            "All links within capacity",
            f"Max utilization: {actual_max_util * 100:.1f}% ≤ target {max_util_target * 100:.1f}%.",
        ))
    else:
        feedback.append(_fb(
            "error",
            f"{congested_count} link(s) still congested",
            f"Max utilization is {actual_max_util * 100:.1f}%, target is {max_util_target * 100:.1f}%.",
            link_ids=congested_link_ids,
        ))
        feedback.append(_fb(
            "info",
            "Tip",
            "Reduce traffic load by increasing link capacity or adjusting weights to distribute traffic more evenly.",
        ))

    score = max_score if is_correct else 0

    return {
        "isCorrect": is_correct,
        "score": score, "maxScore": max_score,
        "percentage": round(score / max_score * 100) if max_score else 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": feedback,
        "summary": (
            f"Correct! Max utilization {actual_max_util * 100:.1f}% is within the {max_util_target * 100:.1f}% target."
            if is_correct else
            f"Max utilization {actual_max_util * 100:.1f}% still exceeds the {max_util_target * 100:.1f}% target."
        ),
        "nextSuggestion": (
            "Excellent! Try it with a more constrained topology." if is_correct
            else "Adjust link weights to spread traffic more evenly across paths."
        ),
        "highlightedLinks": (
            [] if is_correct
            else [{"linkId": lid, "status": "wrong"} for lid in congested_link_ids]
        ),
        "highlightedNodes": [],
    }


# ── COMPUTE_DV_TABLE ──────────────────────────────────────────────────────────

def _grade_dv_table(
    answers: Dict[str, Any],
    sim,
    target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    dv_table = sim.distanceVectorTable or []
    if not dv_table:
        return {
            "isCorrect": False, "score": 0, "maxScore": max_score, "percentage": 0,
            "attemptNumber": 1, "hintsUsed": 0,
            "feedbackItems": [_fb("info", "No DV table",
                                  "Run the simulation with Distance Vector algorithm first.")],
            "summary": "Run Distance Vector first.",
            "nextSuggestion": "Select Distance Vector and run the simulation.",
            "highlightedLinks": [], "highlightedNodes": [],
        }

    expected_entries = target.get("expectedDVEntries") or []
    tol = 0.01
    feedback: List[Dict[str, Any]] = []
    total_points = 0.0
    points_per_entry = max_score / max(len(expected_entries), 1)

    simple_cost = answers.get("pathCost")
    simple_next_hop = str(answers.get("nextHop", "")).strip().lower()

    dv_map = {(e.nodeId, e.destinationId): e for e in dv_table}

    for exp in expected_entries:
        key = (exp.get("nodeId"), exp.get("destinationId"))
        actual = dv_map.get(key)
        if not actual:
            feedback.append(_fb("warning",
                                f"No DV entry for {key[0]} → {key[1]}",
                                "Source/destination pair not found in DV table.",
                                node_ids=list(filter(None, key))))
            continue

        submitted_cost = float(simple_cost) if simple_cost is not None else float("nan")
        cost_ok = (
            simple_cost is not None
            and abs(submitted_cost - actual.cost) <= tol
        )
        actual_next_hop = actual.nextHop or ""
        next_hop_ok = bool(simple_next_hop) and (
            simple_next_hop == actual_next_hop.lower()
        )

        if cost_ok:
            total_points += points_per_entry * 0.5
            feedback.append(_fb("success",
                                f"Cost {key[0]} → {key[1]}: correct",
                                f"Your answer: {submitted_cost}. Correct cost: {actual.cost}."))
        elif simple_cost is not None:
            feedback.append(_fb("error",
                                f"Cost {key[0]} → {key[1]}: incorrect",
                                f"Your answer: {submitted_cost}. Correct cost: {actual.cost}."))

        if next_hop_ok:
            total_points += points_per_entry * 0.5
            feedback.append(_fb("success",
                                f"Next hop {key[0]} → {key[1]}: correct",
                                f"Next hop: {actual_next_hop}."))
        elif simple_next_hop:
            feedback.append(_fb("error",
                                f"Next hop {key[0]} → {key[1]}: incorrect",
                                f"Your answer: \"{simple_next_hop}\". Correct: {actual_next_hop}."))

    score = round(total_points)
    is_correct = score >= max_score - round(max_score * 0.01)

    return {
        "isCorrect": is_correct,
        "score": score, "maxScore": max_score,
        "percentage": round(score / max_score * 100) if max_score else 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": feedback,
        "summary": (
            "Correct! Your DV table entries are accurate."
            if is_correct else
            f"Score: {score}/{max_score}. Check the feedback for details."
        ),
        "nextSuggestion": (
            "You understand Distance Vector routing! Try a harder challenge."
            if is_correct else
            "Run Distance Vector and read the routing table in the right panel."
        ),
        "highlightedLinks": [], "highlightedNodes": [],
    }


# ── COMPUTE_ECMP_SPLIT ────────────────────────────────────────────────────────

def _grade_ecmp_split(
    answers: Dict[str, Any],
    sim,
    target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    submitted_split = answers.get("trafficSplit")
    if submitted_split is None:
        return _simple_wrong(max_score, "No traffic split submitted.",
                             "Enter the ECMP traffic split percentages.")

    expected_split: Dict[str, float] = target.get("trafficSplits") or {}
    tol = 0.05  # 5% tolerance for split values
    feedback: List[Dict[str, Any]] = []
    correct_count = 0

    if isinstance(submitted_split, dict):
        for path_key, expected_pct in expected_split.items():
            submitted_pct = float(submitted_split.get(path_key, -1))
            if abs(submitted_pct - expected_pct) <= tol:
                correct_count += 1
                feedback.append(_fb("success", f"Split for {path_key}: correct",
                                    f"{submitted_pct:.1%} matches expected {expected_pct:.1%}."))
            else:
                feedback.append(_fb("error", f"Split for {path_key}: incorrect",
                                    f"Your answer: {submitted_pct:.1%}. Expected: {expected_pct:.1%}."))

    total = len(expected_split) or 1
    score = round(max_score * correct_count / total)
    is_correct = score >= max_score

    return {
        "isCorrect": is_correct,
        "score": score, "maxScore": max_score,
        "percentage": round(score / max_score * 100) if max_score else 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": feedback,
        "summary": f"Score: {score}/{max_score}.",
        "nextSuggestion": "" if is_correct else "ECMP splits demand equally across equal-cost paths.",
        "highlightedLinks": [], "highlightedNodes": [],
    }


# ── PREDICT_SHORTEST_PATH ─────────────────────────────────────────────────────

def _grade_predict_shortest_path(
    answers: Dict[str, Any],
    sim,
    target: Dict[str, Any],
    max_score: int,
) -> Dict[str, Any]:
    expected_path: List[str] = target.get("expectedPath") or []
    submitted_raw = answers.get("shortestPath", "")
    if isinstance(submitted_raw, list):
        submitted_path = submitted_raw
    else:
        submitted_path = [s.strip() for s in str(submitted_raw).split("→") if s.strip()]
        if not submitted_path:
            submitted_path = [s.strip() for s in str(submitted_raw).split(",") if s.strip()]

    is_correct = submitted_path == expected_path
    score = max_score if is_correct else 0
    feedback: List[Dict[str, Any]] = []

    if is_correct:
        feedback.append(_fb("success", "Correct shortest path!",
                            f"Path: {' → '.join(submitted_path)}"))
    else:
        feedback.append(_fb("error", "Incorrect path",
                            f"Your answer: {' → '.join(submitted_path)}. "
                            f"Expected: {' → '.join(expected_path)}."))

    return {
        "isCorrect": is_correct,
        "score": score, "maxScore": max_score,
        "percentage": round(score / max_score * 100) if max_score else 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": feedback,
        "summary": "Correct!" if is_correct else "Incorrect path.",
        "nextSuggestion": "" if is_correct else "Trace the path with lowest total weight.",
        "highlightedLinks": [], "highlightedNodes": [],
    }


# ── Exercise grading ──────────────────────────────────────────────────────────

def _grade_exercise(
    task_type: str,
    answers: Dict[str, Any],
    sim,
    expected: Dict[str, Any],
    max_score: int,
    grading_rules: Dict[str, Any],
) -> Dict[str, Any]:
    tol = float(grading_rules.get("tolerance", 0.01))

    if task_type == "IDENTIFY_CONGESTED_LINKS":
        return _grade_identify_congested(answers, sim, {}, max_score)

    if task_type == "REDUCE_MAX_UTILIZATION":
        target_util = float(expected.get("maxUtilizationTarget", 1.0))
        return _grade_reduce_congestion(answers, sim, {"maxUtilizationTarget": target_util}, max_score)

    if task_type == "COMPUTE_DV_TABLE":
        entries = expected.get("distanceVectorEntries") or []
        return _grade_dv_table(answers, sim, {"expectedDVEntries": entries}, max_score)

    # Fallback for unimplemented types
    return {
        "isCorrect": False, "score": 0, "maxScore": max_score, "percentage": 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": [_fb("info", "Auto-grading not available",
                              f"Task type '{task_type}' requires manual review.")],
        "summary": "Manual review required.",
        "nextSuggestion": "",
        "highlightedLinks": [], "highlightedNodes": [],
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fb(
    kind: str,
    title: str,
    message: str,
    link_ids: Optional[List[str]] = None,
    node_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    return {
        "type": kind,
        "title": title,
        "message": message,
        "relatedLinkIds": link_ids or [],
        "relatedNodeIds": node_ids or [],
        "relatedDemandIds": [],
    }


def _error_result(msg: str) -> Dict[str, Any]:
    return {
        "isCorrect": False, "score": 0, "maxScore": 100, "percentage": 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": [_fb("error", "Simulation failed", msg)],
        "summary": f"Simulation error: {msg}",
        "nextSuggestion": "Check your network topology and demands.",
        "highlightedLinks": [], "highlightedNodes": [],
        "gradingMode": "server",
    }


def _simple_wrong(max_score: int, summary: str, suggestion: str) -> Dict[str, Any]:
    return {
        "isCorrect": False, "score": 0, "maxScore": max_score, "percentage": 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": [_fb("info", "No answer submitted", summary)],
        "summary": summary,
        "nextSuggestion": suggestion,
        "highlightedLinks": [], "highlightedNodes": [],
    }


def _not_implemented(challenge_type: str, max_score: int) -> Dict[str, Any]:
    return {
        "isCorrect": False, "score": 0, "maxScore": max_score, "percentage": 0,
        "attemptNumber": 1, "hintsUsed": 0,
        "feedbackItems": [_fb("info", "Not supported",
                              f"Backend grading for '{challenge_type}' not yet implemented.")],
        "summary": "Unsupported challenge type.",
        "nextSuggestion": "",
        "highlightedLinks": [], "highlightedNodes": [],
    }
