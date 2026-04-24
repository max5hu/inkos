import { fetchJson } from "../hooks/use-api";

export interface ServiceDetailModelInfo {
  readonly id: string;
  readonly name?: string;
}

export interface ServiceDetailDetectedConfig {
  readonly apiFormat?: "chat" | "responses";
  readonly stream?: boolean;
  readonly baseUrl?: string;
  readonly modelsSource?: "api" | "fallback";
}

export type ServiceDetailConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "connected"; models: ServiceDetailModelInfo[] }
  | { state: "error"; message: string }
  | { state: "saving" }
  | { state: "saved" };

type JsonFetcher = typeof fetchJson;

interface ServiceProbeResponse {
  readonly ok: boolean;
  readonly models?: ServiceDetailModelInfo[];
  readonly selectedModel?: string;
  readonly detected?: ServiceDetailDetectedConfig;
  readonly error?: string;
}

export async function probeServiceForDetail(
  serviceId: string,
  body: {
    readonly apiKey: string;
    readonly apiFormat: "chat" | "responses";
    readonly stream: boolean;
    readonly baseUrl?: string;
  },
  deps?: { readonly fetchJsonImpl?: JsonFetcher },
): Promise<ServiceProbeResponse> {
  const fetchJsonImpl = deps?.fetchJsonImpl ?? fetchJson;
  return await fetchJsonImpl<ServiceProbeResponse>(
    `/services/${encodeURIComponent(serviceId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

export async function rehydrateServiceConnectionStatus(args: {
  readonly effectiveServiceId: string;
  readonly shouldVerify: boolean;
  readonly isCustom: boolean;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly apiKey: string;
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const secret = await fetchJsonImpl<{ apiKey?: string }>(
    `/services/${encodeURIComponent(args.effectiveServiceId)}/secret`,
  );
  const apiKey = String(secret.apiKey ?? "");

  return {
    apiKey,
    status: { state: "idle" },
    detectedModel: "",
    detectedConfig: null,
  };
}

export function matchServiceConfigEntryForDetail(
  entries: ReadonlyArray<Record<string, unknown>>,
  serviceId: string,
): Record<string, unknown> | undefined {
  return entries.find((entry) => {
    if (typeof entry.service !== "string") return false;
    if (serviceId.startsWith("custom:")) {
      return entry.service === "custom" && `custom:${String(entry.name ?? "")}` === serviceId;
    }
    if (serviceId === "custom") return false;
    return entry.service === serviceId;
  });
}

export async function saveServiceConfigWithValidation(args: {
  readonly effectiveServiceId: string;
  readonly serviceId: string;
  readonly isCustom: boolean;
  readonly resolvedCustomName: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly apiFormat: "chat" | "responses";
  readonly stream: boolean;
  readonly temperature: string;
  readonly detectedModel: string;
  readonly fetchJsonImpl?: JsonFetcher;
}): Promise<{
  readonly status: ServiceDetailConnectionStatus;
  readonly detectedModel: string;
  readonly detectedConfig: ServiceDetailDetectedConfig | null;
}> {
  const fetchJsonImpl = args.fetchJsonImpl ?? fetchJson;
  const trimmedKey = args.apiKey.trim();
  const trimmedBaseUrl = args.baseUrl.trim();

  let probeResult: ServiceProbeResponse | null = null;
  if (trimmedKey) {
    probeResult = await probeServiceForDetail(
      args.effectiveServiceId,
      {
        apiKey: trimmedKey,
        apiFormat: args.apiFormat,
        stream: args.stream,
        ...(args.isCustom ? { baseUrl: trimmedBaseUrl } : {}),
      },
      { fetchJsonImpl },
    );
  }

  await fetchJsonImpl(`/services/${encodeURIComponent(args.effectiveServiceId)}/secret`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: trimmedKey }),
  });

  await fetchJsonImpl("/services/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service: args.effectiveServiceId,
      ...(probeResult?.selectedModel ? { defaultModel: probeResult.selectedModel } : args.detectedModel ? { defaultModel: args.detectedModel } : {}),
      services: [
        {
          service: args.isCustom ? "custom" : args.serviceId,
          temperature: parseFloat(args.temperature),
          apiFormat: probeResult?.detected?.apiFormat ?? args.apiFormat,
          stream: typeof probeResult?.detected?.stream === "boolean" ? probeResult.detected.stream : args.stream,
          ...(args.isCustom ? {
            name: args.resolvedCustomName,
            baseUrl: probeResult?.detected?.baseUrl ?? trimmedBaseUrl,
          } : {}),
        },
      ],
    }),
  });

  if (!probeResult) {
    return {
      status: { state: "saved" },
      detectedModel: "",
      detectedConfig: null,
    };
  }

  return {
    status: { state: "connected", models: probeResult.models ?? [] },
    detectedModel: probeResult.selectedModel ?? "",
    detectedConfig: probeResult.detected ?? null,
  };
}
