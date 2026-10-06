import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ConsultaTaxaAdm from './pages/ConsultaTaxaAdm.jsx'
import { ToastProvider } from './components/Toast'

// /consulta/taxa-adm?t=… é a página pública (somente leitura) da Taxa ADM;
// todo o resto é o app normal, com login.
const isConsulta = window.location.pathname.replace(/\/+$/, '') === '/consulta/taxa-adm'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConsulta ? <ToastProvider><ConsultaTaxaAdm /></ToastProvider> : <App />}
  </StrictMode>,
)
