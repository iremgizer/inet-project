import { Assignment } from "../types/assignment";
import {
  ChallengeAttempt, ChallengeGradingResult, ChallengeTarget, FeedbackItem,
} from "../types/challenge";
import { SimulationResult } from "../types/network";

// ── Entry point ───────────────────────────────────────────────────────────────

export function gradeChallenge(
  attempt: ChallengeAttempt,
  assignment: Assignment,
  simulationResult: SimulationResult,
  hintsUsed: number,
): ChallengeGradingResult {
  const config = assignment.challengeConfig;
  if (!config) return notConfigured(assignment.gradingRules.maxScore, attempt.attemptNumber, hintsUsed, simulationResult.simulationRunId);

  const { challengeType, target, hints } = config;
  const maxScore = assignment.gradingRules.maxScore;

  let result: ChallengeGradingResult;
  switch (challengeType) {
    case "IDENTIFY_CONGESTED_LINKS":
      result = gradeIdentifyCongestedLinks(attempt, simulationResult, target, maxScore);
      break;
    case "COMPUTE_DV_TABLE":
      result = gradeDVTable(attempt, simulationResult, target, maxScore, assignment);
      break;
    case "REDUCE_CONGESTION":
    case "FIND_ECMP_WEIGHTS":
      result = gradeReduceCongestion(attempt, simulationResult, target, maxScore);
      break;
    case "COMPUTE_ECMP_SPLIT":
      result = gradeECMPSplit(attempt, simulationResult, target, maxScore);
      break;
    case "PREDICT_SHORTEST_PATH":
      result = gradePredictShortestPath(attempt, simulationResult, target, maxScore);
      break;
    default:
      result = notImplemented(maxScore, challengeType, attempt.attemptNumber, hintsUsed, simulationResult.simulationRunId);
  }

  // Apply hint penalty
  const penalty = hints
    .slice(0, hintsUsed)
    .reduce((sum, h) => sum + h.revealCostPenalty, 0);
  const finalScore = Math.max(0, result.score - Math.round(maxScore * penalty / 100));

  return {
    ...result,
    score: finalScore,
    percentage: Math.round((finalScore / maxScore) * 100),
    hintsUsed,
    attemptNumber: attempt.attemptNumber,
    simulationRunId: simulationResult.simulationRunId,
  };
}

// ── IDENTIFY_CONGESTED_LINKS ──────────────────────────────────────────────────

