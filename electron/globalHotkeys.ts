export type GlobalHotkeyAction =
  | 'playPause'
  | 'nextTrack'
  | 'prevTrack'
  | 'toggleKaraoke'
  | 'cycleVisualizerTheme'
  | 'jumpBack5s'
  | 'toggleFullscreenAmbient';

export const GLOBAL_HOTKEY_ACTIONS: readonly GlobalHotkeyAction[] = [
  'playPause',
  'nextTrack',
  'prevTrack',
  'toggleKaraoke',
  'cycleVisualizerTheme',
  'jumpBack5s',
  'toggleFullscreenAmbient',
] as const;

export const DEFAULT_GLOBAL_HOTKEYS: Record<GlobalHotkeyAction, string> = {
  playPause: 'CommandOrControl+Alt+P',
  nextTrack: 'CommandOrControl+Alt+Right',
  prevTrack: 'CommandOrControl+Alt+Left',
  toggleKaraoke: 'CommandOrControl+Alt+K',
  cycleVisualizerTheme: 'CommandOrControl+Alt+V',
  jumpBack5s: 'CommandOrControl+Alt+J',
  toggleFullscreenAmbient: 'CommandOrControl+Alt+F',
};

export const GLOBAL_HOTKEY_LABELS: Record<GlobalHotkeyAction, string> = {
  playPause: 'Play / Pause',
  nextTrack: 'Next Track',
  prevTrack: 'Previous Track',
  toggleKaraoke: 'Toggle Karaoke Mode',
  cycleVisualizerTheme: 'Cycle Visualizer Theme',
  jumpBack5s: 'Jump Back 5s',
  toggleFullscreenAmbient: 'Toggle Fullscreen Ambient',
};

export interface GlobalShortcutAdapter {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  unregisterAll: () => void;
  isRegistered?: (accelerator: string) => boolean;
}

export interface GlobalHotkeyConfig {
  enabled: boolean;
  bindings: Partial<Record<GlobalHotkeyAction, string>>;
}

export interface GlobalHotkeyStatus {
  enabled: boolean;
  bindings: Record<GlobalHotkeyAction, string>;
  registered: Partial<Record<GlobalHotkeyAction, string>>;
  conflicts: Partial<Record<GlobalHotkeyAction, string>>;
}

export function normalizeAccelerator(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const modifiers: string[] = [];
  let key = '';
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === 'ctrl' || low === 'control' || low === 'commandorcontrol' || low === 'cmdorctrl') {
      if (!modifiers.includes('CommandOrControl')) modifiers.push('CommandOrControl');
    } else if (low === 'alt' || low === 'option') {
      if (!modifiers.includes('Alt')) modifiers.push('Alt');
    } else if (low === 'shift') {
      if (!modifiers.includes('Shift')) modifiers.push('Shift');
    } else if (low === 'meta' || low === 'super' || low === 'cmd' || low === 'command') {
      if (!modifiers.includes('Super')) modifiers.push('Super');
    } else {
      key = part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    }
  }
  if (!key) return '';
  return [...modifiers, key].join('+');
}

export class GlobalHotkeyManager {
  private readonly shortcut: GlobalShortcutAdapter;
  private readonly onTrigger: (action: GlobalHotkeyAction) => void;
  private enabled = true;
  private bindings: Record<GlobalHotkeyAction, string> = { ...DEFAULT_GLOBAL_HOTKEYS };
  private registered: Partial<Record<GlobalHotkeyAction, string>> = {};
  private conflicts: Partial<Record<GlobalHotkeyAction, string>> = {};

  constructor(
    shortcut: GlobalShortcutAdapter,
    onTrigger: (action: GlobalHotkeyAction) => void
  ) {
    this.shortcut = shortcut;
    this.onTrigger = onTrigger;
  }

  public applyConfig(cfg: Partial<GlobalHotkeyConfig>): GlobalHotkeyStatus {
    this.unregisterAll();

    if (typeof cfg.enabled === 'boolean') {
      this.enabled = cfg.enabled;
    }

    const nextBindings: Record<GlobalHotkeyAction, string> = { ...this.bindings };
    if (cfg.bindings && typeof cfg.bindings === 'object') {
      for (const action of GLOBAL_HOTKEY_ACTIONS) {
        if (action in cfg.bindings) {
          const val = cfg.bindings[action];
          nextBindings[action] = val ? normalizeAccelerator(val) : '';
        }
      }
    }
    this.bindings = nextBindings;
    this.registered = {};
    this.conflicts = {};

    if (!this.enabled) {
      return this.getStatus();
    }

    const usedAccelerators = new Map<string, GlobalHotkeyAction>();
    for (const action of GLOBAL_HOTKEY_ACTIONS) {
      const accel = this.bindings[action];
      if (!accel) continue;

      const canonical = accel.toLowerCase();
      const dupAction = usedAccelerators.get(canonical);
      if (dupAction) {
        this.conflicts[action] = `Duplicate shortcut already assigned to ${GLOBAL_HOTKEY_LABELS[dupAction]}`;
        continue;
      }

      try {
        const ok = this.shortcut.register(accel, () => {
          this.onTrigger(action);
        });
        if (ok) {
          usedAccelerators.set(canonical, action);
          this.registered[action] = accel;
        } else {
          this.conflicts[action] = `Shortcut "${accel}" is unavailable or claimed by another app`;
        }
      } catch (err) {
        this.conflicts[action] =
          err instanceof Error ? err.message : `Failed to register "${accel}"`;
      }
    }

    return this.getStatus();
  }

  public resetDefaults(): GlobalHotkeyStatus {
    return this.applyConfig({
      enabled: true,
      bindings: { ...DEFAULT_GLOBAL_HOTKEYS },
    });
  }

  public getStatus(): GlobalHotkeyStatus {
    return {
      enabled: this.enabled,
      bindings: { ...this.bindings },
      registered: { ...this.registered },
      conflicts: { ...this.conflicts },
    };
  }

  public unregisterAll(): void {
    for (const accel of Object.values(this.registered)) {
      if (!accel) continue;
      try {
        this.shortcut.unregister(accel);
      } catch {
        // Ignore OS unregister errors during teardown
      }
    }
    this.registered = {};
  }
}
