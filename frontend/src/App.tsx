import { useState } from 'react'

const BACKEND = 'http://localhost:1946'

function App() {
  const [project, setProject] = useState('demo')
  const [prompt, setPrompt] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)

  async function submit() {
    setOutput('')
    setRunning(true)

    const created = await fetch(`${BACKEND}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: project }),
    })
    if (!created.ok && created.status !== 409) {
      setOutput(`Failed to create project: ${await created.text()}`)
      setRunning(false)
      return
    }

    const taskRes = await fetch(`${BACKEND}/projects/${project}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    if (!taskRes.ok) {
      setOutput(`Failed to create task: ${await taskRes.text()}`)
      setRunning(false)
      return
    }
    const { run_id } = await taskRes.json()

    const ws = new WebSocket(`ws://localhost:1946/runs/${run_id}/stream`)
    ws.onmessage = (event) => setOutput((prev) => prev + event.data)
    ws.onclose = () => setRunning(false)
    ws.onerror = () => setRunning(false)
  }

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Eniac</h1>

      <label>
        Project
        <br />
        <input value={project} onChange={(e) => setProject(e.target.value)} />
      </label>

      <p>
        <label>
          Prompt
          <br />
          <textarea
            rows={4}
            style={{ width: '100%' }}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
      </p>

      <button onClick={submit} disabled={running || !prompt}>
        {running ? 'Running…' : 'Send'}
      </button>

      <pre
        style={{
          marginTop: '1rem',
          padding: '1rem',
          background: '#f4f3ec',
          minHeight: '10rem',
          whiteSpace: 'pre-wrap',
        }}
      >
        {output}
      </pre>
    </main>
  )
}

export default App
