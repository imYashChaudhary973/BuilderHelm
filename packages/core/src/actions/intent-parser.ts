import type { ActionRepository, StoredProject, StoredTask } from '@builderhelm/db';
import type { JsonValue } from '@builderhelm/protocol/json';
import type { WorkToolId } from '@builderhelm/protocol/actions';

export interface ParsedActionIntent {
  readonly toolId: WorkToolId;
  readonly input: JsonValue;
}

export function normalizeWorkName(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function projectFromStart(
  rawValue: string,
  projects: readonly StoredProject[],
): { project: StoredProject; remainder: string } | null {
  const candidates = [...projects].sort(
    (left, right) => right.name.length - left.name.length,
  );
  const values = [rawValue, rawValue.replace(/^project\s+/i, '')];
  for (const value of values) {
    for (const project of candidates) {
      const pattern = new RegExp(
        `^${escapeRegExp(project.name).replace(/\s+/g, '\\s+')}(?=$|\\s|[:—-])`,
        'i',
      );
      const match = pattern.exec(value);
      if (match === null) continue;
      return {
        project,
        remainder: value.slice(match[0].length).trim(),
      };
    }
  }
  return null;
}

function localEndOfDay(now: Date, days: number): string {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  value.setHours(23, 59, 59, 999);
  return value.toISOString();
}

function dueDate(value: string, now: Date): { title: string; dueAt: string | null } {
  let title = value
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
  const relative = /\s+(?:(?:due|for|by)\s+)?(today|tomorrow)$/i.exec(title);
  if (relative !== null) {
    title = title.slice(0, relative.index).trim();
    return {
      title,
      dueAt: localEndOfDay(now, relative[1]!.toLocaleLowerCase() === 'tomorrow' ? 1 : 0),
    };
  }
  const absolute = /\s+(?:(?:due|for|by)\s+)?(\d{4}-\d{2}-\d{2})$/.exec(title);
  if (absolute !== null) {
    const [year, month, day] = absolute[1]!.split('-').map(Number);
    const parsed = new Date(year!, month! - 1, day!, 23, 59, 59, 999);
    if (
      parsed.getFullYear() === year &&
      parsed.getMonth() === month! - 1 &&
      parsed.getDate() === day
    ) {
      title = title.slice(0, absolute.index).trim();
      return { title, dueAt: parsed.toISOString() };
    }
  }
  return { title, dueAt: null };
}

function resolveTask(value: string, repository: ActionRepository): StoredTask | null {
  const unquoted = value.trim().replace(/^["']|["']$/g, '');
  const byId = repository.findTaskById(unquoted);
  if (byId !== undefined) return byId;
  const matches = repository.findTasksByNormalizedTitle(normalizeWorkName(unquoted));
  return matches.length === 1 ? matches[0]! : null;
}

function status(value: string): StoredTask['status'] | null {
  switch (normalizeWorkName(value)) {
    case 'todo':
    case 'to do':
    case 'reopen':
      return 'todo';
    case 'in progress':
    case 'started':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'done':
    case 'complete':
    case 'completed':
      return 'done';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return null;
  }
}

export function parseDeterministicAction(
  text: string,
  repository: ActionRepository,
  now: Date,
): ParsedActionIntent | null {
  const command = text.normalize('NFKC').trim();
  const projects = repository.listProjects();

  const createProject =
    /^(?:create|add)\s+(?:a\s+)?project(?:\s+(?:named|called))?\s+(.+?)[.!]?$/i.exec(
      command,
    );
  if (createProject !== null) {
    return {
      toolId: 'project.create',
      input: { name: createProject[1]!.trim().replace(/^["']|["']$/g, '') },
    };
  }

  const createTask =
    /^(?:add|create)\s+(?:a\s+)?(?:(low|medium|high)(?:[- ]priority)?\s+)?task\s+(?:to|in|for)\s+(.+)$/i.exec(
      command,
    );
  if (createTask !== null) {
    const target = projectFromStart(createTask[2]!, projects);
    if (target === null) return null;
    const rawTitle = target.remainder.replace(/^(?:to\s+|[:—-]\s*)/i, '');
    const parsedDue = dueDate(rawTitle, now);
    if (parsedDue.title.length === 0) return null;
    return {
      toolId: 'task.create',
      input: {
        projectId: target.project.id,
        title: parsedDue.title,
        priority: (createTask[1]?.toLocaleLowerCase() ?? 'medium') as
          'low' | 'medium' | 'high',
        dueAt: parsedDue.dueAt,
      },
    };
  }

  const addDecision = /^add\s+(?:a\s+)?decision\s+(?:to|for|in)\s+(.+)$/i.exec(command);
  if (addDecision !== null) {
    const target = projectFromStart(addDecision[1]!, projects);
    if (target === null) return null;
    const title = target.remainder.replace(/^(?:that\s+|[:—-]\s*)/i, '').trim();
    if (title.length === 0) return null;
    return {
      toolId: 'project.add_decision',
      input: { projectId: target.project.id, title: title.replace(/[.!]+$/, '') },
    };
  }

  const projectStatus =
    /^(?:show|get|what(?:'s| is))\s+(?:the\s+)?status\s+(?:of|for)\s+(.+?)[?!.]?$/i.exec(
      command,
    );
  if (projectStatus !== null) {
    const target = projectFromStart(projectStatus[1]!, projects);
    if (target !== null && target.remainder.replace(/[?!.]/g, '').trim().length === 0) {
      return { toolId: 'project.get_status', input: { projectId: target.project.id } };
    }
  }

  const listTasks =
    /^(?:list|show)\s+(?:my\s+)?tasks(?:\s+(?:for|in)\s+(.+?))?[?!.]?$/i.exec(command);
  if (listTasks !== null) {
    if (listTasks[1] === undefined) return { toolId: 'task.list', input: {} };
    const target = projectFromStart(listTasks[1], projects);
    if (target !== null && target.remainder.replace(/[?!.]/g, '').trim().length === 0) {
      return { toolId: 'task.list', input: { projectId: target.project.id } };
    }
  }

  const updateTask =
    /^mark\s+(?:task\s+)?(.+?)\s+(todo|to do|in progress|started|blocked|done|complete|completed|cancelled|canceled|reopen)[.!]?$/i.exec(
      command,
    );
  if (updateTask !== null) {
    const task = resolveTask(updateTask[1]!, repository);
    const nextStatus = status(updateTask[2]!);
    if (task !== null && nextStatus !== null) {
      return {
        toolId: 'task.update',
        input: { taskId: task.id, status: nextStatus },
      };
    }
  }

  return null;
}
