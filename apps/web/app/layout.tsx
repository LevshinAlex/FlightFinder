import './globals.css';
import type { Metadata, Viewport } from 'next';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Flight Price Tracker', description: 'Automatic daily flight price monitoring' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
