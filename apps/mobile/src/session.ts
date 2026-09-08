import type {
  RemoteArtifact,
  RemoteEvent,
  RemoteStatus,
} from '@builderhelm/protocol/remote';

export type CompanionConnection = 'disconnected' | 'stale' | 'connected';

export class CompanionSession {
  connection: CompanionConnection = 'disconnected';
  status: RemoteStatus | null = null;
  artifacts: RemoteArtifact[] = [];
  lastSeq = 0;
  error: string | null = null;

  applyStatus(status: RemoteStatus): void {
    this.status = status;
    this.connection = 'connected';
    this.error = null;
  }

  applyArtifacts(artifacts: readonly RemoteArtifact[]): void {
    this.artifacts = [...artifacts];
    this.connection = 'connected';
  }

  applyEvents(events: readonly RemoteEvent[]): void {
    for (const event of events) {
      if (event.seq > this.lastSeq) this.lastSeq = event.seq;
    }
    this.connection = 'connected';
  }

  markStale(): void {
    if (this.connection === 'connected') this.connection = 'stale';
  }

  markDisconnected(message = 'Host disconnected'): void {
    this.connection = 'disconnected';
    this.error = message;
  }
}
