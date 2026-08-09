import { utcNow, type CorrelationId } from '@zero/shared';

import { redact } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

export interface LogInput {
  readonly event: string;
  readonly correlationId: CorrelationId;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface Logger {
  debug(input: LogInput): void;
  info(input: LogInput): void;
  warn(input: LogInput): void;
  error(input: LogInput): void;
}

export function createLogger(sink: LogSink = console.log): Logger {
  const write = (level: LogLevel, input: LogInput): void => {
    const record = {
      timestamp: utcNow(),
      level,
      event: input.event,
      correlationId: input.correlationId,
      ...(input.data === undefined ? {} : { data: redact(input.data) }),
    };

    sink(JSON.stringify(record));
  };

  return {
    debug: (input) => write('debug', input),
    info: (input) => write('info', input),
    warn: (input) => write('warn', input),
    error: (input) => write('error', input),
  };
}
