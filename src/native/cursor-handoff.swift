#!/usr/bin/env swift
// Cursor Accessibility helper for pan handoff.
//
// This helper provides the low-level Accessibility API surface the TypeScript
// driver uses. It never contains selector logic; that lives exclusively in
// selectors.ts. It never activates an application, opens a URL, or posts a
// key event.
//
// Modes:
//   --serve        Read one JSON request per line on stdin, write one JSON reply per line.
//   --preflight    Print one JSON object and exit (for pan doctor).
//
// Operations (in --serve mode, each line is a JSON object with "op" key):
//   preflight      Platform, AXIsProcessTrusted, Cursor pid, Agents window.
//   snapshot       Breadth-first tree of the Cursor Agents window.
//   press          AXPress on an element by id.
//   set_value      Write AXValue on an element by id.
//   focus_insert   AXFocused then AXSelectedText fallback on an element by id.
//   frontmost      System-wide AXFocusedApplication, read live.

import AppKit
import ApplicationServices
import Foundation

// MARK: - Messaging timeout

private let MESSAGING_TIMEOUT_SECONDS: Double = 1.0
private let COMPOSER_WAIT_SECONDS: Double = 6.0
private let SNAPSHOT_MAX_DEPTH: Int = 60

// MARK: - Output helpers

private func writeJson(_ value: Any) {
  if let data = try? JSONSerialization.data(withJSONObject: value),
     let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}

private func errorReply(_ code: String, _ message: String) -> [String: Any] {
  return ["ok": false, "code": code, "error": message]
}

// MARK: - AX helpers

private func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
  guard result == .success else { return nil }
  return value
}

private func axString(_ element: AXUIElement, _ attribute: String) -> String? {
  guard let v = axValue(element, attribute) else { return nil }
  // CFString bridge
  if CFGetTypeID(v) == CFStringGetTypeID() {
    return v as? String
  }
  return nil
}

private func axBool(_ element: AXUIElement, _ attribute: String) -> Bool? {
  guard let v = axValue(element, attribute) else { return nil }
  if CFGetTypeID(v) == CFBooleanGetTypeID() {
    return CFBooleanGetValue((v as! CFBoolean))
  }
  return nil
}

private func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  guard let v = axValue(element, kAXChildrenAttribute) else { return [] }
  guard CFGetTypeID(v) == CFArrayGetTypeID() else { return [] }
  let arr = v as! CFArray
  var result: [AXUIElement] = []
  for i in 0..<CFArrayGetCount(arr) {
    let item = CFArrayGetValueAtIndex(arr, i)
    result.append(Unmanaged<AXUIElement>.fromOpaque(item!).takeUnretainedValue())
  }
  return result
}

private func axPid(_ element: AXUIElement) -> pid_t? {
  var pid: pid_t = 0
  let result = AXUIElementGetPid(element, &pid)
  guard result == .success else { return nil }
  return pid
}

// MARK: - Element identity

// Every snapshot copies fresh AXUIElement references, so object identity
// differs between snapshots even for the same UI element. Equality is decided
// by CFEqual, bucketed by CFHash. The driver relies on an element keeping its
// id across every snapshot of one helper process: it tells the new chat's
// empty composer apart from the old chat's empty composer that way.

private var knownElements: [CFHashCode: [(element: AXUIElement, id: String)]] = [:]
private var idCounter: Int = 0

private func elementId(_ element: AXUIElement) -> String {
  let hash = CFHash(element)
  if let bucket = knownElements[hash] {
    for entry in bucket where CFEqual(entry.element, element) {
      return entry.id
    }
  }
  idCounter += 1
  let id = "ax-\(idCounter)"
  knownElements[hash, default: []].append((element: element, id: id))
  return id
}

// MARK: - Element registry (elements of the latest snapshot)

// Only elements present in the latest snapshot resolve for press and write,
// so an element that left the tree fails with HANDOFF_ELEMENT_STALE.
private var elementRegistry: [String: AXUIElement] = [:]

