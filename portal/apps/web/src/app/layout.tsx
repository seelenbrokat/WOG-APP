import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WOG – World of Green Logistics',
  description: 'Kunden- und Partnerportal der WOG Logistics',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Source+Sans+3:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
        <link rel="icon" href="/wog-logo.jpg" type="image/jpeg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
