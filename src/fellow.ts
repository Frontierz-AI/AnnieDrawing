import { createBoard, type BoardOptions } from './board';
import type { AgentPresenceOptions, ApplyOptions, ApplyResult, ChangeLog } from './core/types';

export type { AgentPresenceOptions, ApplyOptions, ApplyResult, BoardOptions, ChangeLog };

export interface FellowBoardOptions extends BoardOptions {
  fellowName?: string;
}

export function createFellowBoard(host: HTMLElement, options: FellowBoardOptions = {}) {
  const { fellowName, ...rest } = options;
  return createBoard(host, {
    agentHistory: 'hidden',
    agentReveal: 'fit',
    agentPlaceGap: 120,
    agentPresence: { maxStops: 3, durationScale: 0.55 },
    exposeGlobal: false,
    unfurl: false,
    ui: { menu: false, export: false, pages: false },
    ...rest,
    agentName: rest.agentName ?? fellowName,
  });
}
