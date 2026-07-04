import React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { HelpCircle } from "lucide-react";

interface TermHintProps {
  term: string;
  shortDefinition: string;
  example?: string;
  formula?: string;
}

const TermHint: React.FC<TermHintProps> = ({ term, shortDefinition, example, formula }) => (
  <Tooltip.Provider delayDuration={120} skipDelayDuration={0}>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button className="term-hint-trigger" aria-label={`What is ${term}?`} type="button">
          <HelpCircle size={12} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="term-hint-content" sideOffset={6} side="top" align="start">
          <div className="term-hint-term">{term}</div>
          <div className="term-hint-def">{shortDefinition}</div>
          {formula && <pre className="term-hint-formula">{formula}</pre>}
          {example && <div className="term-hint-example">{example}</div>}
          <Tooltip.Arrow className="term-hint-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </Tooltip.Provider>
);

export default TermHint;
