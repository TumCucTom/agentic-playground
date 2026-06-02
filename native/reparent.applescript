-- native/reparent.applescript
--
-- macOS helper for the App Launcher's "in-canvas" mode. Positions a
-- spawned app's main window inside the bounds of our Electron app's
-- window, so the user sees the spawned app's window inside the canvas
-- rather than at a default position on the desktop.
--
-- Usage:
--   osascript native/reparent.applescript <pid> <targetX> <targetY> \
--         <targetW> <targetH>
--
-- System Events uses top-left screen coordinates, which is what the
-- renderer already passes — no y-flip needed.
--
-- On success, prints "ok <pid>". On failure, prints
-- "error <message>" and exits non-zero.
--
-- We use AppleScript via osascript (not the Swift AX API) because the
-- `swift` interpreter binary is not normally granted Accessibility
-- trust — the prompt and TCC entry are for Electron / Terminal / your
-- app bundle, not for ad-hoc `swift` invocations. System Events IS
-- trusted (it has to be for osascript to do anything), so AX writes
-- from osascript work without further setup.

on run argv
  set argc to count of argv
  if argc is not 5 then
    return "error: usage: reparent.applescript <pid> <tx> <ty> <tw> <th>"
  end if

  set pidStr to item 1 of argv
  set targetX to (item 2 of argv) as integer
  set targetY to (item 3 of argv) as integer
  set targetW to (item 4 of argv) as integer
  set targetH to (item 5 of argv) as integer

  try
    set targetPid to pidStr as integer
  on error
    return "error: invalid pid '" & pidStr & "'"
  end try

  -- Poll for the app's first window to appear (up to 10s). Cold-
  -- launched apps can take 1-2s to register a window with the Window
  -- Server, and a few more seconds for System Events' AX tree to
  -- catch up. We try the position+size write on every poll so a
  -- window that flickers into existence is caught the same tick.
  set foundWindow to false
  set attempts to 0
  set maxAttempts to 100
  set procSeen to false
  tell application "System Events"
    repeat while (not foundWindow) and (attempts < maxAttempts)
      try
        set p to (first process whose unix id is targetPid)
        set procSeen to true
        if (count of windows of p) > 0 then
          try
            set position of window 1 of p to {targetX, targetY}
            set size of window 1 of p to {targetW, targetH}
            set foundWindow to true
            exit repeat
          on error writeErr
            -- Window exists but AX write was rejected. Likely
            -- Accessibility permission is missing for System Events.
            -- Don't keep retrying — it'll fail the same way.
            return "error: pid " & pidStr & " has a window but System Events could not move it (" & writeErr & "). Grant Accessibility to System Events (System Settings → Privacy & Security → Accessibility)."
          end try
        end if
      on error
        -- Process not registered yet, or its window list is empty.
      end try
      if not foundWindow then
        delay 0.1
        set attempts to attempts + 1
      end if
    end repeat

    if not foundWindow then
      if procSeen then
        return "error: pid " & pidStr & " is running but has no windows System Events can see. Grant Accessibility to System Events (System Settings → Privacy & Security → Accessibility)."
      end if
      return "error: window for pid " & pidStr & " did not appear within 10s"
    end
  end tell

  return "ok " & pidStr
end run
