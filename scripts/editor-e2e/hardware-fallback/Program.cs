using System;
using System.Diagnostics;
using System.Text;

static class FakeFfmpeg
{
    static int Main(string[] args)
    {
        string realFfmpeg = Environment.GetEnvironmentVariable("REAL_FFMPEG");
        if (string.IsNullOrEmpty(realFfmpeg))
        {
            Console.Error.WriteLine("fake-ffmpeg: REAL_FFMPEG is not set");
            return 2;
        }
        string joined = string.Join(" ", args);
        string mode = Environment.GetEnvironmentVariable("FAKE_QSV_MODE") ?? "";
        bool qsv = joined.Contains("h264_qsv");
        bool smokeTest = joined.Contains("-frames:v");
        if (qsv && (mode == "preflight" || (mode == "encode" && !smokeTest)))
        {
            Console.Error.WriteLine("[h264_qsv @ 0x0] Failed to initialize the QSV encoder: device not available");
            return 1;
        }
        var psi = new ProcessStartInfo(realFfmpeg) { UseShellExecute = false, Arguments = Join(args) };
        using (var process = Process.Start(psi))
        {
            process.WaitForExit();
            return process.ExitCode;
        }
    }

    // Windows command-line quoting: quote arguments with spaces or quotes, and double the backslashes that
    // come before a quote, so each argument reaches FFmpeg exactly as the processor passed it.
    static string Join(string[] args)
    {
        var sb = new StringBuilder();
        foreach (string arg in args)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (arg.Length > 0 && arg.IndexOfAny(new[] { ' ', '\t', '"' }) < 0)
            {
                sb.Append(arg);
                continue;
            }
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"') sb.Append('\\', backslashes * 2 + 1);
                else sb.Append('\\', backslashes);
                backslashes = 0;
                sb.Append(c);
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }
}
