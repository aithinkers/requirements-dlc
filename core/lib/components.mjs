/**
 * Component registry (spec §19).
 *
 * Lifecycle: suggested -> candidate -> confirmed -> active -> deprecated.
 * Suggestions are candidates for human disposition; an agent never silently
 * promotes to confirmed, and technical components without cited evidence emit
 * a solution-decomposition-without-evidence finding.
 */

import { mintIdentity } from "./identity.mjs";

export class ComponentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ComponentError";
  }
}

export const COMPONENT_CLASSES = Object.freeze([
  "business-capability", "product-area", "business-process", "data-domain",
  "application-service", "integration", "user-experience-surface",
  "organization-team", "external-vendor-system"
]);

export const COMPONENT_LIFECYCLE = Object.freeze(["suggested", "candidate", "confirmed", "active", "deprecated"]);

export const COMPONENT_RELATIONSHIPS = Object.freeze(["owned-by", "depends-on", "interfaces-with", "contains", "realizes"]);

const TECHNICAL_CLASSES = Object.freeze(["application-service", "integration", "data-domain"]);

/** §19 — a suggestion carries every required field before disposition. */
export function suggestComponent({
  name, componentClass, responsibility, evidence = [], causedBy = [], possibleOwner = null,
  similarTo = [], confidence, openQuestions = []
}) {
  if (!name?.trim()) throw new ComponentError("a suggestion requires a proposed name");
  if (!COMPONENT_CLASSES.includes(componentClass)) throw new ComponentError(`unknown component class: ${componentClass}`);
  if (!responsibility?.trim()) throw new ComponentError("a suggestion requires responsibility and boundary");
  if (causedBy.length === 0) throw new ComponentError("a suggestion cites the requirements or stories that caused it");
  if (!["low", "medium", "high"].includes(confidence)) throw new ComponentError("a suggestion requires a confidence");
  const record = {
    schema_version: "rdlc.component/v0.2",
    id: mintIdentity(),
    name,
    component_class: componentClass,
    responsibility,
    evidence: [...evidence],
    caused_by: [...causedBy],
    possible_owner: possibleOwner,
    similar_to: [...similarTo],
    confidence,
    open_questions: [...openQuestions],
    lifecycle_state: "suggested",
    findings: []
  };
  // §19 — technical decomposition with no evidence beyond a business boundary.
  if (TECHNICAL_CLASSES.includes(componentClass) && evidence.length === 0) {
    record.findings.push({
      rule: "RDLC-CMP-001",
      severity: "warning",
      message: "solution-decomposition-without-evidence: technical component proposed with no cited evidence (§19)"
    });
  }
  return record;
}

const DISPOSITIONS = Object.freeze({
  accept: "candidate",
  edit: "candidate",
  merge: "candidate",
  reject: "deprecated",
  defer: "suggested"
});

/** §19 — human dispositions; an AI actor cannot confirm (§7.3). */
export function disposeComponent(component, { disposition, actorKind, edits = {}, mergedInto = null, at }) {
  if (!(disposition in DISPOSITIONS)) throw new ComponentError(`unknown disposition: ${disposition}`);
  if (actorKind !== "human") throw new ComponentError("component disposition requires a human actor (§7.3, §19)");
  if (disposition === "merge" && !mergedInto) throw new ComponentError("merge requires the surviving component");
  const next = {
    ...component,
    ...("responsibility" in edits || "name" in edits ? edits : {}),
    lifecycle_state: DISPOSITIONS[disposition],
    disposition: { kind: disposition, merged_into: mergedInto, at }
  };
  return next;
}

/** §19 — lifecycle advancement after disposition; confirmation stays human. */
export function advanceComponent(component, to, { actorKind }) {
  const fromIndex = COMPONENT_LIFECYCLE.indexOf(component.lifecycle_state);
  const toIndex = COMPONENT_LIFECYCLE.indexOf(to);
  if (toIndex === -1) throw new ComponentError(`unknown lifecycle state: ${to}`);
  if (toIndex !== fromIndex + 1 && to !== "deprecated") {
    throw new ComponentError(`invalid component transition: ${component.lifecycle_state} -> ${to}`);
  }
  if (actorKind !== "human") {
    throw new ComponentError("component lifecycle advancement is a human decision at every step (§7.3, §19)");
  }
  return { ...component, lifecycle_state: to };
}

/** Typed component relationship (§19). */
export function relateComponents(source, target, type) {
  if (!COMPONENT_RELATIONSHIPS.includes(type)) throw new ComponentError(`unknown component relationship: ${type}`);
  return { source, target, type };
}
