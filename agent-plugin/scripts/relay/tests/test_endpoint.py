"""endpoint.py: the channel the endpoint file names, a later timeout on an open socket channel, and the named-pipe
channel, its hello timeout on a read and on a write included, on Windows only."""

import json
import os
import queue
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

import endpoint

WAIT_SECONDS = 5.0


class ChannelPathTests(unittest.TestCase):
    def test_channel_path_reads_the_endpoint_file(self):
        written = {"protocol": 1, "channel": "/run/app/s.sock",
                   "launch": {"command": ["npm", "start"], "cwd": "/work/wigley-ai-gui"}}
        rows = [("a written endpoint file", json.dumps(written), "/run/app/s.sock"),
                ("no file", None, None),
                ("a file that is not JSON", "not json {", None)]
        for case, content, expected in rows:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as folder:
                if content is not None:
                    (Path(folder) / "endpoint.json").write_text(content, encoding="utf-8")

                self.assertEqual(endpoint.channel_path(Path(folder)), expected)


class SocketChannelTests(unittest.TestCase):
    def test_set_timeout_applies_to_later_reads(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        path = str(Path(folder.name) / "s.sock")
        # A peer that accepts the connection and never writes.
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.addCleanup(listener.close)
        listener.bind(path)
        listener.listen()
        channel = endpoint.SocketChannel(path)
        self.addCleanup(channel.close)

        channel.set_timeout(0.05)
        started = time.monotonic()
        data = channel.read()

        self.assertEqual(data, b"")
        self.assertLess(time.monotonic() - started, 0.5)


@unittest.skipUnless(sys.platform == "win32", "named pipes are Windows only")
class PipeChannelTests(unittest.TestCase):
    def test_a_write_goes_through_while_a_read_waits(self):
        import _winapi

        name = rf"\\.\pipe\wigley-relay-test-{os.getpid()}"
        # PIPE_TYPE_BYTE and PIPE_READMODE_BYTE are 0, the byte-stream pipe Node's net server makes.
        server = _winapi.CreateNamedPipe(name, _winapi.PIPE_ACCESS_DUPLEX | _winapi.FILE_FLAG_OVERLAPPED,
                                         _winapi.PIPE_WAIT, 1, 65536, 65536, 0, _winapi.NULL)
        self.addCleanup(_winapi.CloseHandle, server)
        connecting = _winapi.ConnectNamedPipe(server, overlapped=True)
        channel = endpoint.open_channel(name)
        self.addCleanup(channel.close)
        connecting.GetOverlappedResult(True)
        reads = queue.Queue()
        threading.Thread(target=lambda: reads.put(channel.read()), daemon=True).start()
        time.sleep(0.2)

        writer = threading.Thread(target=channel.write, args=(b"ping\n",), daemon=True)
        writer.start()
        writer.join(WAIT_SECONDS)

        self.assertFalse(writer.is_alive(), "the write waited behind the pending read")
        received, _ = _winapi.ReadFile(server, 64, overlapped=True)
        received.GetOverlappedResult(True)
        self.assertEqual(bytes(received.getbuffer()), b"ping\n")
        sent, _ = _winapi.WriteFile(server, b"pong\n", overlapped=True)
        sent.GetOverlappedResult(True)
        self.assertEqual(reads.get(timeout=WAIT_SECONDS), b"pong\n")

    def test_a_read_before_the_hello_is_done_gives_up_after_the_hello_timeout(self):
        import _winapi

        name = rf"\\.\pipe\wigley-relay-hello-test-{os.getpid()}"
        server = _winapi.CreateNamedPipe(name, _winapi.PIPE_ACCESS_DUPLEX | _winapi.FILE_FLAG_OVERLAPPED,
                                         _winapi.PIPE_WAIT, 1, 65536, 65536, 0, _winapi.NULL)
        self.addCleanup(_winapi.CloseHandle, server)
        connecting = _winapi.ConnectNamedPipe(server, overlapped=True)
        with mock.patch.object(endpoint, "HELLO_TIMEOUT_SECONDS", 0.2):
            channel = endpoint.open_channel(name)
        self.addCleanup(channel.close)
        connecting.GetOverlappedResult(True)
        reads = queue.Queue()

        threading.Thread(target=lambda: reads.put(channel.read()), daemon=True).start()

        self.assertEqual(reads.get(timeout=WAIT_SECONDS), b"")

    def test_a_write_the_app_never_reads_raises_after_the_hello_timeout(self):
        import _winapi

        name = rf"\\.\pipe\wigley-relay-write-test-{os.getpid()}"
        server = _winapi.CreateNamedPipe(name, _winapi.PIPE_ACCESS_DUPLEX | _winapi.FILE_FLAG_OVERLAPPED,
                                         _winapi.PIPE_WAIT, 1, 65536, 65536, 0, _winapi.NULL)
        self.addCleanup(_winapi.CloseHandle, server)
        connecting = _winapi.ConnectNamedPipe(server, overlapped=True)
        with mock.patch.object(endpoint, "HELLO_TIMEOUT_SECONDS", 0.2):
            channel = endpoint.open_channel(name)
        self.addCleanup(channel.close)
        connecting.GetOverlappedResult(True)
        started = time.monotonic()

        # Many times the pipe's 65,536-byte buffer, so the write waits on a read the server never makes.
        with self.assertRaises(OSError):
            channel.write(b"x" * (16 * 65536))

        self.assertLess(time.monotonic() - started, WAIT_SECONDS)


if __name__ == "__main__":
    unittest.main()
