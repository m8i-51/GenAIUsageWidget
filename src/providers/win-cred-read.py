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


def read_first_matching(pattern):
    # CredEnumerateW accepts a trailing "*" wildcard, e.g. "copilot-cli*".
    advapi32 = ctypes.windll.advapi32
    advapi32.CredEnumerateW.argtypes = [
        wintypes.LPWSTR,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
        ctypes.POINTER(ctypes.POINTER(ctypes.POINTER(CREDENTIAL)))
    ]
    advapi32.CredEnumerateW.restype = wintypes.BOOL

    count = wintypes.DWORD()
    creds = ctypes.POINTER(ctypes.POINTER(CREDENTIAL))()
    ok = advapi32.CredEnumerateW(pattern, 0, ctypes.byref(count), ctypes.byref(creds))
    if not ok:
        raise RuntimeError(f"CredEnumerateW failed for filter {pattern!r}")
    try:
        for i in range(count.value):
            cred = creds[i].contents
            if cred.CredentialBlobSize:
                buf = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
                return buf.decode("utf-8")
        raise RuntimeError(f"No credential blob for filter {pattern!r}")
    finally:
        advapi32.CredFree(creds)


if __name__ == "__main__":
    target = sys.argv[1]
    if target.endswith("*"):
        print(read_first_matching(target))
    else:
        print(read_credential(target))
