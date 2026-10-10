"""Real Windows process trees must die with the worker or Electron owner."""

import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
from ctypes import wintypes
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows process ownership")
class ProcessLifetimeTests(unittest.TestCase):
    def test_packaged_media_owner_closes_its_child_when_its_bootloader_is_killed(self):
        executable = Path(__file__).resolve().parent.parent / "bin" / "beru-processor.exe"
        if not executable.is_file():
            self.skipTest("bundled processor is not built")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / "child.txt"
            code = f"import os,time; from pathlib import Path; Path({str(ready)!r} + '.tmp').write_text(str(os.getpid())); os.replace({str(ready)!r} + '.tmp', {str(ready)!r}); time.sleep(60)"
            owner = subprocess.Popen([str(executable), "--run-media", sys._base_executable, "-c", code], env={**os.environ, "BERU_PARENT_PID": str(os.getpid()), "TEMP": directory, "TMP": directory})
            handle = None
            try:
                deadline = time.monotonic() + 10
                while not ready.exists() and time.monotonic() < deadline and owner.poll() is None:
                    time.sleep(.05)
                self.assertTrue(ready.exists(), f"packaged owner did not become ready; exit={owner.poll()}")
                handle = kernel.OpenProcess(0x00100001, False, int(ready.read_text()))
                self.assertTrue(handle)
                owner.kill()
                owner.wait(timeout=5)
                self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0, "packaged media child was orphaned")
            finally:
                if owner.poll() is None:
                    owner.kill()
                owner.wait(timeout=5)
                if handle:
                    kernel.TerminateProcess(handle, 1)
                    kernel.CloseHandle(handle)

    def test_packaged_media_owner_preserves_stdin_output_and_failure_code(self):
        executable = Path(__file__).resolve().parent.parent / "bin" / "beru-processor.exe"
        if not executable.is_file():
            self.skipTest("bundled processor is not built")
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run([str(executable), "--run-media", sys._base_executable, "-c", "import sys; assert sys.stdin.read() == ''; print('output'); print('decode failed', file=sys.stderr); sys.exit(7)"], capture_output=True, text=True, timeout=10, env={**os.environ, "TEMP": directory, "TMP": directory})
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertEqual(result.stdout.strip(), "output")
        self.assertEqual(result.stderr.strip(), "decode failed")

    def test_owner_death_terminates_the_worker_and_its_descendants(self):
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.WaitForSingleObject.restype = wintypes.DWORD
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        for death in ("worker", "electron", "bootloader"):
            with self.subTest(death=death), tempfile.TemporaryDirectory() as directory:
                ready = str(Path(directory) / "ready.json")
                worker_code = (
                    "import os,sys,subprocess,time,json; from pathlib import Path; "
                    "from process_lifetime import protect_process_tree; protect_process_tree(); "
                    "child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); "
                    f"Path({ready!r} + '.tmp').write_text(json.dumps([os.getpid(),child.pid])); "
                    f"os.replace({ready!r} + '.tmp', {ready!r}); time.sleep(60)"
                )
                owner_code = (
                    "import os,sys,subprocess,time; "
                    f"subprocess.Popen([sys.executable,'-c',{worker_code!r}],env={{**os.environ,'BERU_PARENT_PID':str({os.getpid() if death == 'bootloader' else 'os.getpid()'})}}); time.sleep(60)"
                ) if death != "worker" else worker_code
                owner = subprocess.Popen([sys._base_executable, "-c", owner_code], cwd=Path(__file__).parent, env={**os.environ, "BERU_PARENT_PID": str(os.getpid())})
                handles = []
                try:
                    deadline = time.monotonic() + 10
                    while not Path(ready).exists() and time.monotonic() < deadline and owner.poll() is None:
                        time.sleep(.05)
                    self.assertTrue(Path(ready).exists(), f"fixture did not become ready; exit={owner.poll()}")
                    for pid in json.loads(Path(ready).read_text()):
                        handle = kernel.OpenProcess(0x00100001, False, pid)
                        self.assertTrue(handle, ctypes.get_last_error())
                        handles.append(handle)
                    owner.kill()
                    owner.wait(timeout=5)
                    for handle in handles:
                        self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0, f"orphan after {death} death")
                finally:
                    if owner.poll() is None:
                        owner.kill()
                    owner.wait(timeout=5)
                    for handle in handles:
                        kernel.TerminateProcess(handle, 1)
                        kernel.CloseHandle(handle)


if __name__ == "__main__":
    unittest.main()
