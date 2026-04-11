/// <reference types="vite/client" />

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe: Record<string, unknown> & { user?: TelegramWebAppUser };
  ready: () => void;
  expand: () => void;
  setHeaderColor?: (color: string) => void;
  themeParams?: { bg_color?: string };
}

interface TelegramNamespace {
  WebApp: TelegramWebApp;
}

interface Window {
  Telegram?: TelegramNamespace;
}
