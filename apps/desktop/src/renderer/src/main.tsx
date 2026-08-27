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
import { KanbanBoard } from './components/kanban-board.js';
import { ActionsPage } from './routes/actions.js';
import { BoardPage } from './routes/board.js';
import { AgentPage } from './routes/agent.js';
import { ChatPage } from './routes/chat.js';
import { CodePage } from './routes/code.js';
import { MemoryPage } from './routes/memory.js';
import { PluginsPage } from './routes/plugins.js';
import { ProvidersPage } from './routes/settings/providers.js';
import { RoutinesPage } from './routes/routines.js';
import { SwarmPage } from './routes/swarm.js';
import { TodayPage } from './routes/today.js';
import { ProjectsPage } from './routes/projects.js';
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
const providersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/providers',
  component: ProvidersPage,
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
const agentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agent',
  component: AgentPage,
});
const codeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/code',
  component: CodePage,
});
const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plugins',
  component: PluginsPage,
});
const routinesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/routines',
  component: RoutinesPage,
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
  agentRoute,
  codeRoute,
  pluginsRoute,
  routinesRoute,
  providersRoute,
]);
const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ['/'] }),
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root === null) throw new Error('Renderer root element is missing');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
