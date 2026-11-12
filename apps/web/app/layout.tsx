import 'flag-icons/css/flag-icons.min.css';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { I18nProvider } from '@/lib/i18n';

const ui = Manrope({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700', '800'], variable: '--font-ui', display: 'swap' });

export const metadata: Metadata = { title: 'LLB — Flight Price Tracker', description: 'Automatic daily flight price monitoring' };
export const viewport: Viewport = {
  width: 'device-width', initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f7fb' },
    { media: '(prefers-color-scheme: dark)', color: '#0d131c' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={ui.variable}>
      <body>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
