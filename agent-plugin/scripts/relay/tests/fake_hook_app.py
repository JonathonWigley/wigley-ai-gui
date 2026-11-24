"""A fake app for hook-client tests: the app's side of one hook call on a temp Unix socket. The relay's and the
checklist hook's tests share it; the checklist tests reach it by putting this folder on sys.path."""

import json
import queue
import socket
import threading

WAIT_SECONDS = 5.0
DRIP_SECONDS = 0.2


class FakeHookApp:
    """Reads the hello and request lines, records them, then answers as `mode` says: `answer` sends `answer` as one
    JSON line, `silent` sends nothing, `drip` sends one byte per DRIP_SECONDS and no newline; `close` closes on accept
    and records nothing."""

    def __init__(self, path: str, mode: str, answer: dict | None = None):
        self.received = queue.Queue()
        self._mode = mode
        self._answer = answer
        self._connections = []
        self._stopped = threading.Event()
        self._listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._listener.bind(path)
        self._listener.listen()
        self._listener.settimeout(0.05)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self._stopped.is_set():
            try:
                connection, _ = self._listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            connection.settimeout(None)
            self._connections.append(connection)
            threading.Thread(target=self._talk, args=(connection,), daemon=True).start()

    def _talk(self, connection: socket.socket) -> None:
        try:
            if self._mode == "close":
                connection.close()
                return
            reader = connection.makefile("rb")
            self.received.put((json.loads(reader.readline()), json.loads(reader.readline())))
            if self._mode == "answer":
                connection.sendall(json.dumps(self._answer).encode() + b"\n")
            elif self._mode == "silent":
                self._stopped.wait(WAIT_SECONDS)
            elif self._mode == "drip":
                connection.sendall(b"{")
                while not self._stopped.wait(DRIP_SECONDS):
                    connection.sendall(b" ")
            connection.close()
        except (OSError, ValueError):
            return

    def next_received(self) -> tuple[dict, dict]:
        """The next (hello, request) pair the app read."""
        return self.received.get(timeout=WAIT_SECONDS)

    def stop(self) -> None:
        self._stopped.set()
        self._listener.close()
        for connection in self._connections:
            try:
                connection.close()
            except OSError:
                pass
