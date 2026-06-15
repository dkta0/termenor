#!/usr/bin/env python3
"""End-to-end render verification through a real PTY (no GUI needed).

Starts the server, runs two real OpenTUI clients in pseudo-terminals, feeds
arrow-key input to move one player, and inspects the escape-sequence bytes the
*other* client emits — the exact bytes ghostty/kitty would paint. Verifies:
  - truecolor SGR output (color rendering),
  - the half-block glyph U+2580 (primary tier active),
  - both player colors present (local + other rendered),
  - frames animate over time (continuous repaints),
  - the moved player's frames change after input (real-time mirroring).
"""
import os, pty, sys, time, fcntl, termios, struct, subprocess, select, signal

PORT = 3137
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HALF_BLOCK = "▀".encode("utf-8")           # ▀
TRUECOLOR = b"\x1b[38;2;"                         # SGR truecolor fg
LOCAL_COLOR = b"255;210;60"                       # local player (yellow), fg or bg
OTHER_COLOR = b"80;140;255"                       # other player (blue), fg or bg

def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def spawn_client(rows, cols, username):
    pid, fd = pty.fork()
    if pid == 0:  # child
        env = dict(os.environ)
        env["SERVER_URL"] = f"ws://localhost:{PORT}"
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env["TERMENOR_USER"] = username   # auth: distinct account per client
        env["TERMENOR_PASS"] = "ptycheck"
        os.chdir(ROOT)
        os.execvpe("bun", ["bun", "run", "packages/client/src/index.ts"], env)
        os._exit(127)
    set_winsize(fd, rows, cols)
    return pid, fd

def drain(fds, duration, feed=None):
    """Read from fds for `duration`s; optionally feed (fd,bytes) at intervals."""
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
            ffd, keys = feed
            want = int((duration - (end - time.monotonic())) / 0.5)
            while fed < want and fed < len(keys):
                os.write(ffd, keys[fed]); fed += 1
    return out

def main():
    server = subprocess.Popen(
        ["bun", "run", "packages/server/src/index.ts"],
        cwd=ROOT, env={**os.environ, "PORT": str(PORT)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)
    pidA, fdA = spawn_client(40, 100, "observer")   # observer
    pidB, fdB = spawn_client(40, 100, "mover")      # mover
    time.sleep(1.2)                      # join + first frames

    # phase 1: baseline frames
    base = drain([fdA, fdB], 1.2)
    # phase 2: move B with arrow keys (right, right, down, down, right, down)
    arrows = [b"\x1b[C", b"\x1b[C", b"\x1b[B", b"\x1b[B", b"\x1b[C", b"\x1b[B"]
    moved = drain([fdA, fdB], 3.0, feed=(fdB, arrows))

    for pid in (pidB, pidA):
        try: os.kill(pid, signal.SIGTERM)
        except OSError: pass
    server.send_signal(signal.SIGTERM)
    time.sleep(0.3)
    try: server.kill()
    except Exception: pass

    a_base = bytes(base[fdA]); a_moved = bytes(moved[fdA])
    a_all = a_base + a_moved
    # frame count proxy: synchronized-output or cursor-home markers
    frames = a_all.count(b"\x1b[?2026") + a_all.count(b"\x1b[H") + a_all.count(b"\x1b[1;1H")

    checks = {
        "client A emitted output": len(a_all) > 0,
        "truecolor SGR present": TRUECOLOR in a_all,
        "half-block ▀ glyph present (primary tier)": HALF_BLOCK in a_all,
        "local player color rendered": LOCAL_COLOR in a_all,
        "other player color rendered": OTHER_COLOR in a_all,
        "frames animate (>20 repaints)": frames > 20,
        "frames change after B moves": len(a_moved) > 0 and a_moved[-4000:] != a_base[-4000:],
        "player name labels rendered": b"mover" in a_all or b"observer" in a_all,
        "NPC rendered (goblin/rat label)": b"Goblin" in a_all or b"Rat" in a_all,
    }
    print(f"client A bytes: base={len(a_base)} moved={len(a_moved)} frames~={frames}")
    ok = True
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok = ok and passed
    print("PTY RENDER OK" if ok else "PTY RENDER FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
