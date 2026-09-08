import type { Metadata } from 'next';
import './globals.css';
// Static fallback shown before client-side locale detection swaps in the
// visitor's language (see lib/i18n/use-locale.ts).
export const metadata: Metadata = { title: 'ASTRA — A universe within reach', description: 'An interactive 3D galaxy: explore the stars and shift their light spectrum.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
