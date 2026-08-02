import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { todayInSeoul } from './lib/dateNav'
import { fetchKeywordGraph } from './lib/queries'
import { stateFromUrl } from './lib/urlState'

// Fire the first graph request **before** React mounts.
//
// Everything on the first screen comes from this one RPC, and until now that
// request waited for createRoot, the first render and an effect before it went
// out. index.html's preconnect has finished the DNS, TCP and TLS by then, so
// firing here goes straight out over a connection that is already open.
//
// App receives **this very response**, and the query cache is what makes that
// true: the same arguments hand back the same promise, so the request is not
// issued twice and the object's identity is shared, which means the layout runs
// once too. Without the cache this line would only add a request.
//
// The category is read from the URL before the slug list exists — parseUrlState
// treats an empty list as "not yet known", so a slug carried in a shared link
// passes through and App re-checks it once the categories arrive. Asking for a
// slug that turns out not to exist wastes one response that nobody reads; it
// cannot change what is drawn.
{
  const state = stateFromUrl()
  // Swallow the failure. This is only a head start; surfacing errors is App's
  // request's job, and the cache does not keep rejections, so that one retries
  // properly.
  void fetchKeywordGraph(state.date ?? todayInSeoul(), state.category).catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
