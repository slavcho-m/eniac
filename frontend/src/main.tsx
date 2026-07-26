import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// No StrictMode: its dev-only double-invoke of effects opened two WebSocket connections
// per run against the backend's single per-run message queue, and the abandoned first
// connection could silently steal the run's one real message from the live second one —
// removed rather than chased further, per user's call.
createRoot(document.getElementById("root")!).render(<App />);
