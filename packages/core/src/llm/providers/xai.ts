import type { InkosProvider } from "./types.js";

export const XAI: InkosProvider = {
  id: "xai",
  label: "xAI (Grok)",
  api: "openai-completions",
  baseUrl: "https://api.x.ai/v1",
  checkModel: "grok-2-1212",
  temperatureRange: [0, 2],
  defaultTemperature: 1,
  writingTemperature: 1,
  models: [
    { id: "grok-4.20-beta-0309-reasoning", displayName: "Grok 4.20 Beta", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { reasoning: true, vision: true, functionCall: true, search: true, structuredOutput: true }, enabled: true, releasedAt: "2026-03-09" },
    { id: "grok-4.20-beta-0309-non-reasoning", displayName: "Grok 4.20 Beta (Non-Reasoning)", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { vision: true, functionCall: true, search: true, structuredOutput: true }, enabled: true, releasedAt: "2026-03-09" },
    { id: "grok-4.20-multi-agent-beta-0309", displayName: "Grok 4.20 Multi-Agent Beta", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { reasoning: true, vision: true, search: true, structuredOutput: true }, enabled: true, releasedAt: "2026-03-09" },
    { id: "grok-4-1-fast-non-reasoning", displayName: "Grok 4.1 Fast (Non-Reasoning)", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { vision: true, functionCall: true, search: true, structuredOutput: true }, enabled: true, releasedAt: "2025-11-20" },
    { id: "grok-4-1-fast-reasoning", displayName: "Grok 4.1 Fast", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { reasoning: true, vision: true, functionCall: true, search: true, structuredOutput: true }, enabled: true, releasedAt: "2025-11-20" },
    { id: "grok-4-fast-non-reasoning", displayName: "Grok 4 Fast (Non-Reasoning)", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { vision: true, functionCall: true, search: true, structuredOutput: true }, releasedAt: "2025-09-09" },
    { id: "grok-4-fast-reasoning", displayName: "Grok 4 Fast", maxOutput: 4096, contextWindowTokens: 2000000, abilities: { reasoning: true, vision: true, functionCall: true, search: true, structuredOutput: true }, releasedAt: "2025-09-09" },
    { id: "grok-code-fast-1", displayName: "Grok Code Fast 1", maxOutput: 4096, contextWindowTokens: 256000, abilities: { reasoning: true, functionCall: true, structuredOutput: true }, releasedAt: "2025-08-27" },
    { id: "grok-4", displayName: "Grok 4 0709", maxOutput: 4096, contextWindowTokens: 256000, abilities: { reasoning: true, vision: true, functionCall: true, search: true, structuredOutput: true }, releasedAt: "2025-07-09" },
    { id: "grok-3", displayName: "Grok 3", maxOutput: 4096, contextWindowTokens: 131072, abilities: { functionCall: true, search: true, structuredOutput: true }, releasedAt: "2025-04-03" },
    { id: "grok-3-mini", displayName: "Grok 3 Mini", maxOutput: 4096, contextWindowTokens: 131072, abilities: { reasoning: true, functionCall: true, search: true, structuredOutput: true }, releasedAt: "2025-04-03" },
  ],
};
