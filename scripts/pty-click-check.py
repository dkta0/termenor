#!/usr/bin/env python3
"""End-to-end click-to-move verification through a real PTY.

Regression guard for the OpenTUI hit-grid bug: the world is drawn straight to
the render buffer (no child renderables), so mouse clicks never landed on any
renderable and `onMouseDown` never fired. A full-screen invisible hit layer
fixes it. Here we drive the mover with synthetic SGR mouse clicks and confirm
the OTHER client sees it relocate — proving clicks reach the handler and move
the player end-to-end (the exact path arrow keys exercise in pty-render-check).
"""
import os, pty, sys, time, fcntl, termios, struct, subprocess, select, signal, tempfile

PORT = 3139
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def spawn_client(rows, cols, username):
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ)
        env["SERVER_URL"] = f"ws://localhost:{PORT}"
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERMENOR_USER"] = username
        env["TERMENOR_PASS"] = "clickcheck"
        os.chdir(ROOT)
        os.execvpe("bun", ["bun", "run", "packages/client/src/index.ts"], env)
        os._exit(127)
    set_winsize(fd, rows, cols)
    return pid, fd

def drain(fds, duration, feed=None):
    out = {fd: bytearray() for fd in fds}
    end = time.monotonic() + duration
    fed = 0
    while time.monotonic() < end:
        r, _, _ = select.select(fds, [], [], 0.1)
        for fd in r:
            try:
                data = os.read(fd, 65536)
                if data:
                    out[fd].extend(data)
            except OSError:
                pass
        if feed:
            ffd, events = feed
            want = int((duration - (end - time.monotonic())) / 0.5)
            while fed < want and fed < len(events):
                os.write(ffd, events[fed]); fed += 1
    return out

def sgr_click(col, row):
    # SGR mouse: press (M) then release (m), button 0 (left). 1-based coords.
    return [f"\x1b[<0;{col};{row}M".encode(), f"\x1b[<0;{col};{row}m".encode()]

def main():
    db_dir = tempfile.mkdtemp(prefix="termenor-click-")
    db_path = os.path.join(db_dir, "click-check.db")
    server = subprocess.Popen(
        ["bun", "run", "packages/server/src/index.ts"],
        cwd=ROOT, env={**os.environ, "PORT": str(PORT), "DB_PATH": db_path},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)
    ROWS, COLS = 40, 100
    pidA, fdA = spawn_client(ROWS, COLS, "observer")   # watches the mover
    pidB, fdB = spawn_client(ROWS, COLS, "mover")      # clicked around
    time.sleep(1.5)

    base = drain([fdA, fdB], 1.2)

    # The mover is centered in its own viewport; click several cells out in one
    # direction so it walks a clear, sustained path the observer can see.
    cx, cy = COLS // 2, ROWS // 2
    clicks = []
    for (dx, dy) in [(12, 6), (14, 7), (16, 8), (12, 6), (14, 7)]:
        clicks += sgr_click(cx + dx, cy + dy)
    moved = drain([fdA, fdB], 4.0, feed=(fdB, clicks))

    # --- Side panel: click the Skills tab; confirm it renders skill rows ---
    PANEL_COLS = min(28, max(0, COLS - 20))    # mirrors the renderer
    panel_col = COLS - PANEL_COLS               # 0-based left edge of the panel
    skills_col0 = panel_col + 1 + len("Inv") + 2  # 0-based start of the "Skills" label
    click_col = skills_col0 + 2                 # 0-based, mid-label
    tabbed = drain([fdA, fdB], 1.5, feed=(fdB, sgr_click(click_col + 1, 1)))  # SGR is 1-based

    for pid in (pidB, pidA):
        try: os.kill(pid, signal.SIGTERM)
        except OSError: pass
    server.send_signal(signal.SIGTERM)
    time.sleep(0.3)
    try: server.kill()
    except Exception: pass

    a_base, a_moved = bytes(base[fdA]), bytes(moved[fdA])
    b_base, b_moved = bytes(base[fdB]), bytes(moved[fdB])
    b_tab = bytes(tabbed[fdB])
    skills_panel = b"Strength" in b_tab  # the Skills tab lists skill rows

    # Mover moving pans its camera → whole-screen repaints → output volume
    # balloons well past an idle baseline (clicks that never fire stay flat).
    mover_jumped = len(b_moved) > len(b_base) * 2
    # Observer sees the relocated sprite → tail frames differ from baseline.
    observer_changed = len(a_moved) > 0 and a_moved[-4000:] != a_base[-4000:]

    checks = {
        "mover output balloons after clicks (camera panned → player moved)": mover_jumped,
        "observer frames change after mover relocates": observer_changed,
        "skills tab renders skill rows when clicked": skills_panel,
    }
    print(f"mover bytes: base={len(b_base)} moved={len(b_moved)}  "
          f"observer bytes: base={len(a_base)} moved={len(a_moved)}")
    ok = True
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok = ok and passed
    print("CLICK MOVE OK" if ok else "CLICK MOVE FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
