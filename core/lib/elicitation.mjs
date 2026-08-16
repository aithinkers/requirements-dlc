/**
 * Prompted elicitation (spec §18.1).
 *
 * Questions are durable resume-contract records with stable identities.
 * Sources are consulted before the user; an unresolved answer becomes an
 * explicit question, assumption, dependency, or discovery task — never an
 * invented value.
 */

import { mintIdentity } from "./identity.mjs";

export class ElicitationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ElicitationError";
  }
}

export const INTERACTION_STYLES = Object.freeze(["guided", "batch-file", "conversational", "source-first"]);
export const DEFAULT_PROMPT_BATCH_SIZE = 3;

/** §18.1 — a persisted question with its resume-contract fields. */
export function createQuestion({ text, reason, affectedArtifacts = [], sources = [] }) {
  if (!text?.trim()) throw new ElicitationError("a question requires text");
  if (!reason?.trim()) throw new ElicitationError("a question requires the reason it is asked");
  return {
    schema_version: "rdlc.question/v0.2",
    id: mintIdentity(),
    text,
    reason,
    affected_artifacts: [...affectedArtifacts],
    sources: [...sources],
    answer_status: "open",
    answer: null,
    answer_actor: null,
    answered_at: null
  };
}

/**
 * §18.1 — answer from permitted sources before asking the user; the evidence
 * is shown and correctable. `sourceAnswers` maps question id -> {answer,
 * evidence}. Questions no source can answer stay open for the user.
 */
export function answerFromSources(questions, sourceAnswers) {
  return questions.map((question) => {
    const found = sourceAnswers[question.id];
    if (!found) return question;
    if (!found.evidence?.length) throw new ElicitationError("a source answer requires its evidence (§18.1)");
    return {
      ...question,
      answer_status: "answered-from-source",
      answer: found.answer,
      answer_evidence: [...found.evidence],
      answer_actor: "source-analysis",
      correctable: true
    };
  });
}

/** Record a user answer, or convert an unresolved question per §18.1. */
export function resolveQuestion(question, { disposition, answer = null, actor, at }) {
  if (!actor || !at) throw new ElicitationError("resolving a question requires actor and time");
  if (disposition === "answered") {
    if (answer === null || answer === "") throw new ElicitationError("an answered question requires the answer");
    return { ...question, answer_status: "answered", answer, answer_actor: actor, answered_at: at };
  }
  if (["assumption", "dependency", "discovery-task"].includes(disposition)) {
    // The unresolved answer becomes an explicit governed record, never an
    // invented value (§18.1).
    return {
      ...question,
      answer_status: `converted-to-${disposition}`,
      converted_artifact: mintIdentity(),
      answer_actor: actor,
      answered_at: at
    };
  }
  if (disposition === "deferred") return { ...question, answer_status: "deferred", answer_actor: actor, answered_at: at };
  throw new ElicitationError(`unknown question disposition: ${disposition}`);
}

/**
 * §18.1 guided style: at most `promptBatchSize` decision-oriented questions
 * per batch (reference default three), most-blocking first.
 */
export function nextGuidedBatch(questions, { promptBatchSize = DEFAULT_PROMPT_BATCH_SIZE } = {}) {
  if (!Number.isInteger(promptBatchSize) || promptBatchSize < 1) {
    throw new ElicitationError("prompt_batch_size must be a positive integer");
  }
  const open = questions.filter((question) => question.answer_status === "open");
  const ranked = [...open].sort((a, b) => (b.affected_artifacts.length - a.affected_artifacts.length));
  return ranked.slice(0, promptBatchSize);
}

/** §18.1 batch-file style: a reviewable question document plus ingest of edits. */
export function toBatchFile(questions) {
  return questions
    .filter((question) => question.answer_status === "open")
    .map((question) => `## ${question.id}\n\n${question.text}\n\n> reason: ${question.reason}\n\nANSWER:\n`)
    .join("\n");
}

export function ingestBatchFile(questions, text, { actor, at }) {
  const answers = new Map();
  for (const match of text.matchAll(/^## (urn:uuid:[0-9a-f-]{36})[\s\S]*?^ANSWER:\n([\s\S]*?)(?=^## |$(?![\s\S]))/gim)) {
    const answer = match[2].trim();
    if (answer) answers.set(match[1], answer);
  }
  return questions.map((question) =>
    answers.has(question.id)
      ? resolveQuestion(question, { disposition: "answered", answer: answers.get(question.id), actor, at })
      : question
  );
}
