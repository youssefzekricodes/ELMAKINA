import type { ActionDef } from '../theme';
import type { GameState } from './store';

export function validTargets(state: GameState, me: string | null, action: ActionDef) {
  return state.players.filter((p) => {
    if (!p.alive) return false;
    if (action.target === 'any') return true;
    if (p.id === me) return false;
    if (action.target === 'rich') return p.coins > 7;
    if (action.target === 'coins') return p.coins > 0;
    return true;
  }).map((p) => p.id);
}
