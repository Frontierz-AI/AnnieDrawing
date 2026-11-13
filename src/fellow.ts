import { createBoard, type BoardOptions } from './board';
import type {
  AgentPresenceOptions,
  ApplyOptions,
  ApplyResult,
  BoardPointer,
  ChangeLog,
} from './core/types';

export type {
  AgentPresenceOptions,
  ApplyOptions,
  ApplyResult,
  BoardOptions,
  BoardPointer,
  ChangeLog,
};

export interface FellowBoardOptions extends BoardOptions {
  fellowName?: string;
}

export function createFellowBoard(host: HTMLElement, options: FellowBoardOptions = {}) {
  const { fellowName, ...rest } = options;
  const pace = { maxStops: 3, durationScale: 0.55 };
  return createBoard(host, {
    agentHistory: 'hidden',
    agentReveal: 'created',
    agentPlaceGap: 120,
    exposeGlobal: false,
    unfurl: false,
    ui: { menu: false, export: false, pages: false },
    ...rest,
    // An options object keeps the Fellow pace for the fields it omits, so `{ write: true }` is enough.
    agentPresence:
      typeof rest.agentPresence === 'object'
        ? { ...pace, ...rest.agentPresence }
        : (rest.agentPresence ?? pace),
    agentName: rest.agentName ?? fellowName,
  });
}
