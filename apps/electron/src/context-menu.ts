import type { MenuItemConstructorOptions } from 'electron';

export interface TextEditingContextMenuEditFlags {
  canUndo?: boolean;
  canRedo?: boolean;
  canCut?: boolean;
  canCopy?: boolean;
  canPaste?: boolean;
  canDelete?: boolean;
  canSelectAll?: boolean;
}

export interface TextEditingContextMenuParams {
  isEditable: boolean;
  selectionText?: string;
  editFlags?: TextEditingContextMenuEditFlags;
}

const EMPTY_EDIT_FLAGS: Required<TextEditingContextMenuEditFlags> = {
  canUndo: false,
  canRedo: false,
  canCut: false,
  canCopy: false,
  canPaste: false,
  canDelete: false,
  canSelectAll: false,
};

function normalizeEditFlags(
  flags: TextEditingContextMenuEditFlags | undefined
): Required<TextEditingContextMenuEditFlags> {
  return {
    ...EMPTY_EDIT_FLAGS,
    ...flags,
  };
}

export function buildTextEditingContextMenuTemplate(
  params: TextEditingContextMenuParams
): MenuItemConstructorOptions[] {
  const editFlags = normalizeEditFlags(params.editFlags);
  const selectionText = typeof params.selectionText === 'string' ? params.selectionText : '';
  const hasSelection = selectionText.length > 0;

  if (params.isEditable) {
    // Electron gives apps keyboard edit roles for free through the app menu,
    // but it does not automatically install the browser-style right-click menu
    // inside <input>/<textarea>. Build the normal edit surface from Chromium's
    // own editFlags so checklist textareas keep native paste/cut/copy behavior
    // without any renderer-level event hacks.
    return [
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy || hasSelection },
      { role: 'paste', enabled: editFlags.canPaste },
      { role: 'delete', enabled: editFlags.canDelete },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ];
  }

  if (hasSelection) {
    return [
      { role: 'copy', enabled: editFlags.canCopy || hasSelection },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ];
  }

  return [];
}
