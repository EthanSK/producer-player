const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildTextEditingContextMenuTemplate,
} = require('../dist/context-menu.test.cjs');

function roles(template) {
  return template.map((item) => item.type === 'separator' ? 'separator' : item.role);
}

function enabledByRole(template, role) {
  const item = template.find((candidate) => candidate.role === role);
  return item?.enabled;
}

test('editable fields get the standard text editing context menu', () => {
  const template = buildTextEditingContextMenuTemplate({
    isEditable: true,
    selectionText: 'selected text',
    editFlags: {
      canUndo: true,
      canRedo: false,
      canCut: true,
      canCopy: true,
      canPaste: true,
      canDelete: true,
      canSelectAll: true,
    },
  });

  assert.deepEqual(roles(template), [
    'undo',
    'redo',
    'separator',
    'cut',
    'copy',
    'paste',
    'delete',
    'separator',
    'selectAll',
  ]);
  assert.equal(enabledByRole(template, 'paste'), true);
});

test('editable fields keep Paste visible but disabled when Chromium says paste is unavailable', () => {
  const template = buildTextEditingContextMenuTemplate({
    isEditable: true,
    editFlags: {
      canPaste: false,
      canSelectAll: true,
    },
  });

  // The disabled visible Paste item is deliberate: it matches native text menus
  // and prevents the right-click menu from seeming to disappear just because
  // the clipboard cannot currently paste into that field.
  assert.equal(enabledByRole(template, 'paste'), false);
  assert.equal(enabledByRole(template, 'selectAll'), true);
});

test('selected read-only text gets a small copy menu', () => {
  const template = buildTextEditingContextMenuTemplate({
    isEditable: false,
    selectionText: 'Track title',
    editFlags: {
      canCopy: true,
      canSelectAll: true,
    },
  });

  assert.deepEqual(roles(template), ['copy', 'separator', 'selectAll']);
});

test('non-editable empty background does not show a blank context menu', () => {
  assert.deepEqual(
    buildTextEditingContextMenuTemplate({
      isEditable: false,
      selectionText: '',
      editFlags: {
        canSelectAll: true,
      },
    }),
    []
  );
});
