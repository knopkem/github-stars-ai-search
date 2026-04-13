import type { HardwareInfo } from '@github-stars-ai-search/shared';

export interface ModelRecommendation {
  tier: string;
  chatModels: string[];
  embeddingModels: string[];
  maxConcurrency: number;
  notes: string;
}

const RECOMMENDATIONS: ModelRecommendation[] = [
  {
    tier: '≤4 GB VRAM',
    chatModels: ['qwen2.5-3b-instruct'],
    embeddingModels: ['nomic-embed-text-v1.5'],
    maxConcurrency: 1,
    notes: 'Use small quantized models. Sequential processing recommended.',
  },
  {
    tier: '4–8 GB VRAM',
    chatModels: ['qwen2.5-7b-instruct', 'mistral-7b-instruct'],
    embeddingModels: ['nomic-embed-text-v1.5', 'bge-m3'],
    maxConcurrency: 2,
    notes: 'Good balance of speed and quality. Q4 quantization recommended.',
  },
  {
    tier: '8–12 GB VRAM',
    chatModels: ['qwen3-8b', 'qwen2.5-7b-instruct'],
    embeddingModels: ['bge-m3', 'nomic-embed-text-v1.5'],
    maxConcurrency: 3,
    notes: 'Can run 7-8B models comfortably with parallel requests.',
  },
  {
    tier: '12–16 GB VRAM',
    chatModels: ['qwen3-8b', 'mistral-7b-instruct', 'qwen2.5-14b-instruct'],
    embeddingModels: ['bge-m3', 'nomic-embed-text-v1.5'],
    maxConcurrency: 4,
    notes: 'Strong performance. Can consider 14B models for better quality.',
  },
  {
    tier: '16–24 GB VRAM',
    chatModels: ['qwen2.5-14b-instruct', 'qwen3-8b'],
    embeddingModels: ['bge-m3'],
    maxConcurrency: 6,
    notes: 'Excellent for larger models and high concurrency.',
  },
  {
    tier: '24+ GB VRAM',
    chatModels: ['qwen2.5-14b-instruct', 'qwen3-8b'],
    embeddingModels: ['bge-m3'],
    maxConcurrency: 8,
    notes: 'Maximum throughput. Can run large models with full parallelism.',
  },
];

const CPU_ONLY_RECOMMENDATION: ModelRecommendation = {
  tier: 'CPU only',
  chatModels: ['qwen2.5-3b-instruct'],
  embeddingModels: ['nomic-embed-text-v1.5'],
  maxConcurrency: 1,
  notes: 'No GPU detected. Use small models. Processing will be slower.',
};

export function getRecommendation(hardware: HardwareInfo): ModelRecommendation {
  if (!hardware.gpu) {
    return CPU_ONLY_RECOMMENDATION;
  }

  const vramMb = hardware.gpu.vramMb;
  const vramGb = vramMb / 1024;

  if (vramGb <= 4) return RECOMMENDATIONS[0]!;
  if (vramGb <= 8) return RECOMMENDATIONS[1]!;
  if (vramGb <= 12) return RECOMMENDATIONS[2]!;
  if (vramGb <= 16) return RECOMMENDATIONS[3]!;
  if (vramGb <= 24) return RECOMMENDATIONS[4]!;
  return RECOMMENDATIONS[5]!;
}

export function formatBytes(mb: number): string {
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }
  return `${mb} MB`;
}
