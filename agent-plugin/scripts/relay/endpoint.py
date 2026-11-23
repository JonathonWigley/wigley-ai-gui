"""The app's channel as its clients reach it: the channel the endpoint file names, and a connection to it (a Unix
socket on macOS, a named pipe on Windows). `relay.py` and the chatroom hook script import it; README.md § The relay is
its spec. Standard library only.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

import start_app

RELAY_PROTOCOL = 1
# A hook hello's own protocol, so an app that knows no hook calls refuses one at once rather than opening a session.
HOOK_PROTOCOL = 2
HELLO_TIMEOUT_SECONDS = 10.0
READ_SIZE = 65536


def _seconds(timeout: float | None) -> float:
    """`timeout`, or HELLO_TIMEOUT_SECONDS as the module holds it now when None."""
    return HELLO_TIMEOUT_SECONDS if timeout is None else timeout


class SocketChannel:
    """A connection to the app's Unix socket."""

    def __init__(self, path: str, timeout: float | None = None):
        self._socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._socket.settimeout(_seconds(timeout))
        try:
            self._socket.connect(path)
        except OSError:
            self._socket.close()
            raise

    def set_timeout(self, seconds: float) -> None:
        self._socket.settimeout(seconds)

    def hello_done(self) -> None:
        self._socket.settimeout(None)

    def read(self) -> bytes:
        """The next bytes the app sent, or b"" once the channel is closed or the timeout passed with nothing read."""
        try:
            return self._socket.recv(READ_SIZE)
        except OSError:
            return b""

    def write(self, data: bytes) -> None:
        self._socket.sendall(data)

    def close(self) -> None:
        try:
            self._socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._socket.close()


class PipeChannel:
    """A connection to the app's named pipe, opened for overlapped I/O: Windows serializes every read and write on
    a handle opened for synchronous I/O, so a read waiting on the app would hold every write behind it."""

    def __init__(self, path: str, timeout: float | None = None):
        import _winapi

        self._winapi = _winapi
        self._timeout_ms: int | None = int(_seconds(timeout) * 1000)
        try:
            self._handle = self._open(path)
        except OSError as exc:
            if exc.winerror != _winapi.ERROR_PIPE_BUSY:
                raise
            _winapi.WaitNamedPipe(path, self._timeout_ms)
            self._handle = self._open(path)

    def _open(self, path: str):
        winapi = self._winapi
        return winapi.CreateFile(path, winapi.GENERIC_READ | winapi.GENERIC_WRITE, 0, winapi.NULL,
                                 winapi.OPEN_EXISTING, winapi.FILE_FLAG_OVERLAPPED, winapi.NULL)

    def set_timeout(self, seconds: float) -> None:
        self._timeout_ms = int(seconds * 1000)

    def hello_done(self) -> None:
        self._timeout_ms = None

    def read(self) -> bytes:
        """The next bytes the app sent, or b"" once the pipe is closed or, until the hello is done, after the timeout
        with nothing read."""
        try:
            overlapped, _ = self._winapi.ReadFile(self._handle, READ_SIZE, overlapped=True)
            if not self._finished_in_time(overlapped):
                return b""
            _, error = overlapped.GetOverlappedResult(True)
        except OSError:
            return b""
        return b"" if error else bytes(overlapped.getbuffer())

    def _finished_in_time(self, overlapped) -> bool:
        """Waits for the read or write up to the timeout; on a timeout cancels it (CancelIoEx) and returns False."""
        if self._timeout_ms is None:
            return True
        winapi = self._winapi
        if winapi.WaitForSingleObject(overlapped.event, self._timeout_ms) == winapi.WAIT_OBJECT_0:
            return True
        overlapped.cancel()
        # The buffer belongs to the operation until Windows confirms the cancel.
        overlapped.GetOverlappedResult(True)
        return False

    def write(self, data: bytes) -> None:
        overlapped, _ = self._winapi.WriteFile(self._handle, data, overlapped=True)
        if not self._finished_in_time(overlapped):
            raise OSError("writing to the app's pipe timed out")
        _, error = overlapped.GetOverlappedResult(True)
        if error:
            raise OSError(error, "writing to the app's pipe failed")

    def close(self) -> None:
        try:
            self._winapi.CloseHandle(self._handle)
        except OSError:
            pass


def open_channel(path: str, timeout: float | None = None):
    """Connects to the app's channel, each read and write waiting up to `timeout` seconds (HELLO_TIMEOUT_SECONDS when
    None) until hello_done; raises OSError when nothing is listening there."""
    return PipeChannel(path, timeout) if sys.platform == "win32" else SocketChannel(path, timeout)


def channel_path(endpoint_dir: Path) -> str | None:
    """The channel the endpoint file in `endpoint_dir` names, or None with no readable endpoint file."""
    endpoint = start_app.read_endpoint(endpoint_dir)
    return None if endpoint is None else endpoint.channel
