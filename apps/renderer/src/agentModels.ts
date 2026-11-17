import type {
  AgentModelDefinition,
  AgentModelId,
  AgentProviderId,
  AgentThinkingEffort,
  AgentThinkingOption,
} from '@producer-player/contracts';

export const AGENT_PROVIDER_LABELS: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
};

export const AGENT_THINKING_OPTIONS: readonly AgentThinkingOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
];

export const DEFAULT_AGENT_THINKING_BY_PROVIDER: Record<
  AgentProviderId,
  AgentThinkingEffort
> = {
  codex: 'high',
  claude: 'high',
};
