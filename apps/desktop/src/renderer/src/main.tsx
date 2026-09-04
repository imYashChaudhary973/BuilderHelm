import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import { BrowserMenuPopup } from './components/browser-menu-popup.js';
import { KanbanBoard } from './components/kanban-board.js';
import { ActionsPage } from './routes/actions.js';
import { AgentsPage } from './routes/agents.js';
import { NotBuilt } from './components/not-built.js';
import { BoardPage } from './routes/board.js';
import { ChatPage } from './routes/chat.js';
import { MemoryPage } from './routes/memory.js';
import { VoicePage } from './routes/settings/voice.js';
import { BrowserSettingsPage } from './routes/settings/browser.js';
import { AccountsPage } from './routes/settings/accounts.js';
import { SwarmPage } from './routes/swarm.js';
import { TodayPage } from './routes/today.js';
import { ProjectsPage } from './routes/projects.js';
import './shaders/threeui.css';
import './styles.css';

const rootRoute = createRootRoute({ component: App });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: BoardPage,
});
const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  component: TodayPage,
});
const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/voice',
  component: VoicePage,
});
const browserSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/browser',
  component: BrowserSettingsPage,
});
const usageSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/usage',
  component: AccountsPage,
});
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: ChatPage,
});
const memoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/memory',
  component: MemoryPage,
});
const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/actions',
  component: ActionsPage,
});
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsPage,
});
const spaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/space',
  component: BoardPage,
});
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  component: KanbanBoard,
});
const swarmRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/swarm',
  component: SwarmPage,
});
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: AgentsPage,
});
/**
 * Rail entries drawn in the redesign that have no feature behind them yet. They
 * route to a panel that says so rather than to a convincing empty dashboard.
 */
const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  component: () => (
    <NotBuilt
      titleId="search-title"
      title="Search"
      summary="One place to find and run anything across workspaces, files, tasks, and commands."
      instead={{
        label: 'Today:',
        detail: 'Memory searches your own notes and answers with citations.',
      }}
    />
  ),
});
const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plugins',
  component: () => (
    <NotBuilt
      titleId="plugins-title"
      title="Plugins"
      summary="Connect accounts like GitHub, Slack, or Notion and let agents act through them with approval."
      instead={{
        label: 'Today:',
        detail: 'GitHub and Linear issues import onto the Board.',
      }}
    />
  ),
});
const skillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/skills',
  component: () => (
    <NotBuilt
      titleId="skills-title"
      title="Skills"
      summary="Reusable instructions an agent loads before it starts, so a way of working survives the run."
    />
  ),
});
const automationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/automations',
  component: () => (
    <NotBuilt
      titleId="automations-title"
      title="Automations"
      summary="Runs that start on a trigger instead of a click, and report back when they finish."
    />
  ),
});
const creditsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/credits',
  component: () => (
    <NotBuilt
      titleId="credits-title"
      title="Credits"
      summary="BuilderHelm has no credit balance. Agents bill through your own provider accounts, and your subscription covers the app itself."
      instead={{
        label: 'Today:',
        detail:
          'Usage shows each provider quota, and Settings holds your plan and devices.',
      }}
    />
  ),
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  chatRoute,
  memoryRoute,
  actionsRoute,
  projectsRoute,
  spaceRoute,
  boardRoute,
  swarmRoute,
  agentsRoute,
  searchRoute,
  pluginsRoute,
  skillsRoute,
  automationsRoute,
  creditsRoute,
  voiceRoute,
  browserSettingsRoute,
  usageSettingsRoute,
]);
const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/agents'] }),
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root === null) throw new Error('Renderer root element is missing');

if (window.location.hash === '#browser-popup') {
  document.documentElement.classList.add('browserPopup');
  createRoot(root).render(
    <StrictMode>
      <BrowserMenuPopup />
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
