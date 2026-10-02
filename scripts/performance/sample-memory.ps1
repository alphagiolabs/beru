param(
  [Parameter(Mandatory = $true)][int]$RootPid,
  [Parameter(Mandatory = $true)][string]$Output,
  [ValidateRange(50, 5000)][int]$IntervalMs = 200
)

$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class BeruMemory {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  struct Entry {
    public uint size, usage, pid; public IntPtr heap;
    public uint module, threads, parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct Memory {
    public uint size, faults;
    public UIntPtr peak, rss, pagedPeak, paged, nonPeak, non, pagefile, peakpagefile, priv;
  }
  [StructLayout(LayoutKind.Sequential)]
  public class Available {
    public uint size, load;
    public ulong totalPhysical, physical, totalCommit, commit, totalVirtual, virtualFree, extended;
  }
  public class Data { public uint pid, parent; public string name; public ulong rss, priv; }
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref Entry e);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref Entry e);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("psapi.dll")] static extern bool GetProcessMemoryInfo(IntPtr h, out Memory m, uint size);
  [DllImport("kernel32.dll")] static extern bool GlobalMemoryStatusEx([In, Out] Available m);
  public static Available Free() {
    Available a = new Available(); a.size = (uint)Marshal.SizeOf(a);
    if (!GlobalMemoryStatusEx(a)) throw new Exception("GlobalMemoryStatusEx failed");
    return a;
  }
  public static Data[] Sample(uint root) {
    List<Entry> entries = new List<Entry>();
    IntPtr snap = CreateToolhelp32Snapshot(2, 0);
    try {
      Entry e = new Entry(); e.size = (uint)Marshal.SizeOf(e);
      if (!Process32FirstW(snap, ref e)) throw new Exception("Process snapshot failed");
      do { entries.Add(e); } while (Process32NextW(snap, ref e));
    } finally { CloseHandle(snap); }
    HashSet<uint> owned = new HashSet<uint>(); owned.Add(root);
    bool added;
    do {
      added = false;
      foreach (Entry e in entries) if (owned.Contains(e.parent) && owned.Add(e.pid)) added = true;
    } while (added);
    List<Data> data = new List<Data>();
    foreach (Entry e in entries) {
      if (!owned.Contains(e.pid)) continue;
      IntPtr h = OpenProcess(0x1000 | 0x10, false, e.pid);
      if (h == IntPtr.Zero) continue;
      try {
        Memory m;
        if (GetProcessMemoryInfo(h, out m, (uint)Marshal.SizeOf(typeof(Memory))))
          data.Add(new Data {pid=e.pid, parent=e.parent, name=e.exe, rss=m.rss.ToUInt64(), priv=m.priv.ToUInt64()});
      } finally { CloseHandle(h); }
    }
    return data.ToArray();
  }
}
'@

$writer = [IO.StreamWriter]::new($Output, $false)
try {
  Write-Output "ready"
  while ($true) {
    $items = @([BeruMemory]::Sample($RootPid))
    if (-not ($items | Where-Object { $_.pid -eq $RootPid })) { break }
    $free = [BeruMemory]::Free()
    $writer.WriteLine((@{
      stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
      availablePhysical = $free.physical
      availableCommit = $free.commit
      processes = @($items | ForEach-Object {
        @{ pid = $_.pid; parent = $_.parent; name = $_.name; rss = $_.rss; private = $_.priv }
      })
    } | ConvertTo-Json -Depth 5 -Compress))
    $writer.Flush()
    Start-Sleep -Milliseconds $IntervalMs
  }
} finally { $writer.Dispose() }
