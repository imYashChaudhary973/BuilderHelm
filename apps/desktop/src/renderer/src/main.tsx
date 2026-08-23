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
import { ActionsPage } from './routes/actions.js';
import { BoardPage } from './routes/board.js';
import { ChatPage } from './routes/chat.js';
import { KnowledgePage } from './routes/knowledge.js';
import { ProvidersPage } from './routes/settings/providers.js';
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
const knowledgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/knowledge',
  component: KnowledgePage,
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
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/board',
  component: BoardPage,
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  todayRoute,
  chatRoute,
  knowledgeRoute,
  actionsRoute,
  projectsRoute,
  boardRoute,
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
