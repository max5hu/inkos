import { z } from "zod";

// --- Lenient parsing helpers for free-form LLM JSON ---
// The play pipeline parses raw model output. Treat structural drift as recoverable, not fatal:
// coerce scalars to strings, drop malformed array items, and fall back on bad enums — so a single
// off-shape field never crashes the whole turn. A chat agent should degrade, not hard-error on the
// model's imperfect output.
const coercedString = z.preprocess((v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}, z.string());

function lenientArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(z.unknown()).transform((arr) =>
      arr.flatMap((entry) => {
        const parsed = item.safeParse(entry);
        return parsed.success ? [parsed.data as z.infer<T>] : [];
      }),
    ),
  );
}

export const PlayActionKindSchema = z.enum(["look", "say", "move", "do", "wait"]);
export type PlayActionKind = z.infer<typeof PlayActionKindSchema>;

export const PlayActionIntentSchema = z.object({
  // Interpreters drift: bad/extra action kinds, null targets, numbers or objects in free-text
  // fields, object-shaped secondary actions. Coerce and tolerate so no off-shape field crashes the turn.
  actionKind: PlayActionKindSchema.catch("do"),
  targetEntityLabel: z.string().nullish().transform((v) => (v && v.trim() ? v : undefined)).catch(undefined),
  targetLocationLabel: z.string().nullish().transform((v) => (v && v.trim() ? v : undefined)).catch(undefined),
  intent: coercedString,
  manner: coercedString,
  risk: coercedString,
  ambiguity: coercedString,
  secondaryActions: lenientArray(z.string()),
});
export type PlayActionIntentInput = z.input<typeof PlayActionIntentSchema>;
export type PlayActionIntent = z.infer<typeof PlayActionIntentSchema>;

export const PlayEntityTypeSchema = z.enum([
  "actor",
  "location",
  "item",
  "evidence",
  "clue",
  "claim",
  "proof_chain",
  "organization",
  "rule",
  "scene",
  "event",
]);
export type PlayEntityType = z.infer<typeof PlayEntityTypeSchema>;

export const PlayEntitySchema = z.object({
  id: z.string().min(1),
  type: PlayEntityTypeSchema,
  label: z.string().min(1),
  summary: z.string().default(""),
  status: z.string().default(""),
  createdEventId: z.string().min(1).optional(),
  updatedEventId: z.string().min(1).optional(),
});
export type PlayEntityInput = z.input<typeof PlayEntitySchema>;
export type PlayEntity = z.infer<typeof PlayEntitySchema>;

export const PlayVisibilitySchema = z.record(z.string(), z.string());
export type PlayVisibility = z.infer<typeof PlayVisibilitySchema>;

export const PlayEdgeSchema = z.object({
  id: z.string().min(1),
  fromId: z.string().min(1),
  type: z.string().min(1),
  toId: z.string().min(1),
  value: z.record(z.string(), z.unknown()).default({}),
  validFromEventId: z.string().min(1),
  validUntilEventId: z.string().min(1).nullable().default(null),
  sourceEventId: z.string().min(1),
  visibility: PlayVisibilitySchema.default({}),
  strength: z.number().finite().optional(),
  confidence: z.number().finite().optional(),
});
export type PlayEdgeInput = z.input<typeof PlayEdgeSchema>;
export type PlayEdge = z.infer<typeof PlayEdgeSchema>;

export const PlayStateSlotKindSchema = z.enum([
  "resource",
  "relation",
  "pressure",
  "clue",
  "evidence",
  "flag",
  "timer",
]);
export type PlayStateSlotKind = z.infer<typeof PlayStateSlotKindSchema>;

export const PlayStateSlotSchema = z.object({
  id: z.string().min(1),
  ownerEntityId: z.string().min(1).nullable().optional(),
  kind: PlayStateSlotKindSchema,
  label: z.string().min(1),
  value: z.unknown(),
  updatedEventId: z.string().min(1),
});
export type PlayStateSlotInput = z.input<typeof PlayStateSlotSchema>;
export type PlayStateSlot = z.infer<typeof PlayStateSlotSchema>;

export const PlayEvidenceStatusSchema = z.enum([
  "unknown",
  "hinted",
  "seen",
  "collected",
  "verified",
  "weaponized",
  "exposed",
  "exhausted",
]);
export type PlayEvidenceStatus = z.infer<typeof PlayEvidenceStatusSchema>;

export const PlayEvidenceTransitionSchema = z.object({
  entityId: z.string().min(1),
  from: PlayEvidenceStatusSchema.optional(),
  to: PlayEvidenceStatusSchema,
  reason: z.string().default(""),
});
export type PlayEvidenceTransitionInput = z.input<typeof PlayEvidenceTransitionSchema>;
export type PlayEvidenceTransition = z.infer<typeof PlayEvidenceTransitionSchema>;

export const PlayEventSchema = z.object({
  id: z.string().min(1),
  turn: z.number().int().min(0),
  actionKind: PlayActionKindSchema,
  rawInput: z.string().min(1),
  outcomeSummary: z.string().default(""),
  createdAt: z.string().min(1),
});
export type PlayEventInput = z.input<typeof PlayEventSchema>;
export type PlayEvent = z.infer<typeof PlayEventSchema>;

// Models (especially via OpenAI-compatible gateways) drift the mutation shape: they sometimes
// return a bare array instead of { upsert: [...] } / { transitions: [...] }, emit null for optional
// string fields, and produce individual entities/edges/slots that are incomplete. Normalize the
// container shape, accept null reasons, and parse each item leniently — dropping malformed items
// rather than failing the whole mutation — so one bad item from the model doesn't crash a play turn.
function normalizePlayMutation(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = { ...(value as Record<string, unknown>) };
  if (Array.isArray(v.entities)) v.entities = { upsert: v.entities };
  if (Array.isArray(v.edges)) v.edges = { upsert: v.edges };
  if (Array.isArray(v.stateSlots)) v.stateSlots = { upsert: v.stateSlots };
  if (Array.isArray(v.evidence)) v.evidence = { transitions: v.evidence };
  if (typeof v.notes === "string") v.notes = v.notes.trim() ? [v.notes] : [];
  return v;
}

const PlayEdgeExpireSchema = z.object({
  edgeId: z.string().min(1),
  validUntilEventId: z.string().min(1),
  reason: z.string().default(""),
});

// Every field is .catch-guarded so a single off-shape field degrades to its default instead of
// throwing and crashing the whole turn (fail-open, not fail-closed).
export const PlayMutationSchema = z.preprocess(normalizePlayMutation, z.object({
  eventId: z.string().min(1).catch(""),
  turn: z.coerce.number().int().min(0).catch(0),
  actionKind: PlayActionKindSchema.catch("do"),
  summary: coercedString.catch(""),
  entities: z.object({ upsert: lenientArray(PlayEntitySchema) }).catch({ upsert: [] }),
  edges: z.object({
    upsert: lenientArray(PlayEdgeSchema),
    expire: lenientArray(PlayEdgeExpireSchema),
  }).catch({ upsert: [], expire: [] }),
  stateSlots: z.object({ upsert: lenientArray(PlayStateSlotSchema) }).catch({ upsert: [] }),
  evidence: z.object({ transitions: lenientArray(PlayEvidenceTransitionSchema) }).catch({ transitions: [] }),
  blocked: z.boolean().catch(false),
  blockedReason: coercedString.catch(""),
  notes: lenientArray(coercedString).catch([]),
}));
export type PlayMutationInput = z.input<typeof PlayMutationSchema>;
export type PlayMutation = z.infer<typeof PlayMutationSchema>;
