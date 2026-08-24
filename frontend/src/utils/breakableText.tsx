import React from "react";

/** Renders a long SCREAMING_SNAKE_CASE-style value (e.g. "EXACT_ENUMERATION",
 * "SEGMENT_ROUTING") with a soft line-break opportunity after each
 * underscore, via <wbr> — the browser only breaks there if the value
 * actually needs to wrap, and always at the underscore, never mid-word.
 * Replaces `overflow-wrap: anywhere`, which prevented horizontal overflow
 * but broke words at arbitrary character boundaries ("EXACT_ENUMERATI" /
 * "ON") — a real readability regression the final-polish pass fixes (Part
 * B/L: "EXACT_ENUMERATION should not split into visually ugly chunks"). */
export function breakableIdentifier(value: string): React.ReactNode {
  const parts = value.split("_");
  if (parts.length <= 1) return value;
  return parts.reduce<React.ReactNode[]>((acc, part, i) => {
    if (i > 0) acc.push("_", <wbr key={i} />);
    acc.push(part);
    return acc;
  }, []);
}
