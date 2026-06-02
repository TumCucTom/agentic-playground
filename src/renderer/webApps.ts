export interface WebApp {
  id: string;
  name: string;
  url: string;
  icon: string; // emoji or https URL to favicon
  color?: string;
}

export const WEB_APPS: WebApp[] = [
  { id: 'notion', name: 'Notion', url: 'https://www.notion.so', icon: '📝' },
  { id: 'linear', name: 'Linear', url: 'https://linear.app', icon: '◐' },
  { id: 'figma', name: 'Figma', url: 'https://www.figma.com', icon: '🎨' },
  { id: 'github', name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { id: 'vercel', name: 'Vercel', url: 'https://vercel.com/dashboard', icon: '▲' },
  { id: 'gmail', name: 'Gmail', url: 'https://mail.google.com', icon: '✉️' },
  { id: 'cal', name: 'Cal.com', url: 'https://app.cal.com', icon: '📅' },
  { id: 'slack', name: 'Slack', url: 'https://app.slack.com/client', icon: '💬' },
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', icon: '🤖' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai', icon: '✦' },
  { id: 'drive', name: 'Drive', url: 'https://drive.google.com', icon: '📁' },
  { id: 'calendar', name: 'Calendar', url: 'https://calendar.google.com', icon: '🗓' },
  { id: 'airtable', name: 'Airtable', url: 'https://airtable.com', icon: '📊' },
];

export function getWebAppById(id: string): WebApp | undefined {
  return WEB_APPS.find((a) => a.id === id);
}
