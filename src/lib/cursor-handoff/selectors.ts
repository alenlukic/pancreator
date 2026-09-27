/**
 * The one table of Cursor accessibility labels and roles, plus pure matching
 * functions over a snapshot tree. No UI state is mutated here.
 *
 * Cursor can rename a label or restructure the tree in any release. The self-
 * check and the distinct error codes make a break visible. This file is the
 * one place to repair a broken selector.
 */

/** One node from the helper's snapshot tree. */
export interface SnapNode {
  id: string
  parent_id?: string
  role?: string
  subrole?: string
  title?: string
  description?: string
  value?: string
}

// ---------------------------------------------------------------------------
// Selector patterns
// ---------------------------------------------------------------------------

/** Title of the Cursor Agents window. */
export const AGENTS_WINDOW_TITLE = 'Cursor Agents'

/** Title or description of the New Chat button. */
export const NEW_CHAT_LABEL = 'New Chat'

/**
 * A composer is an AXTextArea whose label starts with "Prompt".
 * The match is case-insensitive to tolerate minor Cursor changes.
 */
export const COMPOSER_ROLE = 'AXTextArea'
export const COMPOSER_LABEL_PREFIX = 'Prompt'

/**
 * Model picker: an AXPopUpButton whose title or description matches any of
 * these model-family tokens (case-insensitive). A picker that does not match
 * is not a model picker and is ignored.
 */
export const PICKER_ROLE = 'AXPopUpButton'
export const PICKER_LABEL_PATTERN =
  /opus|sonnet|gpt|composer|claude|gemini|grok|auto/iu

/** The Send button. */
export const SEND_LABEL = 'Send message'

/** Menu item labels used to select model and effort. */
export const MODEL_MENU_ITEM = 'Model'
export const EFFORT_MENU_ITEM = 'Effort'

/**
 * Roles that indicate the Agents window is busy (a menu or dialog is open).
 * The driver aborts with HANDOFF_UI_BUSY when any of these appear.
 */
export const BUSY_ROLES = new Set(['AXMenu', 'AXSheet'])
export const BUSY_SUBROLES = new Set(['AXDialogSubrole'])

/** Maximum ancestor levels to climb when searching for a picker scope. */
export const PICKER_ANCESTOR_LIMIT = 12

// ---------------------------------------------------------------------------
// Pure matching functions
// ---------------------------------------------------------------------------

/** All nodes that descend from `parentId` (direct children only). */
export function childrenOf(nodes: SnapNode[], parentId: string): SnapNode[] {
  return nodes.filter((n) => n.parent_id === parentId)
}

/** All nodes that are descendants of `rootId` at any depth. */
export function descendantsOf(nodes: SnapNode[], rootId: string): SnapNode[] {
  const result: SnapNode[] = []
  const queue = [rootId]

  while (queue.length > 0) {
    const id = queue.shift() as string
    const kids = childrenOf(nodes, id)

    for (const kid of kids) {
      result.push(kid)
      queue.push(kid.id)
    }
  }

  return result
}

/** Find the root node of the snapshot (no parent_id). */
export function rootOf(nodes: SnapNode[]): SnapNode | undefined {
  return nodes.find((n) => n.parent_id === undefined)
}

/** True when the Agents window snapshot shows a busy state. */
export function isBusy(nodes: SnapNode[]): boolean {
  return nodes.some(
    (n) =>
      (n.role !== undefined && BUSY_ROLES.has(n.role)) ||
      (n.subrole !== undefined && BUSY_SUBROLES.has(n.subrole)),
  )
}

/** Find the New Chat button among `nodes`. */
export function findNewChat(nodes: SnapNode[]): SnapNode | undefined {
  return nodes.find(
    (n) =>
      n.role === 'AXButton' &&
      (n.title === NEW_CHAT_LABEL || n.description === NEW_CHAT_LABEL),
  )
}

/**
 * Find all composer elements. A composer is an AXTextArea whose title or
 * description starts with "Prompt" (case-insensitive).
 */
export function findComposers(nodes: SnapNode[]): SnapNode[] {
  return nodes.filter(
    (n) =>
      n.role === COMPOSER_ROLE &&
      ((n.title ?? '')
        .toLowerCase()
        .startsWith(COMPOSER_LABEL_PREFIX.toLowerCase()) ||
        (n.description ?? '')
          .toLowerCase()
          .startsWith(COMPOSER_LABEL_PREFIX.toLowerCase())),
  )
}

/**
 * Find all model pickers in `scope`. A picker is an AXPopUpButton whose
 * title or description matches the picker label pattern.
 */
export function findPickers(scope: SnapNode[]): SnapNode[] {
  return scope.filter(
    (n) =>
      n.role === PICKER_ROLE &&
      (PICKER_LABEL_PATTERN.test(n.title ?? '') ||
        PICKER_LABEL_PATTERN.test(n.description ?? '')),
  )
}

/**
 * Walk up the ancestor chain from `startId` up to `limit` levels, collecting
 * all descendants of each ancestor into a scope. Returns the first scope that
 * contains exactly one model picker.
 */
export function findPickerInAncestorScope(
  nodes: SnapNode[],
  startId: string,
  limit: number = PICKER_ANCESTOR_LIMIT,
): { picker: SnapNode; scope: SnapNode[] } | undefined {
  const indexById = new Map(nodes.map((n) => [n.id, n]))
  let currentId: string | undefined = startId

  for (let i = 0; i < limit; i++) {
    const current = indexById.get(currentId ?? '')
    if (!current) break

    const scope = [current, ...descendantsOf(nodes, current.id)]
    const pickers = findPickers(scope)

    if (pickers.length === 1) {
      return { picker: pickers[0] as SnapNode, scope }
    }

    currentId = current.parent_id
  }

  return undefined
}

