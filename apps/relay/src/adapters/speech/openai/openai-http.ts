import { VoiceSatelliteError } from "@voice-satellite/contracts";

export interface OpenAiHttpConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAiHttp {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;

  public constructor(private readonly config: OpenAiHttpConfig) {
    if (!config.apiKey) throw new Error("OpenAI API key is required");
    this.#baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(
      /\/$/,
      "",
    );
    this.#fetch = config.fetch ?? globalThis.fetch;
  }

  public async request(path: string, init: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          ...init.headers,
        },
      });
    } catch (error) {
      throw new VoiceSatelliteError(
        "internal",
        "speech provider request failed",
        { cause: error },
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 512);
      throw new VoiceSatelliteError(
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500
          ? "timeout"
          : "internal",
        `speech provider returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }
    return response;
  }
}
