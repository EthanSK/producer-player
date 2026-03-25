import type { AgentModelDefinition, AgentModelId, AgentProviderId } from '@producer-player/contracts';

export const AGENT_MODEL_OPTIONS_BY_PROVIDER: Record<AgentProviderId, readonly AgentModelDefinition[]> = {
  codex: [
    { id: 'gpt-5.4', label: 'GPT-5.4' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
    { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
    { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
    { id: 'gpt-5.2', label: 'GPT-5.2' },
  ],
  claude: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
};

export const DEFAULT_AGENT_MODEL_BY_PROVIDER: Record<AgentProviderId, AgentModelId> = {
  codex: 'gpt-5.4',
  claude: 'claude-sonnet-4-6',
};

export const AGENT_PROVIDER_LABELS: Record<AgentProviderId, string> = {
  codex: 'Codex',
  claude: 'Claude',
};