function gradeIdentifyCongestedLinks(
  attempt: ChallengeAttempt,
  sim: SimulationResult,
  _target: ChallengeTarget,
  maxScore: number,
): ChallengeGradingResult {
  const actualCongested = new Set(
    sim.linkResults.filter((l) => l.isCongested).map((l) => l.linkId),
  );

  const raw = attempt.submittedAnswers.congestedLinks;
  const submitted = new Set(
    Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === "string"
        ? raw.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
  );

  const correct = [...submitted].filter((id) => actualCongested.has(id));
  const wrong = [...submitted].filter((id) => !actualCongested.has(id));
  const missed = [...actualCongested].filter((id) => !submitted.has(id));
  const isCorrect = wrong.length === 0 && missed.length === 0 && submitted.size > 0;

  const feedbackItems: FeedbackItem[] = [];

  if (actualCongested.size === 0 && submitted.size > 0) {
    feedbackItems.push({
      type: "warning",
      title: "No congested links in this simulation",
      message: "The simulation shows no congestion. Did you run the correct algorithm and network?",
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  if (correct.length > 0) {
    feedbackItems.push({
      type: "success",
      title: correct.length === actualCongested.size && wrong.length === 0
        ? "All congested links identified correctly"
        : `${correct.length} correct link${correct.length > 1 ? "s" : ""} identified`,
      message: `Correctly selected: ${correct.join(", ")}`,
      relatedLinkIds: correct, relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  for (const linkId of wrong) {
    const lr = sim.linkResults.find((l) => l.linkId === linkId);
    feedbackItems.push({
      type: "error",
      title: `Link ${linkId} is not congested`,
      message: `Utilization is ${lr ? fmt(lr.utilization * 100) : "?"}%, which is within capacity.`,
      explanation: lr ? `Load = ${lr.load.toFixed(2)}, Capacity = ${lr.capacity}, Utilization = ${lr.load.toFixed(2)} / ${lr.capacity} = ${fmt(lr.utilization * 100)}%` : undefined,
      formula: "Utilization = Link Load / Capacity",
      workedExample: lr
        ? `Link ${linkId}: Load = ${lr.load.toFixed(2)}, Capacity = ${lr.capacity}\nUtilization = ${lr.load.toFixed(2)} / ${lr.capacity} = ${fmt(lr.utilization * 100)}% → NOT congested (< 100%)`
        : undefined,
      relatedLinkIds: [linkId], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  for (const linkId of missed) {
    const lr = sim.linkResults.find((l) => l.linkId === linkId);
    feedbackItems.push({
      type: "error",
      title: `Missed congested link: ${linkId}`,
      message: `Link ${linkId} has utilization ${lr ? fmt(lr.utilization * 100) : "?"}% — it exceeds capacity.`,
      explanation: lr
        ? `Load = ${lr.load.toFixed(2)} > Capacity = ${lr.capacity}. Utilization = ${fmt(lr.utilization * 100)}%`
        : undefined,
      formula: "Utilization = Link Load / Capacity > 100% means congested",
      workedExample: lr
        ? `Link ${linkId}: Load = ${lr.load.toFixed(2)}, Capacity = ${lr.capacity}\nUtilization = ${lr.load.toFixed(2)} / ${lr.capacity} = ${fmt(lr.utilization * 100)}% → CONGESTED (> 100%)`
        : undefined,
      relatedLinkIds: [linkId], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  if (feedbackItems.length === 0 && submitted.size === 0) {
    feedbackItems.push({
      type: "info",
      title: "No answer submitted",
      message: "Enter the congested link IDs and try again.",
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  const partial = actualCongested.size > 0
    ? Math.round(maxScore * (correct.length / actualCongested.size))
    : 0;
  const score = isCorrect ? maxScore : wrong.length > 0 ? Math.max(0, partial - wrong.length * 10) : partial;

  return {
    isCorrect,
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    attemptNumber: attempt.attemptNumber,
    hintsUsed: 0,
    feedbackItems,
    summary: isCorrect
      ? `Correct! All ${actualCongested.size} congested link(s) identified.`
      : `You identified ${correct.length} of ${actualCongested.size} congested link(s). ${wrong.length > 0 ? `${wrong.length} incorrect.` : ""} ${missed.length > 0 ? `${missed.length} missed.` : ""}`.trim(),
    nextSuggestion: isCorrect
      ? "Well done! Try a harder challenge."
      : missed.length > 0
        ? "Check each link's utilization in the results panel — look for values over 100%."
        : "Some selected links are not congested. Re-examine the utilization column.",
    highlightedNodes: [],
    highlightedLinks: [
      ...correct.map((id) => ({ linkId: id, status: "correct" as const })),
      ...wrong.map((id) => ({ linkId: id, status: "wrong" as const })),
      ...missed.map((id) => ({ linkId: id, status: "missed" as const })),
    ],
    simulationRunId: sim.simulationRunId,
    expected: [...actualCongested],
    received: [...submitted],
  };
}

// ── COMPUTE_DV_TABLE ──────────────────────────────────────────────────────────

function gradeDVTable(
  attempt: ChallengeAttempt,
  sim: SimulationResult,
  target: ChallengeTarget,
  maxScore: number,
  assignment: Assignment,
): ChallengeGradingResult {
  const tol = assignment.gradingRules.tolerance ?? 0.01;
  const expectedEntries = target.expectedDVEntries ?? [];

  if (!sim.distanceVectorTable || sim.distanceVectorTable.length === 0) {
    return {
      isCorrect: false,
      score: 0, maxScore, percentage: 0,
      attemptNumber: attempt.attemptNumber, hintsUsed: 0,
      feedbackItems: [{
        type: "info", title: "No DV table in result",
        message: "Run the simulation with Distance Vector algorithm first.",
        relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
      }],
      summary: "Run Distance Vector first.",
      nextSuggestion: "Select the Distance Vector algorithm and run the simulation.",
      highlightedNodes: [], highlightedLinks: [],
      simulationRunId: sim.simulationRunId,
    };
  }

  const feedbackItems: FeedbackItem[] = [];
  let totalPoints = 0;
  const pointsPerEntry = maxScore / Math.max(expectedEntries.length, 1);

  // Also check simple pathCost/nextHop answers (exercise-style fallback)
  const simplePathCost = attempt.submittedAnswers.pathCost;
  const simpleNextHop = String(attempt.submittedAnswers.nextHop ?? "").trim().toLowerCase();

  if (expectedEntries.length > 0) {
    for (const exp of expectedEntries) {
      const actual = sim.distanceVectorTable.find(
        (e) => e.nodeId === exp.nodeId && e.destinationId === exp.destinationId,
      );
      if (!actual) {
        feedbackItems.push({
          type: "warning",
          title: `No DV entry for ${exp.nodeId} → ${exp.destinationId}`,
          message: "The expected source/destination pair was not found in the DV table.",
          relatedLinkIds: [], relatedNodeIds: [exp.nodeId, exp.destinationId], relatedDemandIds: [],
        });
        continue;
      }

      // Check against submitted answers (simple form)
      const submittedCost = simplePathCost !== undefined ? Number(simplePathCost) : NaN;
      const costOk = !isNaN(submittedCost) && Math.abs(submittedCost - actual.cost) <= tol;
      const nextHopNodeLabel = attempt.submittedNetwork.nodes
        .find((n) => n.id === actual.nextHop)?.label.toLowerCase() ?? "";
      const nextHopOk =
        simpleNextHop === (actual.nextHop ?? "").toLowerCase() ||
        simpleNextHop === nextHopNodeLabel;

      if (costOk) {
        totalPoints += pointsPerEntry * 0.5;
        feedbackItems.push({
          type: "success",
          title: `Cost ${exp.nodeId} → ${exp.destinationId}: correct`,
          message: `Your answer: ${submittedCost}. Correct cost: ${actual.cost}.`,
          formula: "Total cost = sum of link weights along shortest path",
          workedExample: `DV entry: node=${exp.nodeId}, dest=${exp.destinationId}\nShortest path cost = ${actual.cost} (sum of link weights along path)\nNext hop: ${actual.nextHop ?? "?"}`,
          relatedNodeIds: [exp.nodeId, exp.destinationId], relatedLinkIds: [], relatedDemandIds: [],
          expectedValue: actual.cost, receivedValue: submittedCost,
        });
      } else if (simplePathCost !== undefined) {
        feedbackItems.push({
          type: "error",
          title: `Cost ${exp.nodeId} → ${exp.destinationId}: incorrect`,
          message: `Your answer: ${submittedCost}. Correct cost: ${actual.cost}.`,
          explanation: `Add the weights along the shortest path from ${exp.nodeId} to ${exp.destinationId}.`,
          formula: "Cost = w(link1) + w(link2) + ...",
          workedExample: `DV entry: node=${exp.nodeId}, dest=${exp.destinationId}\nCorrect cost = ${actual.cost} = sum of link weights on shortest path\nYour answer: ${submittedCost}`,
          relatedNodeIds: [exp.nodeId, exp.destinationId], relatedLinkIds: [], relatedDemandIds: [],
          expectedValue: actual.cost, receivedValue: submittedCost,
        });
      }

      if (nextHopOk) {
        totalPoints += pointsPerEntry * 0.5;
        feedbackItems.push({
          type: "success",
          title: `Next hop ${exp.nodeId} → ${exp.destinationId}: correct`,
          message: `Next hop is ${actual.nextHop} (${nextHopNodeLabel || actual.nextHop}).`,
          relatedNodeIds: actual.nextHop ? [exp.nodeId, actual.nextHop] : [exp.nodeId],
          relatedLinkIds: [], relatedDemandIds: [],
        });
      } else if (simpleNextHop) {
        feedbackItems.push({
          type: "error",
          title: `Next hop ${exp.nodeId} → ${exp.destinationId}: incorrect`,
          message: `Your answer: "${simpleNextHop}". Correct next hop: ${actual.nextHop} (${nextHopNodeLabel || actual.nextHop}).`,
          explanation: `The next hop is the first step on the shortest path from ${exp.nodeId} toward ${exp.destinationId}.`,
          relatedNodeIds: actual.nextHop ? [exp.nodeId, actual.nextHop] : [exp.nodeId],
          relatedLinkIds: [], relatedDemandIds: [],
          expectedValue: actual.nextHop, receivedValue: simpleNextHop,
        });
      }

      if (!costOk && simplePathCost === undefined && !simpleNextHop) {
        feedbackItems.push({
          type: "info",
          title: "No answer submitted",
          message: `Fill in the path cost and next hop for ${exp.nodeId} → ${exp.destinationId}.`,
          relatedNodeIds: [exp.nodeId, exp.destinationId], relatedLinkIds: [], relatedDemandIds: [],
        });
      }
    }
  }

  const score = Math.round(totalPoints);
  const isCorrect = score >= maxScore - Math.round(maxScore * 0.01);

  return {
    isCorrect,
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    attemptNumber: attempt.attemptNumber,
    hintsUsed: 0,
    feedbackItems,
    summary: isCorrect
      ? "Correct! Your DV table entries are accurate."
      : `Score: ${score}/${maxScore}. Check the feedback for details on cost and next-hop errors.`,
    nextSuggestion: isCorrect
      ? "You understand Distance Vector routing! Try a harder challenge."
      : "Run Distance Vector and carefully read the routing table in the right panel.",
    highlightedNodes: [],
    highlightedLinks: [],
    simulationRunId: sim.simulationRunId,
  };
}

// ── REDUCE_CONGESTION / FIND_ECMP_WEIGHTS ─────────────────────────────────────

function gradeReduceCongestion(
  attempt: ChallengeAttempt,
  sim: SimulationResult,
  target: ChallengeTarget,
  maxScore: number,
): ChallengeGradingResult {
  const targetUtil = target.maxUtilizationBelow ?? 1.0;
  const actualUtil = sim.maxUtilization;
  const congestedLinks = sim.linkResults.filter((l) => l.isCongested);
  const isCorrect = actualUtil <= targetUtil + 1e-6;

  const feedbackItems: FeedbackItem[] = [];

  feedbackItems.push({
    type: isCorrect ? "success" : "error",
    title: isCorrect
      ? `Max utilization ${fmt(actualUtil * 100)}% ≤ target ${fmt(targetUtil * 100)}%`
      : `Max utilization ${fmt(actualUtil * 100)}% exceeds target ${fmt(targetUtil * 100)}%`,
    message: isCorrect
      ? "All links are within capacity with your current weight configuration."
      : `The network still has ${congestedLinks.length} congested link(s) after your changes.`,
    formula: "Max Utilization = max over all links of (load / capacity)",
    relatedLinkIds: congestedLinks.map((l) => l.linkId),
    relatedNodeIds: [], relatedDemandIds: [],
    expectedValue: `≤ ${fmt(targetUtil * 100)}%`,
    receivedValue: `${fmt(actualUtil * 100)}%`,
  });

  for (const lr of congestedLinks) {
    feedbackItems.push({
      type: "warning",
      title: `Link ${lr.linkId} still congested`,
      message: `Load = ${lr.load.toFixed(2)}, Capacity = ${lr.capacity}, Utilization = ${fmt(lr.utilization * 100)}%`,
      explanation: "Increase the weight of links that lead to this congested link to redirect traffic.",
      relatedLinkIds: [lr.linkId], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  if (isCorrect) {
    const gainedUtil = sim.linkResults.reduce((best, l) => Math.max(best, l.utilization), 0);
    feedbackItems.push({
      type: "info",
      title: "Peak utilization achieved",
      message: `Your solution achieves ${fmt(gainedUtil * 100)}% peak utilization.`,
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    });
  }

  const score = isCorrect ? maxScore : Math.round(maxScore * Math.max(0, 1 - (actualUtil - targetUtil)));

  return {
    isCorrect,
    score: Math.max(0, score),
    maxScore,
    percentage: Math.round((Math.max(0, score) / maxScore) * 100),
    attemptNumber: attempt.attemptNumber,
    hintsUsed: 0,
    feedbackItems,
    summary: isCorrect
      ? `Congestion eliminated! Max utilization = ${fmt(actualUtil * 100)}%.`
      : `Still congested — max utilization = ${fmt(actualUtil * 100)}%, target ≤ ${fmt(targetUtil * 100)}%.`,
    nextSuggestion: isCorrect
      ? "Great! Can you find a solution with even lower peak utilization?"
      : "Try increasing link weights on paths that lead to the congested links.",
    highlightedNodes: [],
    highlightedLinks: congestedLinks.map((l) => ({ linkId: l.linkId, status: "missed" as const })),
    simulationRunId: sim.simulationRunId,
    expected: `maxUtilization ≤ ${targetUtil}`,
    received: actualUtil,
  };
}

// ── COMPUTE_ECMP_SPLIT ────────────────────────────────────────────────────────

function gradeECMPSplit(
  attempt: ChallengeAttempt,
  sim: SimulationResult,
  target: ChallengeTarget,
  maxScore: number,
): ChallengeGradingResult {
  const tol = 0.05;
  const feedbackItems: FeedbackItem[] = [];

  if (sim.pathResults.length === 0) {
    return notRunYet(maxScore, attempt.attemptNumber);
  }

  // Simplest check: compare against target.expectedTrafficSplits if present
  const expectedSplits = target.expectedTrafficSplits ?? {};
  const submittedSplits = (attempt.submittedAnswers.trafficSplits ?? {}) as Record<string, number>;

  let correct = 0;
  let total = 0;

  for (const [key, expShare] of Object.entries(expectedSplits)) {
    total++;
    const subShare = submittedSplits[key];
    if (subShare !== undefined && Math.abs(subShare - expShare) <= tol) {
      correct++;
      feedbackItems.push({
        type: "success",
        title: `Path share for "${key}": correct`,
        message: `Expected ${fmt(expShare * 100)}%, you answered ${fmt(subShare * 100)}%.`,
        formula: "Traffic per path = demand amount / number of equal-cost paths",
        workedExample: `Path key: "${key}"\nExpected share = ${fmt(expShare * 100)}%\nYour answer: ${fmt(subShare * 100)}% ✓`,
        relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
        expectedValue: expShare, receivedValue: subShare,
      });
    } else {
      feedbackItems.push({
        type: "error",
        title: `Path share for "${key}": incorrect`,
        message: subShare !== undefined
          ? `You answered ${fmt(subShare * 100)}%, expected ${fmt(expShare * 100)}%.`
          : `No answer submitted for "${key}".`,
        explanation: "ECMP splits traffic equally among all shortest paths. Count the equal-cost paths, then divide the demand by that count.",
        formula: "Share = Demand amount / Count of equal-cost shortest paths",
        workedExample: `Path key: "${key}"\nIf demand = D and there are N equal-cost paths:\nShare per path = D / N = ${fmt(expShare * 100)}%\nYour answer: ${subShare !== undefined ? fmt(subShare * 100) + "%" : "(none)"}`,
        relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
        expectedValue: expShare, receivedValue: subShare,
      });
    }
  }

  // If no expected splits defined, add info from simulation
  if (total === 0) {
    for (const pr of sim.pathResults) {
      for (const ps of pr.paths) {
        feedbackItems.push({
          type: "info",
          title: `Demand ${pr.demandId}: path ${ps.nodes.join("→")}`,
          message: `Traffic share = ${fmt(ps.trafficShare * 100)}%, cost = ${ps.cost}`,
          formula: "Share = demand / number of equal-cost paths",
          relatedLinkIds: [], relatedNodeIds: ps.nodes, relatedDemandIds: [pr.demandId],
        });
      }
    }
    return {
      isCorrect: false,
      score: 0, maxScore, percentage: 0,
      attemptNumber: attempt.attemptNumber, hintsUsed: 0,
      feedbackItems,
      summary: "No expected splits configured. Review the simulation path results above.",
      nextSuggestion: "Read the simulation path results, then enter your answers.",
      highlightedNodes: [], highlightedLinks: [],
      simulationRunId: sim.simulationRunId,
    };
  }

  const isCorrect = correct === total;
  const score = Math.round((correct / total) * maxScore);

  return {
    isCorrect,
    score,
    maxScore,
    percentage: Math.round((score / maxScore) * 100),
    attemptNumber: attempt.attemptNumber,
    hintsUsed: 0,
    feedbackItems,
    summary: isCorrect
      ? "All traffic splits computed correctly!"
      : `${correct}/${total} traffic splits correct.`,
    nextSuggestion: isCorrect
      ? "You understand ECMP splitting!"
      : "Count the equal-cost paths and divide demand equally.",
    highlightedNodes: [], highlightedLinks: [],
    simulationRunId: sim.simulationRunId,
  };
}

// ── PREDICT_SHORTEST_PATH ─────────────────────────────────────────────────────

function gradePredictShortestPath(
  attempt: ChallengeAttempt,
  sim: SimulationResult,
  target: ChallengeTarget,
  maxScore: number,
): ChallengeGradingResult {
  if (sim.pathResults.length === 0) return notRunYet(maxScore, attempt.attemptNumber);

  const expectedPaths = target.expectedPaths ?? [];
  const feedbackItems: FeedbackItem[] = [];

  if (expectedPaths.length === 0) {
    // Auto-derive: use first path of first demand
    const pr = sim.pathResults[0];
    const best = pr?.paths[0];
    if (!best) return notRunYet(maxScore, attempt.attemptNumber);

    const submitted = parsePathInput(attempt.submittedAnswers.predictedPath);
    const isCorrect = arraysMatch(submitted, best.nodes);

    feedbackItems.push({
      type: isCorrect ? "success" : "error",
      title: isCorrect ? "Correct shortest path!" : "Incorrect path",
      message: isCorrect
        ? `Path: ${best.nodes.join(" → ")}, cost = ${best.cost}`
        : `Your path: ${submitted.join(" → ") || "(none)"}. Correct: ${best.nodes.join(" → ")} (cost ${best.cost}).`,
      explanation: isCorrect
        ? undefined
        : "The shortest path minimizes the total weight. Sum link weights along each candidate path and pick the minimum.",
      formula: "Shortest path cost = min over all paths of (sum of link weights)",
      workedExample: `Shortest path: ${best.nodes.join(" → ")}\nTotal cost = ${best.cost} (sum of link weights along this path)${!isCorrect ? `\nYour path: ${submitted.join(" → ") || "(none)"}` : ""}`,
      relatedNodeIds: best.nodes, relatedLinkIds: [], relatedDemandIds: [pr.demandId],
    });

    const score = isCorrect ? maxScore : 0;
    return {
      isCorrect, score, maxScore,
      percentage: Math.round((score / maxScore) * 100),
      attemptNumber: attempt.attemptNumber, hintsUsed: 0,
      feedbackItems,
      summary: isCorrect ? "Correct path!" : "Incorrect path.",
      nextSuggestion: isCorrect ? "You understand shortest path routing!" : "Try running DV and reading the routing table.",
      highlightedNodes: best.nodes, highlightedLinks: [],
      simulationRunId: sim.simulationRunId,
    };
  }

  let correct = 0;
  for (const exp of expectedPaths) {
    const pr = sim.pathResults.find((r) => r.demandId === exp.demandId);
    const actual = pr?.paths[0];
    if (!actual) continue;
    const submitted = parsePathInput(attempt.submittedAnswers.predictedPath);
    if (arraysMatch(submitted, actual.nodes)) correct++;
  }

  const isCorrect = correct === expectedPaths.length;
  const score = Math.round((correct / expectedPaths.length) * maxScore);
  return {
    isCorrect, score, maxScore, percentage: Math.round((score / maxScore) * 100),
    attemptNumber: attempt.attemptNumber, hintsUsed: 0,
    feedbackItems,
    summary: `${correct}/${expectedPaths.length} paths correct.`,
    nextSuggestion: isCorrect ? "You understand shortest path!" : "Carefully sum the link weights.",
    highlightedNodes: [], highlightedLinks: [],
    simulationRunId: sim.simulationRunId,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(1);
}

function parsePathInput(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string")
    return raw.split(/[→,\->\s]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function arraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v.toLowerCase() === b[i].toLowerCase());
}

function notConfigured(maxScore: number, attemptNumber: number, hintsUsed: number, runId?: string): ChallengeGradingResult {
  return {
    isCorrect: false, score: 0, maxScore, percentage: 0,
    attemptNumber, hintsUsed,
    feedbackItems: [{
      type: "info", title: "No challenge configuration",
      message: "This assignment does not have a challenge configuration. Ask your teacher to add one.",
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    }],
    summary: "No challenge configuration found.",
    nextSuggestion: "",
    highlightedNodes: [], highlightedLinks: [],
    simulationRunId: runId,
  };
}

function notImplemented(maxScore: number, type: string, attemptNumber: number, hintsUsed: number, runId?: string): ChallengeGradingResult {
  return {
    isCorrect: false, score: 0, maxScore, percentage: 0,
    attemptNumber, hintsUsed,
    feedbackItems: [{
      type: "info",
      title: `Auto-grading not yet available for "${type}"`,
      message: "Submit your work to your teacher for manual review.",
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    }],
    summary: "Submit to teacher for review.",
    nextSuggestion: "Export your submission and share it with your teacher.",
    highlightedNodes: [], highlightedLinks: [],
    simulationRunId: runId,
  };
}

function notRunYet(maxScore: number, attemptNumber: number): ChallengeGradingResult {
  return {
    isCorrect: false, score: 0, maxScore, percentage: 0,
    attemptNumber, hintsUsed: 0,
    feedbackItems: [{
      type: "info", title: "Run the simulation first",
      message: "Click 'Run Attempt' before submitting your answer.",
      relatedLinkIds: [], relatedNodeIds: [], relatedDemandIds: [],
    }],
    summary: "Simulation not run yet.",
    nextSuggestion: "Click 'Run Attempt' to execute the simulation.",
    highlightedNodes: [], highlightedLinks: [],
  };
}
