#!/usr/bin/env node
/**
 * Validates sample topology JSON files against the rules defined in
 * frontend/src/schemas/topology.schema.json and the application's own
 * validateTopologyJson function (frontend/src/utils/topologyJson.ts).
 *
 * Two-pass approach:
 *   1. Schema-level checks (types, minimums, required fields, enum values)
 *   2. Semantic-level checks (referential integrity, uniqueness)
 */

const fs   = require("fs");
const path = require("path");

// ── Schema constants (from topology.schema.json) ──────────────────────────────

const VALID_TOPOLOGY_TYPES = ["custom", "triangle", "ring", "mesh", "fat-tree", "clos-fat-tree", "line", "grid", "path", "cycle", "random"];

// ── Schema validator (mirrors topology.schema.json draft-07 rules) ────────────

function validateSchema(raw) {
  const errors = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return ["Root must be a JSON object."];
  }

  // Required top-level arrays
  if (!("nodes" in raw)) errors.push('Missing required property "nodes".');
  if (!("links" in raw)) errors.push('Missing required property "links".');
  if (errors.length) return errors;

  if (!Array.isArray(raw.nodes)) errors.push('"nodes" must be an array.');
  if (!Array.isArray(raw.links)) errors.push('"links" must be an array.');

  // Optional scalars
  if ("name" in raw && typeof raw.name !== "string")
    errors.push('"name" must be a string.');
  if ("isDirected" in raw && typeof raw.isDirected !== "boolean")
    errors.push('"isDirected" must be a boolean.');
  if ("topologyType" in raw) {
    if (typeof raw.topologyType !== "string")
      errors.push('"topologyType" must be a string.');
    else if (!VALID_TOPOLOGY_TYPES.includes(raw.topologyType))
      errors.push(`"topologyType" must be one of: ${VALID_TOPOLOGY_TYPES.join(", ")}. Got "${raw.topologyType}".`);
  }

  // nodes[*]
  if (Array.isArray(raw.nodes)) {
    if (raw.nodes.length < 1) errors.push('"nodes" must contain at least 1 item.');
    raw.nodes.forEach((n, i) => {
      if (typeof n !== "object" || n === null || Array.isArray(n)) {
        errors.push(`nodes[${i}]: must be an object.`); return;
      }
      if (!("id"    in n)) errors.push(`nodes[${i}]: missing required "id".`);
      if (!("label" in n)) errors.push(`nodes[${i}]: missing required "label".`);
      if ("id"    in n && typeof n.id    !== "string") errors.push(`nodes[${i}]: "id" must be a string.`);
      if ("label" in n && typeof n.label !== "string") errors.push(`nodes[${i}]: "label" must be a string.`);
      if ("x"     in n && typeof n.x     !== "number") errors.push(`nodes[${i}]: "x" must be a number.`);
      if ("y"     in n && typeof n.y     !== "number") errors.push(`nodes[${i}]: "y" must be a number.`);
    });
  }

  // links[*]
  if (Array.isArray(raw.links)) {
    raw.links.forEach((l, i) => {
      if (typeof l !== "object" || l === null || Array.isArray(l)) {
        errors.push(`links[${i}]: must be an object.`); return;
      }
      if (!("id"     in l)) errors.push(`links[${i}]: missing required "id".`);
      if (!("source" in l)) errors.push(`links[${i}]: missing required "source".`);
      if (!("target" in l)) errors.push(`links[${i}]: missing required "target".`);
      if ("id"     in l && typeof l.id     !== "string") errors.push(`links[${i}]: "id" must be a string.`);
      if ("source" in l && typeof l.source !== "string") errors.push(`links[${i}]: "source" must be a string.`);
      if ("target" in l && typeof l.target !== "string") errors.push(`links[${i}]: "target" must be a string.`);
      if ("weight" in l) {
        if (typeof l.weight !== "number") errors.push(`links[${i}]: "weight" must be a number.`);
        else if (l.weight < 0)            errors.push(`links[${i}]: "weight" must be >= 0 (schema minimum: 0).`);
      }
      if ("capacity" in l) {
        if (typeof l.capacity !== "number") errors.push(`links[${i}]: "capacity" must be a number.`);
        else if (l.capacity < 0.01)         errors.push(`links[${i}]: "capacity" must be >= 0.01 (schema minimum: 0.01).`);
      }
    });
  }

  // demands[*]
  if ("demands" in raw && raw.demands !== undefined) {
    if (!Array.isArray(raw.demands)) {
      errors.push('"demands" must be an array.');
    } else {
      raw.demands.forEach((d, i) => {
        if (typeof d !== "object" || d === null || Array.isArray(d)) {
          errors.push(`demands[${i}]: must be an object.`); return;
        }
        if (!("id"     in d)) errors.push(`demands[${i}]: missing required "id".`);
        if (!("source" in d)) errors.push(`demands[${i}]: missing required "source".`);
        if (!("target" in d)) errors.push(`demands[${i}]: missing required "target".`);
        if (!("amount" in d)) errors.push(`demands[${i}]: missing required "amount".`);
        if ("id"     in d && typeof d.id     !== "string") errors.push(`demands[${i}]: "id" must be a string.`);
        if ("source" in d && typeof d.source !== "string") errors.push(`demands[${i}]: "source" must be a string.`);
        if ("target" in d && typeof d.target !== "string") errors.push(`demands[${i}]: "target" must be a string.`);
        if ("amount" in d) {
          if (typeof d.amount !== "number") errors.push(`demands[${i}]: "amount" must be a number.`);
          else if (d.amount <= 0)           errors.push(`demands[${i}]: "amount" must be > 0 (exclusiveMinimum: 0).`);
        }
      });
    }
  }

  return errors;
}

