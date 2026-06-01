// Shared list of "common" macOS apps for the App Launcher quick-pick and
// the sidebar in the Toolbox. Bundle IDs are used by main process IPC
// to spawn new instances. The icon is a single emoji used in both UIs.

export interface CommonApp {
  id: string;
  name: string;
  icon: string;
}

export const COMMON_APPS: CommonApp[] = [
  { id: 'com.google.Chrome', name: 'Google Chrome', icon: '🌐' },
  { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', icon: '🧩' },
  { id: 'com.apple.Terminal', name: 'Terminal', icon: '⌨' },
  { id: 'com.apple.Safari', name: 'Safari', icon: '🧭' },
  { id: 'com.figma.Desktop', name: 'Figma', icon: '🎨' },
  { id: 'com.spotify.client', name: 'Spotify', icon: '🎧' },
  { id: 'com.apple.finder', name: 'Finder', icon: '📁' },
  { id: 'com.apple.SafariTechnologyPreview', name: 'Safari Tech Preview', icon: '🧪' },
  { id: 'com.tinyspeck.chatlyio', name: 'Slack', icon: '💬' },
  { id: 'com.apple.dt.Xcode', name: 'Xcode', icon: '🛠' },
  { id: 'com.google.Chrome.canary', name: 'Chrome Canary', icon: '🌐' },
];

// Heuristics for matching a desktopCapturer source.name to a known bundle
// id. Used to group running windows under their parent app.
export function nameToAppId(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('visual studio code') || lower.includes('code')) return 'com.microsoft.VSCode';
  if (lower.includes('google chrome')) return 'com.google.Chrome';
  if (lower.includes('safari')) return 'com.apple.Safari';
  if (lower.includes('figma')) return 'com.figma.Desktop';
  if (lower.includes('spotify')) return 'com.spotify.client';
  if (lower.includes('finder')) return 'com.apple.finder';
  if (lower.includes('terminal')) return 'com.apple.Terminal';
  if (lower.includes('slack')) return 'com.tinyspeck.chatlyio';
  if (lower.includes('xcode')) return 'com.apple.dt.Xcode';
  return '';
}

export function getAppById(bundleId: string): CommonApp | undefined {
  return COMMON_APPS.find((a) => a.id === bundleId);
}
