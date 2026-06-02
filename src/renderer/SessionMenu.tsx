import React, { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from './state/canvasStore';
import { Tooltip } from './Tooltip';

// Popover anchored to the title bar's workspace name. Lets the user:
//   1. Save the current state as a new named snapshot
//   2. Switch to any other session
//   3. Rename or delete a session via right-click
//
// The active session is whatever is in `workspaceName`; this component
// does not need its own copy. Switching auto-saves into the new
// active file going forward — see the session:* IPC handlers in main.
export const SessionMenu: React.FC = () => {
  const workspaceName = useCanvasStore((s) => s.workspaceName);
  const sessions = useCanvasStore((s) => s.sessions);
  const refreshSessions = useCanvasStore((s) => s.refreshSessions);
  const saveSessionAs = useCanvasStore((s) => s.saveSessionAs);
  const switchToSession = useCanvasStore((s) => s.switchToSession);
  const renameSession = useCanvasStore((s) => s.renameSession);
  const deleteSession = useCanvasStore((s) => s.deleteSession);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'list' | 'saveAs' | 'rename'>('list');
  const [draftName, setDraftName] = useState('');
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Right-click context menu for an individual session row
  const [rowMenu, setRowMenu] = useState<{ name: string; x: number; y: number } | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refresh the list whenever the menu opens so deletions/renames
  // from the prior session (e.g., closed and reopened the menu) are
  // reflected. The list is cheap to fetch.
  useEffect(() => {
    if (open) void refreshSessions();
  }, [open, refreshSessions]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setMode('list');
        setError(null);
      }
    };
    // Defer to skip the click that opened the menu
    const id = window.setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', handler);
    };
  }, [open]);

  // Close the per-row context menu on outside click
  useEffect(() => {
    if (!rowMenu) return;
    const handler = () => setRowMenu(null);
    const id = window.setTimeout(() => window.addEventListener('mousedown', handler), 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('mousedown', handler);
    };
  }, [rowMenu]);

  // Focus the name input when entering a name-entry mode
  useEffect(() => {
    if ((mode === 'saveAs' || mode === 'rename') && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [mode]);

  const enterSaveAs = () => {
    setMode('saveAs');
    // Default the new name to "<active> copy" so the user can edit.
    setDraftName(workspaceName === 'default' ? '' : `${workspaceName} copy`);
    setError(null);
  };

  const enterRename = (current: string) => {
    setMode('rename');
    setRenameTarget(current);
    setDraftName(current);
    setError(null);
  };

  const cancelEntry = () => {
    setMode('list');
    setRenameTarget(null);
    setDraftName('');
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'saveAs') {
        const r = await saveSessionAs(draftName);
        if (r.ok === true) {
          setMode('list');
          setDraftName('');
        } else {
          setError(r.error);
        }
      } else if (mode === 'rename' && renameTarget) {
        const r = await renameSession(renameTarget, draftName);
        if (r.ok === true) {
          setMode('list');
          setRenameTarget(null);
          setDraftName('');
        } else {
          setError(r.error);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSwitch = async (name: string) => {
    if (name === workspaceName) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await switchToSession(name);
    setBusy(false);
    if (r.ok === true) {
      setOpen(false);
      setMode('list');
    } else {
      setError(r.error);
    }
  };

  const handleDelete = async (name: string) => {
    if (name === workspaceName) {
      setError('Cannot delete the active session — switch to another first');
      setRowMenu(null);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await deleteSession(name);
    setBusy(false);
    setRowMenu(null);
    if (r.ok === false) setError(r.error);
  };

  const onRowContextMenu = (e: React.MouseEvent, name: string) => {
    e.preventDefault();
    e.stopPropagation();
    setRowMenu({ name, x: e.clientX, y: e.clientY });
  };

  // Sorted so the active session floats to the top — easier to spot.
  const sortedSessions = [...sessions].sort((a, b) => {
    if (a === workspaceName) return -1;
    if (b === workspaceName) return 1;
    return a.localeCompare(b);
  });

  return (
    <div ref={rootRef} style={{ position: 'relative', WebkitAppRegion: 'no-drag' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Sessions"
        aria-haspopup="menu"
        aria-expanded={open}
        style={{
          background: open ? '#2a2a2a' : 'transparent',
          border: 'none',
          color: '#d0d0d0',
          fontSize: 12,
          cursor: 'pointer',
          padding: '2px 6px',
          borderRadius: 3,
          fontFamily: 'inherit',
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = '#2a2a2a';
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = 'transparent';
        }}
      >
        {workspaceName} ▾
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 260,
            maxHeight: 360,
            overflowY: 'auto',
            background: '#2a2a2a',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            padding: 4,
            zIndex: 3000,
            fontSize: 12,
            color: '#d0d0d0',
          }}
        >
          {mode === 'list' && (
            <>
              <button
                role="menuitem"
                onClick={enterSaveAs}
                style={menuItemStyle}
                onMouseEnter={hoverIn}
                onMouseLeave={hoverOut}
              >
                + Save current as new session…
              </button>
              <div style={dividerStyle} />
              {sortedSessions.length === 0 ? (
                <div style={{ padding: '12px 10px', color: '#666', textAlign: 'center' }}>
                  No saved sessions
                </div>
              ) : (
                sortedSessions.map((name) => {
                  const isActive = name === workspaceName;
                  return (
                    <div
                      key={name}
                      role="menuitem"
                      onClick={() => void handleSwitch(name)}
                      onContextMenu={(e) => onRowContextMenu(e, name)}
                      style={{
                        ...menuItemStyle,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                      }}
                      onMouseEnter={hoverIn}
                      onMouseLeave={hoverOut}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      {isActive && <span style={badgeStyle}>current</span>}
                    </div>
                  );
                })
              )}
            </>
          )}

          {(mode === 'saveAs' || mode === 'rename') && (
            <div style={{ padding: 8 }}>
              <div style={{ marginBottom: 6, color: '#888' }}>
                {mode === 'saveAs' ? 'New session name' : `Rename "${renameTarget}"`}
              </div>
              <input
                ref={inputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                  if (e.key === 'Escape') cancelEntry();
                }}
                maxLength={64}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: '#1a1a1a',
                  border: '1px solid #3a3a3a',
                  borderRadius: 3,
                  color: '#d0d0d0',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
              {error && (
                <div style={{ color: '#f48771', fontSize: 11, marginTop: 6 }}>{error}</div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                <button onClick={cancelEntry} style={smallButtonStyle}>
                  Cancel
                </button>
                <button
                  onClick={() => void submit()}
                  disabled={busy || draftName.trim().length === 0}
                  style={{
                    ...smallButtonStyle,
                    background: '#5a9fd4',
                    color: '#0a1929',
                    opacity: busy || draftName.trim().length === 0 ? 0.5 : 1,
                  }}
                >
                  {mode === 'saveAs' ? 'Save' : 'Rename'}
                </button>
              </div>
            </div>
          )}

          {mode === 'list' && error && (
            <div style={{ color: '#f48771', fontSize: 11, padding: '4px 8px' }}>{error}</div>
          )}
        </div>
      )}

      {rowMenu && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            left: rowMenu.x,
            top: rowMenu.y,
            background: '#2a2a2a',
            border: '1px solid #3a3a3a',
            borderRadius: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            padding: 4,
            zIndex: 4000,
            minWidth: 140,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            onClick={() => {
              enterRename(rowMenu.name);
              setRowMenu(null);
            }}
            style={menuItemStyle}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            Rename…
          </button>
          <button
            role="menuitem"
            onClick={() => void handleDelete(rowMenu.name)}
            disabled={rowMenu.name === workspaceName}
            style={{
              ...menuItemStyle,
              opacity: rowMenu.name === workspaceName ? 0.4 : 1,
            }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            title={
              rowMenu.name === workspaceName
                ? 'Switch to another session before deleting this one'
                : 'Delete session'
            }
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  background: 'transparent',
  border: 'none',
  color: '#d0d0d0',
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 3,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const smallButtonStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'transparent',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#d0d0d0',
  fontSize: 11,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  background: '#3a3a3a',
  margin: '4px 0',
};

const badgeStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#5a9fd4',
  background: 'rgba(90, 159, 212, 0.15)',
  padding: '1px 6px',
  borderRadius: 8,
  marginLeft: 8,
  flexShrink: 0,
};

const hoverIn = (e: React.MouseEvent<HTMLElement>) => {
  (e.currentTarget as HTMLElement).style.backgroundColor = '#3a3a3a';
};
const hoverOut = (e: React.MouseEvent<HTMLElement>) => {
  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
};
