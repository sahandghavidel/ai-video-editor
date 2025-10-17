import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Ultimate Video Editor - AI-Powered Video Processing',
  description:
    'Professional video editing platform with AI transcription, scene generation, and automated content creation. Merge videos, generate timestamps, and create YouTube-ready content with ease.',
  keywords:
    'video editor, AI transcription, video processing, YouTube content, video merging, scene generation',
  authors: [{ name: 'Ultimate Video Editor' }],
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2563eb',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang='en'>
      <head>
        <link rel='icon' href='/favicon.ico?v=1' sizes='any' />
        <link rel='icon' href='/favicon.svg?v=1' type='image/svg+xml' />
        <link rel='shortcut icon' href='/favicon.ico?v=1' />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Global error handler to prevent browser alerts
              window.addEventListener('error', function(e) {
                console.error('Global error caught:', e.error);
                e.preventDefault();
              });

              window.addEventListener('unhandledrejection', function(e) {
                console.error('Unhandled promise rejection:', e.reason);
                e.preventDefault();
              });
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
