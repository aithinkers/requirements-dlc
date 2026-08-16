/**
 * Estimation profiles and controls (spec §22).
 *
 * AI-generated values are marked `suggested` and never overwrite a
 * team-confirmed estimate without an approved change; no automatic
 * conversion between schemes; history retains author, method, rationale.
 */

export class EstimationError extends Error {
  constructor(message) {
    super(message);
    this.name = "EstimationError";
  }
}

export const SCHEMES = Object.freeze([
  "story-points", "t-shirt", "ideal-hours", "ideal-days", "calendar-time",
  "three-point", "bucket", "item-count", "no-estimate", "custom-numeric", "custom-labels"
]);

export const BUILT_IN_SCALES = Object.freeze({
  "fibonacci": [1, 2, 3, 5, 8, 13, 21],
  "modified-fibonacci": [0.5, 1, 2, 3, 5, 8, 13, 20, 40, 100],
  "powers-of-two": [1, 2, 4, 8, 16, 32],
  "t-shirt-default": ["XS", "S", "M", "L", "XL", "XXL"]
});

/** §22.1/§22.2 — a validated estimation profile from setup answers. */
export function createProfile({
  id, scheme, allowedValues, meaning, aiSuggestionsAllowed = true, confirmers = [],
  splitThreshold = null, conversions = {}
}) {
  if (!id) throw new EstimationError("a profile requires an id");
  if (!SCHEMES.includes(scheme)) throw new EstimationError(`unknown estimation scheme: ${scheme}`);
  if (scheme !== "no-estimate" && (!Array.isArray(allowedValues) || allowedValues.length === 0)) {
    throw new EstimationError("a profile requires its allowed values (§22.2)");
  }
  if (!meaning) throw new EstimationError("a profile declares what the value represents (§22.2 item 3)");
  if (confirmers.length === 0 && scheme !== "no-estimate") {
    throw new EstimationError("a profile names who confirms estimates (§22.2 item 5)");
  }
  return Object.freeze({
    schema_version: "rdlc.estimation-profile/v0.2",
    id, scheme,
    allowed_values: allowedValues ? Object.freeze([...allowedValues]) : null,
    meaning,
    ai_suggestions_allowed: aiSuggestionsAllowed,
    confirmers: Object.freeze([...confirmers]),
    split_threshold: splitThreshold,
    // §22.3 — conversions exist only when the organization configured them.
    conversions: Object.freeze({ ...conversions })
  });
}

function assertValue(profile, value) {
  if (profile.scheme === "no-estimate") throw new EstimationError("this profile does not estimate (§22.1)");
  if (!profile.allowed_values.includes(value)) {
    throw new EstimationError(`value ${value} is outside the ${profile.id} scale (§24.1)`);
  }
}

/** §22.3 — an AI value is always `suggested`. */
export function suggestEstimate(profile, { artifact, value, method, rationale, at }) {
  if (!profile.ai_suggestions_allowed) throw new EstimationError("AI suggestions are disabled for this profile (§22.2)");
  assertValue(profile, value);
  if (!method || !rationale) throw new EstimationError("a suggestion records method and rationale (§22.3)");
  return {
    artifact, profile: profile.id, status: "suggested", value,
    history: [{ status: "suggested", value, author: "ai", method, rationale, at }]
  };
}

/** §22.2 item 5 — confirmation by a named confirmer; suggestions never self-confirm. */
export function confirmEstimate(profile, estimate, { value, actor, at, approvedChange = null }) {
  assertValue(profile, value);
  if (!profile.confirmers.includes(actor)) throw new EstimationError(`${actor} is not a configured confirmer for ${profile.id}`);
  if (estimate.status === "confirmed" && estimate.value !== value) {
    if (!approvedChange || !/^(urn:uuid:|[A-Z]+-\d+)/.test(String(approvedChange))) {
      throw new EstimationError("a confirmed estimate changes only through an identified approved change (§22.3)");
    }
  }
  return {
    ...estimate, status: "confirmed", value,
    history: [...estimate.history, { status: "confirmed", value, author: actor, method: "team-confirmation", rationale: approvedChange ?? "initial confirmation", at }]
  };
}

/**
 * §22.3 — conversions require an explicit organization mapping; points→time
 * and cross-team scale combination are refused outright.
 */
export function convertEstimate(profile, value, targetScheme) {
  if (profile.scheme === "story-points" && ["ideal-hours", "ideal-days", "calendar-time"].includes(targetScheme)) {
    throw new EstimationError("story points are never converted to time automatically (§22.3)");
  }
  const mapping = profile.conversions[targetScheme];
  if (!mapping) throw new EstimationError(`no configured conversion from ${profile.scheme} to ${targetScheme} (§22.3)`);
  if (!(value in mapping)) throw new EstimationError(`no mapping entry for value ${value}`);
  return mapping[value];
}

/** §22.3 — values from different team scales never aggregate. */
export function rollUp(estimates, profiles) {
  for (const estimate of estimates) {
    if (!profiles[estimate.profile]) throw new EstimationError(`unknown estimation profile: ${estimate.profile} (§22.3)`);
  }
  const schemes = new Set(estimates.map((estimate) => profiles[estimate.profile].id));
  if (schemes.size > 1) throw new EstimationError("estimates from incompatible team scales are never combined (§22.3)");
  const numeric = estimates.every((estimate) => typeof estimate.value === "number");
  if (!numeric) throw new EstimationError("only numeric same-profile estimates roll up");
  return estimates.reduce((sum, estimate) => sum + estimate.value, 0);
}
