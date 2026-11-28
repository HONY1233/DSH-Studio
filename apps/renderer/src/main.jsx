import React, { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { selectRendererEntry } from './workbench/entry.js'
import './styles.css'

const WorkbenchApp = lazy(() => import('./workbench/WorkbenchApp.jsx'))
const entry = selectRendererEntry(window.location.search)

createRoot(document.getElementById('root')).render(
  <Suspense fallback={null}>
    {entry === 'workbench' ? <WorkbenchApp /> : <App />}
  </Suspense>,
)
