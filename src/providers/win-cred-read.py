import ctypes
from ctypes import wintypes
import json
import sys

CRED_TYPE_GENERIC = 1


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", wintypes.DWORD),
        ("Type", wintypes.DWORD),
        ("TargetName", wintypes.LPWSTR),
        ("Comment", wintypes.LPWSTR),
        ("LastWritten", FILETIME),
        ("CredentialBlobSize", wintypes.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", wintypes.DWORD),
        ("AttributeCount", wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", wintypes.LPWSTR),
        ("UserName", wintypes.LPWSTR),
    ]


def read_credential(target):
    advapi32 = ctypes.windll.advapi32
    advapi32.CredReadW.argtypes = [
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.POINTER(CREDENTIAL))
    ]
    advapi32.CredReadW.restype = wintypes.BOOL

    cred_ptr = ctypes.POINTER(CREDENTIAL)()
    ok = advapi32.CredReadW(target, CRED_TYPE_GENERIC, 0, ctypes.byref(cred_ptr))
    if not ok:
        raise RuntimeError(f"CredReadW failed for target {target!r}")
    try:
        cred = cred_ptr.contents
        buf = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        return buf.decode("utf-8")
    finally:
        advapi32.CredFree(cred_ptr)


if __name__ == "__main__":
    target = sys.argv[1]
    print(read_credential(target))
