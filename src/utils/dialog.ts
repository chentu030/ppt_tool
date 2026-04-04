type DialogType = 'alert' | 'confirm';

export interface DialogConfig {
  type: DialogType;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (value: boolean) => void;
}

let _listener: ((cfg: DialogConfig | null) => void) | null = null;

export function _setDialogListener(fn: (cfg: DialogConfig | null) => void) {
  _listener = fn;
}

function open(cfg: Omit<DialogConfig, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    if (!_listener) {
      // Fallback to browser dialogs if provider not mounted
      if (cfg.type === 'confirm') resolve(window.confirm(cfg.message));
      else { alert(cfg.message); resolve(true); }
      return;
    }
    _listener({ ...cfg, resolve });
  });
}

export const showAlert = (message: string, title?: string): Promise<void> =>
  open({ type: 'alert', message, title }).then(() => undefined);

export const showConfirm = (message: string, title?: string, confirmLabel?: string, cancelLabel?: string): Promise<boolean> =>
  open({ type: 'confirm', message, title, confirmLabel, cancelLabel });