// ── Semantic validator (mirrors validateTopologyJson in topologyJson.ts) ───────

function validateSemantic(raw) {
  const errors = [];
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.links)) return errors;

  const nodeIds = new Set();
  raw.nodes.forEach((n, i) => {
    if (typeof n.id === "string" && n.id) {
      if (nodeIds.has(n.id)) errors.push(`nodes[${i}]: duplicate id "${n.id}".`);
      else nodeIds.add(n.id);
    }
  });

  const linkIds = new Set();
  raw.links.forEach((l, i) => {
    if (typeof l.id === "string" && l.id) {
      if (linkIds.has(l.id)) errors.push(`links[${i}]: duplicate id "${l.id}".`);
      else linkIds.add(l.id);
    }
    if (l.source && !nodeIds.has(l.source))
      errors.push(`links[${i}]: source "${l.source}" does not exist in nodes.`);
    if (l.target && !nodeIds.has(l.target))
      errors.push(`links[${i}]: target "${l.target}" does not exist in nodes.`);
  });

  const demandIds = new Set();
  (raw.demands ?? []).forEach((d, i) => {
    if (typeof d.id === "string" && d.id) {
      if (demandIds.has(d.id)) errors.push(`demands[${i}]: duplicate id "${d.id}".`);
      else demandIds.add(d.id);
    }
    if (d.source && !nodeIds.has(d.source))
      errors.push(`demands[${i}]: source "${d.source}" does not exist in nodes.`);
    if (d.target && !nodeIds.has(d.target))
      errors.push(`demands[${i}]: target "${d.target}" does not exist in nodes.`);
  });

  return errors;
}

// ── Run validation ────────────────────────────────────────────────────────────

const dir   = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json"));

let allPassed = true;

console.log("\n=== Topology JSON Validation ===\n");

files.forEach(fname => {
  const fpath = path.join(dir, fname);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(fpath, "utf8"));
  } catch (e) {
    console.log(`❌ ${fname}\n   Parse error: ${e.message}\n`);
    allPassed = false;
    return;
  }

  const schemaErrors   = validateSchema(raw);
  const semanticErrors = validateSemantic(raw);
  const allErrors      = [...schemaErrors, ...semanticErrors];

  const isIntentionallyInvalid = fname.startsWith("invalid_");

  if (allErrors.length === 0) {
    if (isIntentionallyInvalid) {
      console.log(`⚠️  ${fname}  [SHOULD HAVE FAILED but passed — check file]\n`);
      allPassed = false;
    } else {
      const nodes   = Array.isArray(raw.nodes)   ? raw.nodes.length   : 0;
      const links   = Array.isArray(raw.links)   ? raw.links.length   : 0;
      const demands = Array.isArray(raw.demands) ? raw.demands.length : 0;
      console.log(`✅ ${fname}  (${nodes} nodes, ${links} links, ${demands} demands)\n`);
    }
  } else {
    if (isIntentionallyInvalid) {
      console.log(`✅ ${fname}  [correctly rejected — ${allErrors.length} error(s)]`);
      allErrors.forEach(e => console.log(`      • ${e}`));
      console.log();
    } else {
      console.log(`❌ ${fname}  [unexpected failure — ${allErrors.length} error(s)]`);
      allErrors.forEach(e => console.log(`      • ${e}`));
      console.log();
      allPassed = false;
    }
  }
});

console.log(allPassed
  ? "=== All validation checks passed ===\n"
  : "=== Some checks FAILED — see above ===\n"
);
process.exit(allPassed ? 0 : 1);
