import { useEffect, useState } from 'react'

// Phase 0 smoke test: call the backend health route and show the result, to
// prove frontend -> backend -> MongoDB are all connected. This screen is
// throwaway and gets replaced once real features arrive.
function App() {
  const [state, setState] = useState({ loading: true })

  useEffect(() => {
    fetch('/api/health')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => setState({ loading: false, data }))
      .catch((err) => setState({ loading: false, error: err.message }))
  }, [])

  const dbConnected = state.data?.db === 'connected'

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 560 }}>
      <h1>SparkPOS</h1>
      <p style={{ color: '#666' }}>Phase 0 — full-stack connectivity check</p>

      <section
        style={{
          marginTop: '1.5rem',
          padding: '1rem 1.25rem',
          border: '1px solid #ddd',
          borderRadius: 8,
        }}
      >
        {state.loading && <p>Checking backend…</p>}

        {state.error && (
          <div>
            <strong style={{ color: '#c0392b' }}>✗ Backend unreachable</strong>
            <p style={{ color: '#666', marginBottom: 0 }}>
              {state.error}. Is the backend running on port 5000?
            </p>
          </div>
        )}

        {state.data && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, lineHeight: 1.8 }}>
            <li>
              <strong>API:</strong>{' '}
              <span style={{ color: '#27ae60' }}>✓ reachable ({state.data.status})</span>
            </li>
            <li>
              <strong>Database:</strong>{' '}
              <span style={{ color: dbConnected ? '#27ae60' : '#c0392b' }}>
                {dbConnected ? '✓' : '✗'} {state.data.db}
              </span>
            </li>
            <li>
              <strong>Server time:</strong> {state.data.time}
            </li>
          </ul>
        )}
      </section>
    </main>
  )
}

export default App
