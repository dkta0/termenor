#!/usr/bin/env python3
"""End-to-end login verification through a real PTY.

Spawns the server and ONE OpenTUI client with NO TERMENOR_USER/PASS, so the
client shows the in-TUI login screen. Types a username, Tab to password, a
password, then Enter to register — and verifies the world renders afterward
(half-block glyph + local player color), proving login -> play works.
"""
import os, pty, sys, time, fcntl, termios, struct, subprocess, select, signal, tempfile

PORT = 3139
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HALF_BLOCK = "▀".encode("utf-8")
LOCAL_COLOR = b"255;210;60"

def set_winsize(fd, rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))

def spawn_client(rows, cols):
    pid, fd = pty.fork()
    if pid == 0:
        env = dict(os.environ)
        env["SERVER_URL"] = f"ws://localhost:{PORT}"
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        env.pop("TERMENOR_USER", None)   # force the interactive login screen
        env.pop("TERMENOR_PASS", None)
        os.chdir(ROOT)
        os.execvpe("bun", ["bun", "run", "packages/client/src/index.ts"], env)
        os._exit(127)
    set_winsize(fd, rows, cols)
    return pid, fd

def drain(fds, duration):
    out = {fd: bytearray() for fd in fds}
    end = time.monotonic() + duration
    while time.monotonic() < end:
        r, _, _ = select.select(fds, [], [], 0.1)
        for fd in r:
            try:
                data = os.read(fd, 65536)
                if data: out[fd].extend(data)
            except OSError:
                pass
    return out

def main():
    db_dir = tempfile.mkdtemp(prefix="termenor-login-")
    db_path = os.path.join(db_dir, "login-check.db")
    server = subprocess.Popen(
        ["bun", "run", "packages/server/src/index.ts"],
        cwd=ROOT, env={**os.environ, "PORT": str(PORT), "DB_PATH": db_path},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1.5)
    pid, fd = spawn_client(40, 100)
    time.sleep(1.0)  # login screen renders

    # Type credentials: username "ptylogin", Tab, password "secret", Enter.
    for ch in b"ptylogin":
        os.write(fd, bytes([ch])); time.sleep(0.03)
    os.write(fd, b"\t"); time.sleep(0.1)            # focus password
    for ch in b"secret":
        os.write(fd, bytes([ch])); time.sleep(0.03)
    os.write(fd, b"\r"); time.sleep(0.1)            # submit (register)

    world = drain([fd], 3.0)  # collect frames after entering the world

    try: os.kill(pid, signal.SIGTERM)
    except OSError: pass
    server.send_signal(signal.SIGTERM)
    time.sleep(0.3)
    try: server.kill()
    except Exception: pass

    out = bytes(world[fd])
    checks = {
        "client emitted output": len(out) > 0,
        "world half-block ▀ glyph present (entered game)": HALF_BLOCK in out,
        "local player color rendered": LOCAL_COLOR in out,
    }
    ok = True
    for name, passed in checks.items():
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        ok = ok and passed
    print("PTY LOGIN OK" if ok else "PTY LOGIN FAILED")
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
