import type { ComponentType } from 'react';
import {
  Globe,
  Monitor,
  Terminal,
  Container,
  Smartphone,
  type LucideProps,
} from 'lucide-react';

export type Platform = 'web' | 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'cli' | 'docker';

interface PlatformInfo {
  label: string;
  icon: ComponentType<LucideProps>;
  color: string;
}

const PLATFORM_MAP: Record<Platform, PlatformInfo> = {
  web: { label: 'Web', icon: Globe, color: '#3b82f6' },
  windows: { label: 'Windows', icon: Monitor, color: '#0078d4' },
  macos: { label: 'macOS', icon: Monitor, color: '#a3aaae' },
  linux: { label: 'Linux', icon: Terminal, color: '#f59e0b' },
  ios: { label: 'iOS', icon: Smartphone, color: '#a3aaae' },
  android: { label: 'Android', icon: Smartphone, color: '#3ddc84' },
  cli: { label: 'CLI', icon: Terminal, color: '#10b981' },
  docker: { label: 'Docker', icon: Container, color: '#2496ed' },
};

export function getPlatformInfo(platform: string): PlatformInfo | undefined {
  return PLATFORM_MAP[platform as Platform];
}

export function getAllPlatformInfo(): Record<Platform, PlatformInfo> {
  return PLATFORM_MAP;
}