private func registerElement(_ element: AXUIElement) -> String {
  let id = elementId(element)
  elementRegistry[id] = element
  return id
}

private func buildRegistry(_ root: AXUIElement) -> [[String: Any]] {
  elementRegistry.removeAll()

  // Walk tree and register all
  var result: [[String: Any]] = []
  var queue: [(element: AXUIElement, parentId: String?, depth: Int)] = [(root, nil, 0)]

  while !queue.isEmpty {
    let (element, parentId, depth) = queue.removeFirst()
    if depth > SNAPSHOT_MAX_DEPTH { continue }

    let id = registerElement(element)
    let role = axString(element, kAXRoleAttribute)
    let subrole = axString(element, kAXSubroleAttribute)
    let title = axString(element, kAXTitleAttribute)
    let desc = axString(element, kAXDescriptionAttribute)
    let val = axString(element, kAXValueAttribute)

    var node: [String: Any] = ["id": id]
    if let parentId = parentId { node["parent_id"] = parentId }
    if let role = role { node["role"] = role }
    if let subrole = subrole { node["subrole"] = subrole }
    if let title = title { node["title"] = title }
    if let desc = desc { node["description"] = desc }
    if let val = val { node["value"] = val }

    result.append(node)

    for child in axChildren(element) {
      queue.append((child, id, depth + 1))
    }
  }

  return result
}

// MARK: - Cursor process discovery

private func cursorPid() -> pid_t? {
  let apps = NSWorkspace.shared.runningApplications
  return apps.first(where: { $0.bundleIdentifier == "com.todesktop.230313mzl4w4u92" ||
                              $0.localizedName == "Cursor" })?.processIdentifier
}

private func agentsWindow(_ app: AXUIElement) -> AXUIElement? {
  guard let v = axValue(app, kAXWindowsAttribute) else { return nil }
  guard CFGetTypeID(v) == CFArrayGetTypeID() else { return nil }
  let arr = v as! CFArray
  for i in 0..<CFArrayGetCount(arr) {
    let item = CFArrayGetValueAtIndex(arr, i)
    let win = Unmanaged<AXUIElement>.fromOpaque(item!).takeUnretainedValue()
    if let t = axString(win, kAXTitleAttribute), t == "Cursor Agents" {
      return win
    }
  }
  return nil
}

// MARK: - AXManualAccessibility

// Returns the value to restore. An unreadable attribute counts as false,
// because Electron leaves it unset until an assistive client turns it on.
private func enableManualAccessibility(_ app: AXUIElement) -> Bool {
  let prior = axBool(app, "AXManualAccessibility") ?? false
  if !prior {
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, true as CFTypeRef)
  }
  return prior
}

private func restoreManualAccessibility(_ app: AXUIElement, _ prior: Bool) {
  if !prior {
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, false as CFTypeRef)
  }
}

// MARK: - Frontmost application

private func frontmostPid() -> pid_t? {
  let systemWide = AXUIElementCreateSystemWide()
  guard let v = axValue(systemWide, kAXFocusedApplicationAttribute) else { return nil }
  let focusedApp = v as! AXUIElement
  return axPid(focusedApp)
}

// MARK: - Operations

private func doPreflight() -> [String: Any] {
  let trusted = AXIsProcessTrusted()
  let pid = cursorPid()
  var agentsWindowPresent = false
  var frontmost: pid_t? = nil

  if let pid = pid {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, Float(MESSAGING_TIMEOUT_SECONDS))
    let prior = enableManualAccessibility(app)
    agentsWindowPresent = agentsWindow(app) != nil
    restoreManualAccessibility(app, prior)
  }

  frontmost = frontmostPid()

  return [
    "ok": true,
    "platform": "darwin",
    "accessibility_trusted": trusted,
    "cursor_pid": pid as Any,
    "agents_window_present": agentsWindowPresent,
    "frontmost_pid": frontmost as Any,
  ]
}

