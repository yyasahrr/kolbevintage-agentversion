export default function HomePage() {
  return (
    <main className="shell">
      <section className="status-card" aria-labelledby="page-title">
        <p className="eyebrow">Kolbe Vintage Platform</p>
        <h1 id="page-title">Foundation is ready.</h1>
        <p className="summary">
          The shared application runtime is in place. Commerce capabilities will be added only
          after their domain rules, authorization, data integrity, and tests are implemented.
        </p>
        <div className="status-row" role="status" aria-label="Foundation status">
          <span className="status-dot" aria-hidden="true" />
          <span>Discovery complete · foundation implementation started</span>
        </div>
        <div className="endpoint-list" aria-label="Operational endpoints">
          <a href="/api/health">Liveness endpoint</a>
          <a href="/api/ready">Readiness endpoint</a>
        </div>
      </section>
    </main>
  );
}
