import type Anthropic from '@anthropic-ai/sdk';

export interface FakeResponse {
  data?: unknown;
  rawText?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  stopReason?: Anthropic.Message['stop_reason'];
}

type Handler = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<FakeResponse> | FakeResponse;

/**
 * Deterministic stand-in for the Anthropic client, injected through the ANTHROPIC_CLIENT token
 * so the real LlmService (routing, budget, usage ledger, parsing) is exercised without network.
 */
export class FakeAnthropic {
  readonly calls: Anthropic.MessageCreateParamsNonStreaming[] = [];

  constructor(public handler: Handler) {}

  readonly messages = {
    create: async (
      params: Anthropic.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Message> => {
      this.calls.push(params);
      const response = await this.handler(params);
      return {
        id: `msg_${this.calls.length}`,
        type: 'message',
        role: 'assistant',
        model: response.model ?? params.model,
        stop_reason: response.stopReason ?? 'end_turn',
        stop_sequence: null,
        content: [
          {
            type: 'text',
            text: response.rawText ?? JSON.stringify(response.data),
            citations: null,
          },
        ],
        usage: {
          input_tokens: response.inputTokens ?? 1000,
          output_tokens: response.outputTokens ?? 500,
        },
      } as unknown as Anthropic.Message;
    },
  };

  callsFor(model: string): number {
    return this.calls.filter((c) => c.model === model).length;
  }
}

/** A schema-valid paper analysis that only uses numbers present in `abstract`. */
export function cannedAnalysis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'The authors propose a method and evaluate it on the reported benchmark.',
    problem: 'Existing approaches are costly.',
    priorApproach: 'The abstract does not state the prior approach in detail.',
    contribution: 'A new training procedure.',
    methods: 'Controlled comparison described in the abstract.',
    findings: [
      {
        statement: 'The method improves efficiency.',
        evidence: 'Reported comparison in the abstract.',
      },
    ],
    limitations: ['Evaluated on a single benchmark.'],
    keyTerms: [{ term: 'benchmark', explanation: 'A standard test set.' }],
    openQuestions: ['Does it generalize?'],
    ...overrides,
  };
}
