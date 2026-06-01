// native/reparent.swift
//
// macOS helper for the App Launcher's "in-canvas" mode. Spawns a macOS
// app and positions its main window inside the bounds of our Electron
// app's window, so the user sees the spawned app's window inside the
// canvas rather than at a default position on the desktop.
//
// Usage:
//   reparent <bundleId> <parentX> <parentY> <parentW> <parentH> \
//            <targetX> <targetY> <targetW> <targetH>
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
  FileHandle.standardError.write(Data("usage: reparent <bundleId> <px> <py> <pw> <ph> <tx> <ty> <tw> <th>\n".utf8))
  exit(64)
}

let args = CommandLine.arguments
guard args.count == 10 else { usage() }

let bundleId = args[1]
guard
  let parentX = Double(args[2]),
  let parentY = Double(args[3]),
  let parentW = Double(args[4]),
  let parentH = Double(args[5]),
  let targetX = Double(args[6]),
  let targetY = Double(args[7]),
  let targetW = Double(args[8]),
  let targetH = Double(args[9])
else { usage() }

// 1. Launch the app via `open -nb`. We don't wait — `open` is short-lived
// and the new app is its own process. We poll for it to appear.
let open = Process()
open.executableURL = URL(fileURLWithPath: "/usr/bin/open")
open.arguments = ["-nb", bundleId]
do {
  try open.run()
} catch {
  print("error: failed to launch \(bundleId): \(error.localizedDescription)")
  exit(1)
}
open.waitUntilExit()

// 2. Poll for the app's first window to appear (up to 5s).
let deadline = Date().addingTimeInterval(5.0)
var pid: pid_t = 0
var axWindow: AXUIElement?

while Date() < deadline {
  if let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId }) {
    pid = app.processIdentifier
    let axApp = AXUIElementCreateApplication(pid)
    var ref: CFTypeRef?
    let r = AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &ref)
    if r == .success, let arr = ref as? [AXUIElement], let w = arr.first {
      axWindow = w
      break
    }
  }
  Thread.sleep(forTimeInterval: 0.1)
}

guard let window = axWindow, pid != 0 else {
  print("error: window for \(bundleId) did not appear within 5s")
  exit(2)
}

// 3. Position the window. macOS screen coordinates have y growing up
// from the bottom-left, while the caller passes screen coordinates
// with y growing down from the top-left. Flip y for the AX call.
let screenHeight = NSScreen.main?.frame.height ?? 0
let axX = targetX
let axY = screenHeight - targetY - targetH

// Set the position and size via the accessibility API. Most apps
// respond to this; some refuse (system apps, sandboxed apps). We try
// both, and if the size set fails, try a position+size set together.
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
