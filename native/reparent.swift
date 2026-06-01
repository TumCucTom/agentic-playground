// native/reparent.swift
//
// macOS helper for the App Launcher's "in-canvas" mode. Positions a
// spawned app's main window inside the bounds of our Electron app's
// window, so the user sees the spawned app's window inside the canvas
// rather than at a default position on the desktop.
//
// Usage:
//   reparent --pid <pid> <parentX> <parentY> <parentW> <parentH> \
//             <targetX> <targetY> <targetW> <targetH>
//
//   reparent --launch <bundleId> <parentX> <parentY> <parentW> <parentH> \
//             <targetX> <targetY> <targetW> <targetH>
//
// On success, prints "ok <pid>". On failure, prints
// "error <message>" and exits non-zero.
//
// This is a positioning helper — true Window Server reparenting
// requires private CGS APIs and is left as a follow-up. Positioning
// is enough to give the "in canvas" feel for our use case.

import Cocoa
import ApplicationServices

func usage() -> Never {
  FileHandle.standardError.write(Data("usage:\n  reparent --pid <pid> <px> <py> <pw> <ph> <tx> <ty> <tw> <th>\n  reparent --launch <bundleId> <px> <py> <pw> <ph> <tx> <ty> <tw> <th>\n".utf8))
  exit(64)
}

let args = CommandLine.arguments
guard args.count == 11 else { usage() }

let mode = args[1]
let identifier: String
let needLaunch: Bool
if mode == "--pid" {
  identifier = args[2]
  needLaunch = false
} else if mode == "--launch" {
  identifier = args[2]
  needLaunch = true
} else {
  usage()
}

let numericArgs: [Double]
if mode == "--pid" {
  // args[3..10] are the eight numbers
  guard
    let a = Double(args[3]), let b = Double(args[4]),
    let c = Double(args[5]), let d = Double(args[6]),
    let e = Double(args[7]), let f = Double(args[8]),
    let g = Double(args[9]), let h = Double(args[10])
  else { usage() }
  numericArgs = [a, b, c, d, e, f, g, h]
} else {
  guard
    let a = Double(args[3]), let b = Double(args[4]),
    let c = Double(args[5]), let d = Double(args[6]),
    let e = Double(args[7]), let f = Double(args[8]),
    let g = Double(args[9]), let h = Double(args[10])
  else { usage() }
  numericArgs = [a, b, c, d, e, f, g, h]
}

let targetX = numericArgs[4]
let targetY = numericArgs[5]
let targetW = numericArgs[6]
let targetH = numericArgs[7]

// 1. Launch the app if --launch was passed. (The main process usually
// calls --pid because it has already launched the app via app:launch;
// launching again with -n would spawn a second instance.)
var pid: pid_t = 0
if needLaunch {
  let open = Process()
  open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
  open.arguments = ["-nb", identifier]
  do {
    try open.run()
  } catch {
    print("error: failed to launch \(identifier): \(error.localizedDescription)")
    exit(1)
  }
  open.waitUntilExit()
} else {
  guard let p = pid_t(identifier) else {
    print("error: invalid pid '\(identifier)'")
    exit(1)
  }
  pid = p
}

// 2. Poll for the app's first window to appear (up to 5s).
let deadline = Date().addingTimeInterval(5.0)
var axWindow: AXUIElement?

func findWindow(for pid: pid_t) -> AXUIElement? {
  let axApp = AXUIElementCreateApplication(pid)
  var ref: CFTypeRef?
  let r = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &ref)
  guard r == .success, let arr = ref as? [AXUIElement] else { return nil }
  return arr.first
}

while Date() < deadline {
  if needLaunch {
    if let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == identifier }) {
      pid = app.processIdentifier
      if let w = findWindow(for: pid) {
        axWindow = w
        break
      }
    }
  } else {
    if let w = findWindow(for: pid) {
      axWindow = w
      break
    }
  }
  Thread.sleep(forTimeInterval: 0.1)
}

guard let window = axWindow, pid != 0 else {
  print("error: window for pid \(pid) did not appear within 5s")
  exit(2)
}

// 3. Position the window. macOS screen coordinates have y growing up
// from the bottom-left, while the caller passes screen coordinates
// with y growing down from the top-left. Flip y for the AX call.
let screenHeight = NSScreen.main?.frame.height ?? 0
let axX = targetX
let axY = screenHeight - targetY - targetH

// Set the position and size via the accessibility API. Most apps
// respond to this; some refuse (system apps, sandboxed apps).
var newPos = CGPoint(x: axX, y: axY)
let posResult = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, NSValue(point: newPos))
if posResult != .success {
  print("error: failed to set position: \(posResult.rawValue)")
  // continue anyway — maybe size still works
}

var newSize = CGSize(width: targetW, height: targetH)
let sizeResult = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, NSValue(size: newSize))
if sizeResult != .success {
  print("error: failed to set size: \(sizeResult.rawValue)")
  exit(3)
}

print("ok \(pid)")
