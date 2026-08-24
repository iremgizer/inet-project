import React, { useEffect, useMemo, useState } from "react";
import {
  GraduationCap, FlaskConical, Sparkles, ChevronRight, RefreshCw,
  Network as NetworkIcon, Zap, ShieldAlert, Gauge, Layers, LucideIcon,
} from "lucide-react";
import { DemoScenarioSummary, DemoCategory } from "../types/assignment";
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

// Fixed display order — matches the teaching progression, not the backend's
// alphabetical Mongo sort (which only guarantees stable ordering within a
// category, not across categories).
const CATEGORY_ORDER: DemoCategory[] = [
  "Routing Basics", "Traffic Engineering", "Failures", "Optimization", "Optimization Complexity",
];

const CATEGORY_ICON: Record<DemoCategory, LucideIcon> = {
  "Routing Basics": NetworkIcon,
  "Traffic Engineering": Zap,
  "Failures": ShieldAlert,
  "Optimization": Gauge,
  "Optimization Complexity": Layers,
};

const COMPLEXITY_CLASS: Record<string, string> = {
  Beginner: "demo-complexity-beginner",
  Intermediate: "demo-complexity-intermediate",
  Advanced: "demo-complexity-advanced",
};

const DemoScenarioDashboard: React.FC<DemoScenarioDashboardProps> = ({ onOpenScenario }) => {
  const [scenarios, setScenarios] = useState<DemoScenarioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);

  const load = () => {
    setError(null);
    listDemoScenarios()
      .then(setScenarios)
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

  const grouped = useMemo(() => {
    if (!scenarios) return [];
    const byCategory = new Map<DemoCategory, DemoScenarioSummary[]>();
    for (const s of scenarios) {
      const cat = s.demoScenario.category;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(s);
    }
    for (const list of byCategory.values()) {
      list.sort((a, b) => a.demoScenario.order - b.demoScenario.order);
    }
    return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({ category: c, items: byCategory.get(c)! }));
  }, [scenarios]);

  return (
    <div className="demo-dashboard">
      <div className="demo-dashboard-header">
        <div className="demo-dashboard-title">
          <FlaskConical size={22} className="demo-dashboard-title-icon" />
          <div>
            <h1>Demo Scenario Pack</h1>
            <p>Curated Sprint 1 &amp; Sprint 2 teaching scenarios — pre-loaded topology, demands, and configuration. Click Open, then Run.</p>
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

      {grouped.map(({ category, items }) => {
        const Icon = CATEGORY_ICON[category];
        return (
          <section key={category} className="demo-category-section">
            <div className="demo-category-header">
              <Icon size={16} />
              <h2>{category}</h2>
            </div>
            <div className="demo-scenario-grid">
              {items.map((s) => (
                <button
                  key={s.assignmentId}
                  className="demo-scenario-card"
                  onClick={() => onOpenScenario(s.assignmentId)}
                >
                  <div className="demo-scenario-card-top">
                    <span className="demo-scenario-title">{s.title}</span>
                    {s.demoScenario.recommended && (
                      <span className="demo-scenario-recommended" title="Recommended demo">
                        <Sparkles size={11} /> Recommended
                      </span>
                    )}
                  </div>
                  <p className="demo-scenario-desc">{s.demoScenario.shortDescription}</p>
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
          </section>
        );
      })}
    </div>
  );
};

export default DemoScenarioDashboard;
