export default function Home() {
  return (
    <main>
      <h1>E2E Test Next.js App</h1>
      <p>This is a test app for E2E deployment testing.</p>
      <p>Server time: {new Date().toISOString()}</p>
      <p id="test-marker">e2e-test-success</p>
    </main>
  );
}
