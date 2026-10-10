"""Keep processor descendants owned even after an abrupt Windows process exit."""

import ctypes
import os
import threading
from ctypes import wintypes

_job_handle = None


def protect_process_tree():
    global _job_handle
    if os.name != "nt" or _job_handle is not None:
        return

    class BasicLimits(ctypes.Structure):
        _fields_ = [
            ("process_time", ctypes.c_longlong), ("job_time", ctypes.c_longlong),
            ("flags", wintypes.DWORD), ("min_working_set", ctypes.c_size_t),
            ("max_working_set", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
            ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
            ("scheduling", wintypes.DWORD),
        ]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("basic", BasicLimits), ("io", ctypes.c_ulonglong * 6),
            ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
            ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([wintypes.LPVOID, wintypes.LPCWSTR], wintypes.HANDLE),
        "SetInformationJobObject": ([wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD], wintypes.BOOL),
        "AssignProcessToJobObject": ([wintypes.HANDLE, wintypes.HANDLE], wintypes.BOOL),
        "GetCurrentProcess": ([], wintypes.HANDLE),
        "OpenProcess": ([wintypes.DWORD, wintypes.BOOL, wintypes.DWORD], wintypes.HANDLE),
        "WaitForSingleObject": ([wintypes.HANDLE, wintypes.DWORD], wintypes.DWORD),
        "CloseHandle": ([wintypes.HANDLE], wintypes.BOOL),
    }
    for name, (args, result) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes, function.restype = args, result

    parents = []
    parent_ids = {os.getppid()}
    if os.environ.get("BERU_PARENT_PID"):
        parent_ids.add(int(os.environ["BERU_PARENT_PID"]))
    job = None
    try:
        for parent_pid in parent_ids:
            parent = kernel.OpenProcess(0x00100000, False, parent_pid)
            if not parent:
                raise ctypes.WinError(ctypes.get_last_error())
            parents.append(parent)
        job = kernel.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())
        limits = ExtendedLimits()
        limits.basic.flags = 0x00002000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
            raise ctypes.WinError(ctypes.get_last_error())
    except Exception:
        if job:
            kernel.CloseHandle(job)
        for parent in parents:
            kernel.CloseHandle(parent)
        raise
    # The non-inheritable handle stays open until this processor exits.
    _job_handle = job

    def watch_parent(parent):
        result = kernel.WaitForSingleObject(parent, 0xFFFFFFFF)
        kernel.CloseHandle(parent)
        if result != 0:
            os.write(2, b"Processor parent monitor failed\n")
        os._exit(1)

    for parent in parents:
        threading.Thread(target=watch_parent, args=(parent,), daemon=True, name="processor-parent").start()
