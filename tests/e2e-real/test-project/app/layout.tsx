export const metadata = {
  title: 'E2E Test App',
  description: 'Test app for E2E deployment testing',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