private func doSnapshot(_ app: AXUIElement) -> [String: Any] {
  guard let win = agentsWindow(app) else {
    return errorReply("HANDOFF_AGENTS_WINDOW_MISSING", "No window titled Cursor Agents")
  }
  let nodes = buildRegistry(win)
  return ["ok": true, "nodes": nodes]
}

private func doPress(_ elementId: String) -> [String: Any] {
  guard let element = elementRegistry[elementId] else {
    return errorReply("HANDOFF_ELEMENT_STALE", "Element id \(elementId) not found in registry")
  }
  let result = AXUIElementPerformAction(element, kAXPressAction as CFString)
  if result != .success {
    return errorReply("HANDOFF_PRESS_FAILED", "AXPress returned \(result.rawValue)")
  }
  return ["ok": true]
}

private func doSetValue(_ elementId: String, _ value: String) -> [String: Any] {
  guard let element = elementRegistry[elementId] else {
    return errorReply("HANDOFF_ELEMENT_STALE", "Element id \(elementId) not found in registry")
  }
  let result = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
  if result != .success {
    return errorReply("HANDOFF_PRESS_FAILED", "AXSetValue returned \(result.rawValue)")
  }
  return ["ok": true]
}

private func doFocusInsert(_ elementId: String, _ value: String) -> [String: Any] {
  guard let element = elementRegistry[elementId] else {
    return errorReply("HANDOFF_ELEMENT_STALE", "Element id \(elementId) not found in registry")
  }
  // The driver calls this only after a plain AXValue write left the composer
  // without the exact prompt, so it inserts through the focused selection.
  AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, true as CFTypeRef)
  let result = AXUIElementSetAttributeValue(element, kAXSelectedTextAttribute as CFString, value as CFTypeRef)
  if result != .success {
    return errorReply("HANDOFF_PRESS_FAILED", "focus_insert returned \(result.rawValue)")
  }
  return ["ok": true]
}

private func doFrontmost() -> [String: Any] {
  let pid = frontmostPid()
  return ["ok": true, "frontmost_pid": pid as Any]
}

// MARK: - Main

func runServe() {
  guard let pid = cursorPid() else {
    writeJson(errorReply("HANDOFF_CURSOR_NOT_RUNNING", "No Cursor process found"))
    exit(1)
  }

  let app = AXUIElementCreateApplication(pid)
  AXUIElementSetMessagingTimeout(app, Float(MESSAGING_TIMEOUT_SECONDS))
  let prior = enableManualAccessibility(app)

  defer { restoreManualAccessibility(app, prior) }

  while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty { continue }

    guard let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let op = obj["op"] as? String else {
      writeJson(errorReply("HANDOFF_HELPER_PROTOCOL", "Malformed request: \(trimmed)"))
      continue
    }

    let reply: [String: Any]
    switch op {
    case "preflight":
      reply = doPreflight()
    case "snapshot":
      reply = doSnapshot(app)
    case "press":
      let id = obj["id"] as? String ?? ""
      reply = doPress(id)
    case "set_value":
      let id = obj["id"] as? String ?? ""
      let value = obj["value"] as? String ?? ""
      reply = doSetValue(id, value)
    case "focus_insert":
      let id = obj["id"] as? String ?? ""
      let value = obj["value"] as? String ?? ""
      reply = doFocusInsert(id, value)
    case "frontmost":
      reply = doFrontmost()
    default:
      reply = errorReply("HANDOFF_HELPER_PROTOCOL", "Unknown op: \(op)")
    }

    writeJson(reply)
  }
}

let args = CommandLine.arguments
if args.contains("--preflight") {
  writeJson(doPreflight())
} else if args.contains("--serve") {
  runServe()
} else {
  fputs("Usage: cursor-handoff --preflight | --serve\n", stderr)
  exit(1)
}
