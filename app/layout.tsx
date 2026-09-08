import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'ASTRA — Un univers à portée de main', description: 'Une galaxie 3D interactive : explorez les étoiles, changez leur spectre et créez des ondes gravitationnelles.' };
export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) { return <html lang="fr"><body>{children}</body></html>; }
