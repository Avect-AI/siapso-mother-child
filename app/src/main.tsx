// SPDX-License-Identifier: MIT
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ServiceWorkerUpdate } from './pwa/ServiceWorkerUpdate.js';
import { AppProvider } from './state/app-state.js';
import './styles/tokens.css';
import './styles/base.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root element');
}
const root = createRoot(container);

function show(node: ReactNode) {
  root.render(<StrictMode>{node}</StrictMode>);
}

// The design gallery exists only in development: in a production build
// import.meta.env.DEV is false, so this branch and the gallery chunk are dropped.
if (import.meta.env.DEV && window.location.hash === '#/design') {
  void import('./design/Gallery.js').then(({ Gallery }) => {
    show(<Gallery />);
  });
} else {
  show(
    <AppProvider>
      <App>
        <ServiceWorkerUpdate />
      </App>
    </AppProvider>,
  );
}
