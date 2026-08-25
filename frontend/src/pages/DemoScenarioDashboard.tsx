import React, { useEffect, useState } from "react";
import { GraduationCap, FlaskConical, ChevronRight, RefreshCw } from "lucide-react";
import { DemoScenarioSummary } from "../types/assignment";
import { listDemoScenarios, seedDemoScenarios, ApiError } from "../api/simulationApi";

// ── Error classification ─────────────────────────────────────────────────
// `fetch()` itself throwing (no ApiError, no HTTP status at all) covers
// three genuinely indistinguishable-from-JS causes at once — the backend is
// down, the request never left the browser, or a CORS policy silently
// blocked the response — the Fetch API deliberately doesn't expose which
// one, for cross-origin security reasons. Once a real HTTP response comes
// back (ApiError, with a status), 4xx vs 5xx *is* distinguishable, and is
// the difference between "the request itself was rejected" (bad input,
// not-found, ...) and "the backend accepted the request but failed on its
// own side" (most often: its own MongoDB connection). This intentionally
// never repeats "Is MongoDB running?" for every failure — only the cases
// that are actually consistent with that being the cause.
function describeApiError(err: unknown, context: "load" | "seed"): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      return context === "seed"
        ? `Backend reached, but seeding failed on its own side (server error, HTTP ${err.status}) — this is consistent with MongoDB being unreachable from the backend. Check the backend's own /health endpoint and logs, not the frontend.`
        : `Backend reached, but it returned a server error (HTTP ${err.status}) while loading scenarios — check the backend's own logs.`;
    }
    return `Backend reached, but rejected the request (HTTP ${err.status}): ${err.message}`;
  }
  return "Could not reach the backend at all — it may be down or still starting up, or the request was blocked by CORS (the backend's allowed frontend origin may not match this site's URL). This is not necessarily a MongoDB problem.";
}

interface DemoScenarioDashboardProps {
  onOpenScenario: (assignmentId: string) => void;
}

const COMPLEXITY_CLASS: Record<string, string> = {
  Beginner: "demo-complexity-beginner",
  Intermediate: "demo-complexity-intermediate",
  Advanced: "demo-complexity-advanced",
};

// ── The dashboard ─────────────────────────────────────────────────────────
// A curated tutorial menu, not a test catalog: exactly the 4 course-aligned
// scenarios instructor feedback settled on (see backend/app/demo/
// demo_scenarios.py's CURATED_DEMO_SCENARIO_BUILDERS), one flat list sorted
// by `demoScenario.order`, no category grouping (there is now only one
// category — "Demo Scenarios" — so a second grouping layer would just add
// visual noise for 4 cards). Each card carries only what a presenter needs
// to pick a scenario: title, one short non-spoiler sentence, an optional
// course citation, a difficulty tag, and Open — never a preview of the
// expected numeric/optimization outcome.
const DemoScenarioDashboard: React.FC<DemoScenarioDashboardProps> = ({ onOpenScenario }) => {
  const [scenarios, setScenarios] = useState<DemoScenarioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = () => {
    setError(null);
    listDemoScenarios()
      .then((list) => setScenarios([...list].sort((a, b) => a.demoScenario.order - b.demoScenario.order)))
      .catch((err) => setError(describeApiError(err, "load")));
  };

  useEffect(load, []);

  const handleSeed = async () => {
    setSeeding(true);
    setError(null);
    try {
      const result = await seedDemoScenarios();
      if (result.seeded === 0) {
        // The endpoint itself responded normally (HTTP 200) but reports
        // nothing was persisted — this is the backend's own explicit
        // "MongoDB unavailable" signal (see POST /seed-demo-scenarios,
        // which degrades gracefully rather than erroring), so this really
        // is the one case where naming MongoDB is accurate.
        setError(`Backend reached, but MongoDB is unavailable server-side: ${result.message}`);
        return;
      }
      load();
    } catch (err) {
      setError(describeApiError(err, "seed"));
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="demo-dashboard">
      <div className="demo-dashboard-header">
        <div className="demo-dashboard-title">
          <FlaskConical size={22} className="demo-dashboard-title-icon" />
          <div>
            <h1>Demo Scenarios</h1>
            <p>Pre-loaded topology, demands, and configuration. Click Open, then Run.</p>
          </div>
        </div>
        <button className="btn-secondary demo-reseed-btn" onClick={handleSeed} disabled={seeding}>
          <RefreshCw size={13} className={seeding ? "spin" : ""} /> {seeding ? "Seeding…" : "Reseed pack"}
        </button>
      </div>

      {error && (
        <div className="demo-dashboard-empty">
          <GraduationCap size={28} />
          <p>{error}</p>
        </div>
      )}

      {!error && scenarios !== null && scenarios.length === 0 && (
        <div className="demo-dashboard-empty">
          <GraduationCap size={28} />
          <p>No demo scenarios seeded yet. Make sure MongoDB is running, then click "Reseed pack".</p>
        </div>
      )}

      {scenarios && scenarios.length > 0 && (
        <div className="demo-scenario-grid">
          {scenarios.map((s) => (
            <button
              key={s.assignmentId}
              className="demo-scenario-card"
              onClick={() => onOpenScenario(s.assignmentId)}
            >
              <div className="demo-scenario-card-top">
                <span className="demo-scenario-title">{s.title}</span>
              </div>
              <p className="demo-scenario-desc">{s.demoScenario.shortDescription}</p>
              {s.demoScenario.courseSource && (
                <p className="demo-scenario-source">{s.demoScenario.courseSource}</p>
              )}
              <div className="demo-scenario-card-bottom">
                {s.demoScenario.complexity && (
                  <span className={`demo-complexity-badge ${COMPLEXITY_CLASS[s.demoScenario.complexity] ?? ""}`}>
                    {s.demoScenario.complexity}
                  </span>
                )}
                <span className="demo-scenario-open">
                  Open <ChevronRight size={13} />
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default DemoScenarioDashboard;