/**
 * Name the failure when `findPickerInAncestorScope` finds no single picker:
 * ambiguous when some ancestor scope within the limit holds more than one
 * model picker, missing otherwise.
 */
export function missingPickerCode(
  nodes: SnapNode[],
  startId: string,
  limit: number = PICKER_ANCESTOR_LIMIT,
): 'HANDOFF_PICKER_AMBIGUOUS' | 'HANDOFF_PICKER_MISSING' {
  const indexById = new Map(nodes.map((n) => [n.id, n]))
  let currentId: string | undefined = startId

  for (let i = 0; i < limit; i++) {
    const current = indexById.get(currentId ?? '')
    if (!current) break

    const scope = [current, ...descendantsOf(nodes, current.id)]

    if (findPickers(scope).length > 1) {
      return 'HANDOFF_PICKER_AMBIGUOUS'
    }

    currentId = current.parent_id
  }

  return 'HANDOFF_PICKER_MISSING'
}

/** Find the Send message button within `scope`. */
export function findSend(scope: SnapNode[]): SnapNode | undefined {
  return scope.find(
    (n) =>
      n.role === 'AXButton' &&
      (n.title === SEND_LABEL || n.description === SEND_LABEL),
  )
}

/**
 * Find Model and Effort menu items among the descendants of a popup button
 * after its menu has been opened. Menu items are AXMenuItem nodes.
 */
export function findMenuItems(
  nodes: SnapNode[],
  pickerScope: SnapNode[],
): { model: SnapNode | undefined; effort: SnapNode | undefined } {
  const scopeIds = new Set(pickerScope.map((n) => n.id))
  const inScope = nodes.filter((n) => scopeIds.has(n.id))

  const model = inScope.find(
    (n) =>
      n.role === 'AXMenuItem' &&
      (n.title === MODEL_MENU_ITEM || n.description === MODEL_MENU_ITEM),
  )
  const effort = inScope.find(
    (n) =>
      n.role === 'AXMenuItem' &&
      (n.title === EFFORT_MENU_ITEM || n.description === EFFORT_MENU_ITEM),
  )

  return { model, effort }
}

/**
 * Find all options under a picker menu (AXMenuItem children of an AXMenu
 * that is a descendant of the picker's ancestor scope).
 */
export function findMenuOptions(
  nodes: SnapNode[],
  pickerScope: SnapNode[],
  menuItemId: string,
): SnapNode[] {
  const scopeIds = new Set(pickerScope.map((n) => n.id))
  const inScope = nodes.filter((n) => scopeIds.has(n.id))

  // Find the AXMenu that contains the menu item
  const menuItem = inScope.find((n) => n.id === menuItemId)
  if (!menuItem) return []

  const menu = inScope.find(
    (n) =>
      n.role === 'AXMenu' &&
      childrenOf(inScope, n.id).some((c) => c.id === menuItemId),
  )
  if (!menu) {
    // Try descendants of the menu item's parent
    const parent = inScope.find((n) => n.id === menuItem.parent_id)
    if (!parent) return []
    return childrenOf(inScope, parent.id).filter((n) => n.role === 'AXMenuItem')
  }

  return childrenOf(inScope, menu.id).filter((n) => n.role === 'AXMenuItem')
}

/**
 * Read the current picker label from a fresh snapshot. The label is typically
 * the title of the AXPopUpButton.
 */
export function pickerLabel(
  nodes: SnapNode[],
  pickerId: string,
): string | undefined {
  const picker = nodes.find((n) => n.id === pickerId)
  return picker?.title ?? picker?.description
}

// ---------------------------------------------------------------------------
// Capture-tree redaction
// ---------------------------------------------------------------------------

/**
 * Whether a label on a node of `role` is one the selector table matches. Each
 * pattern counts only on the role its selector reads, so a chat title that
 * happens to contain a model name or start with "Prompt" is still redacted.
 */
function selectorLabel(role: string | undefined, text: string): boolean {
  switch (role) {
    case 'AXWindow':
      return text === AGENTS_WINDOW_TITLE
    case 'AXButton':
      return text === NEW_CHAT_LABEL || text === SEND_LABEL
    case COMPOSER_ROLE:
      return text.toLowerCase().startsWith(COMPOSER_LABEL_PREFIX.toLowerCase())
    case PICKER_ROLE:
      return PICKER_LABEL_PATTERN.test(text)
    case 'AXMenuItem':
      return text === MODEL_MENU_ITEM || text === EFFORT_MENU_ITEM
    default:
      return false
  }
}

/**
 * Redact a snapshot for storage as a test fixture. Roles are kept. A label is
 * kept only when the selector table matches it on that node's role. Every
 * other label and every value is replaced with `<redacted>`.
 */
export function redactSnapshot(nodes: SnapNode[]): SnapNode[] {
  return nodes.map((n) => {
    const keep = (text: string | undefined): string | undefined => {
      if (text === undefined) return undefined
      return selectorLabel(n.role, text) ? text : '<redacted>'
    }

    return {
      ...n,
      title: keep(n.title),
      description: keep(n.description),
      value: n.value !== undefined ? '<redacted>' : undefined,
    }
  })
}
