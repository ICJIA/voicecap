/**
 * The recorder: what NVDA says aloud during a run, recorded, and no other sound. One Windows
 * PowerShell runs for the whole run with RECORDER_SCRIPT, whose C# it compiles with Add-Type at its
 * start, so nothing is installed. It records the sound of one process and of the processes that one
 * starts, with Windows' process loopback: never the whole device's sound, and never a microphone.
 * The Guidepup driver points it at the NVDA it started.
 *
 * No path reaches a command line or a shell. The script is fixed, and it's given with -Command as one
 * element of an argument array. Each command is one line of JSON on PowerShell's input, made
 * ASCII-safe as the replay's voice makes its lines (asciiJson), and each answer is one line of JSON
 * on its output, ASCII-safe too.
 *
 * Every error message here is the reason a page has no recording, as its record keeps it: a clause in
 * lowercase, with no full stop. None gives the path of the program it records, which is in Guidepup's
 * folder: it calls that program voicecap's NVDA (see Recorder.target).
 */
import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import { z } from "zod";

import {
  answerOf,
  asciiJson,
  clause,
  endedWith,
  settlesWithin,
  watch,
  type Ending,
} from "../../review-replay/voice.js";
import { EnvironmentError } from "../../util/errors.js";
import { powershellCommand } from "./windows.js";

/** What a recording was, as the helper says once it has stopped. */
export interface RecorderStop {
  /** The 16 kHz samples the PCM file holds. Frame 0 is the moment the recording started. */
  frames: number;
  /** The sound lost because the helper fell behind, in whole milliseconds: normally 0. */
  lostMs: number;
  /** The loudest sample, from 0 to 32,768. A recording that peaks at 2 or less is silent. */
  peak: number;
  /** When frame 0 was, as a UTC ISO time: "2026-10-09T14:03:07.215Z". */
  firstSampleAt: string;
  /** Whether the process recorded had exited by the stop: what follows its exit is silence. */
  targetExited: boolean;
}

/** The recorder, recording one program at a time: NVDA, during each page's attempt. */
export interface Recorder {
  /**
   * Points the recorder at process `pid`, once Windows says its program is `image` (letter case
   * aside). Not while it records. Its exit, whenever it comes, is kept for the stops that follow.
   * The recorder forgets its previous target first: after a target it refuses, it records nothing
   * until it takes another. A reason about the target never gives `image`: the program it was
   * asked for is "voicecap's NVDA", and the program it found there, as Windows names it, stays
   * ("process 4821 runs C:\Windows\System32\notepad.exe, not voicecap's NVDA").
   */
  target(pid: number, image: string): Promise<void>;
  /** Records the target into `pcmPath`, as 16 kHz mono 16-bit PCM, from now until stop(). */
  start(pcmPath: string): Promise<void>;
  /** Stops the recording, and says what it was. */
  stop(): Promise<RecorderStop>;
  /** Ends the helper, which stops any recording. It's safe to call twice. */
  close(): Promise<void>;
}

/** What the recorder needs of the program it starts. Node's ChildProcess has it. */
export interface RecorderChild {
  stdin: Writable;
  stdout: Readable;
  /** Where PowerShell says what went wrong. It's read as it comes, so it never fills. */
  stderr?: Readable;
  kill(): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
}

/**
 * How the helper starts: hidden, with its standard streams as pipes. There's no `shell` key, so
 * Node starts PowerShell itself, with each argument as it is, and no shell reads them.
 */
export const RECORDER_SPAWN_OPTIONS = { windowsHide: true, stdio: "pipe" } as const;

/** Starts the helper. The default is `node:child_process`'s spawn; tests give a fake. */
export type SpawnRecorder = (
  file: string,
  args: readonly string[],
  options: typeof RECORDER_SPAWN_OPTIONS,
) => RecorderChild;

/**
 * The helper's C#, which Add-Type compiles. It's C# 5, as Windows PowerShell 5.1 compiles it, and has
 * no comments of its own, as the whole script goes on PowerShell's command line, which Windows keeps
 * under 32,767 characters. What each part does:
 *
 * - **The activation.** `ActivateAudioInterfaceAsync` on the virtual device `VAD\Process_Loopback`,
 *   for an IAudioClient. Its parameters, AUDIOCLIENT_ACTIVATION_PARAMS (12 bytes: type 1,
 *   AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK; the process id; mode 0,
 *   PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE), go in a PROPVARIANT of type VT_BLOB (65):
 *   24 bytes on x64, with the size at offset 8 and the pointer at 16. The completion handler
 *   implements IAgileObject, as Windows calls it on a thread of its own. The parameters' memory is
 *   freed only once Windows has answered: when it hasn't within 3 seconds, the recording fails and
 *   the memory is never freed, as Windows may still read it.
 * - **The stream.** Initialize in shared mode with LOOPBACK, EVENTCALLBACK, SRC_DEFAULT_QUALITY, and
 *   AUTOCONVERTPCM, as 16 kHz mono 16-bit PCM: Windows converts NVDA's sound to it. A buffer of 1 s
 *   is asked for, though Windows keeps about 30 ms. GetMixFormat isn't supported (E_NOTIMPL), so the
 *   format is never asked for.
 * - **The thread.** One MTA thread at AboveNormal priority, started with the first recording and
 *   kept, makes, uses, and releases every COM object, one recording after another. PowerShell's own
 *   thread only hands it each recording, and waits for it to start or end.
 * - **The release.** However a recording ends, a stream that started is stopped (a second Stop()
 *   does nothing, and one that throws is caught, so the rest of the release still runs and the
 *   thread PowerShell waits on is always let go), and every COM object is released. The
 *   activation's operation reaches managed code twice, as ActivateAudioInterfaceAsync's out
 *   parameter and as the handler's argument, so its wrapper counts 2 and is released with
 *   FinalReleaseComObject: ReleaseComObject left it, and the IAudioClient it holds, to a garbage
 *   collection, a recording at a time. A handler called after the 3 seconds gets a new wrapper.
 * - **The timeline.** Frame 0 is the moment of IAudioClient.Start(). Each packet is placed at its QPC
 *   timestamp, in 100 ns units, 625 to a frame: the device position is always 0, so QPC is the only
 *   clock. Packets come every 10 ms, silence included, and a gap of 2 ms (32 frames) or more before
 *   one is filled with silence. Across a smaller one, the packet follows on, early by less than 2
 *   ms, and the next gap filled makes it up, as each is measured from frame 0. A part of a packet
 *   that falls before what's written is dropped. A packet flagged SILENT is written as silence, so is
 *   one that comes with no buffer address, and one flagged TIMESTAMP_ERROR follows on.
 * - **What's lost.** Windows keeps about 30 ms, and drops older sound unflagged when the helper falls
 *   behind; the gap in the timestamps shows it. A stream that opens or closes (NVDA starting to speak
 *   after a quiet spell) also leaves a gap, of 2.5 to 16.5 ms in the trial, with no sound lost: its
 *   packets keep the 10 ms rhythm, each read within about a millisecond of its end. A gap counts as
 *   lost (lostMs) when the packet after it was read more than half a period (5 ms) after its own end:
 *   it had waited for the helper, which had fallen behind the rhythm. In the trial, those waited 20
 *   ms or more.
 * - **The stop.** The stop's moment is when PowerShell read the command. The recording goes on until
 *   it has a packet that ends at or after that moment, or 30 ms have passed, and the file is then cut
 *   or filled to end there exactly.
 * - **The target.** QueryFullProcessImageName checks the process's program against the one named.
 *   A target command forgets the previous target first, so after one it refuses there's nothing to
 *   record: never the NVDA that was there before (Review Focus 1). The helper keeps the process's
 *   handle until the next target, so its id can't be given to another process meanwhile: a
 *   recording of a process that has exited is silent, never another program's.
 *   The handle shows the exit: PowerShell's loop asks every 20 ms, and says so once (target-exited).
 *   A stop says so (targetExited) from then on, until the next target.
 */
const RECORDER_CSHARP = String.raw`using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
namespace Voicecap {
[StructLayout(LayoutKind.Sequential)] public struct LoopbackParams { public int Type, Pid, Mode; }
[StructLayout(LayoutKind.Sequential)] public struct BlobVariant { public ushort Vt, R1, R2, R3; public int Size; public IntPtr Data; }
[StructLayout(LayoutKind.Sequential, Pack = 2)] public struct WaveFormat { public ushort Tag, Channels; public int Rate, BytesPerSecond; public ushort BlockAlign, Bits, Extra; }
[ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceAsyncOperation { void GetActivateResult(out int hr, [MarshalAs(UnmanagedType.IUnknown)] out object client); }
[ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IActivateAudioInterfaceCompletionHandler { void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation); }
[ComImport, Guid("94EA2B94-E9CC-49E0-C0FF-EE64CA8F5B90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAgileObject { }
[ComImport, Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioClient {
[PreserveSig] int Initialize(int shareMode, uint flags, long duration, long period, IntPtr format, IntPtr session);
[PreserveSig] int GetBufferSize(out int frames);
[PreserveSig] int GetStreamLatency(out long latency);
[PreserveSig] int GetCurrentPadding(out int frames);
[PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
[PreserveSig] int GetMixFormat(out IntPtr format);
[PreserveSig] int GetDevicePeriod(out long period, out long minimum);
[PreserveSig] int Start();
[PreserveSig] int Stop();
[PreserveSig] int Reset();
[PreserveSig] int SetEventHandle(IntPtr handle);
[PreserveSig] int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}
[ComImport, Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioCaptureClient {
[PreserveSig] int GetBuffer(out IntPtr data, out int frames, out int flags, out long position, out long qpc);
[PreserveSig] int ReleaseBuffer(int frames);
[PreserveSig] int GetNextPacketSize(out int frames);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class Activation : IActivateAudioInterfaceCompletionHandler, IAgileObject {
public readonly ManualResetEvent Done = new ManualResetEvent(false);
public int Hr = unchecked((int)0x80004005);
public object Client;
public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation operation) {
try { int hr; object client; operation.GetActivateResult(out hr, out client); Hr = hr; Client = client; }
catch (Exception e) { Hr = Marshal.GetHRForException(e); }
finally { Done.Set(); }
}
}
public sealed class Failure : Exception { public Failure(string message) : base(message) { } }
static class Native {
[DllImport("Mmdevapi.dll", ExactSpelling = true)] public static extern int ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string device, [MarshalAs(UnmanagedType.LPStruct)] Guid iid, IntPtr parameters, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation operation);
[DllImport("kernel32.dll")] public static extern void GetSystemTimePreciseAsFileTime(out long time);
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
[DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int size);
[DllImport("kernel32.dll")] public static extern int WaitForSingleObject(IntPtr handle, int milliseconds);
[DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
}
sealed class Recording {
public readonly int Pid; public readonly string Pcm;
public readonly ManualResetEvent Started = new ManualResetEvent(false), Finished = new ManualResetEvent(false);
public string Error; public bool Running; public long Start, Utc, Frames, Lost; public int Peak;
volatile bool stopping; long stopAt, end, packets;
FileStream file; byte[] buffer = new byte[3200];
static readonly byte[] Zeros = new byte[32000];
public Recording(int pid, string pcm) { Pid = pid; Pcm = pcm; }
public void Stop(long at) { Interlocked.Exchange(ref stopAt, at); stopping = true; }
long FrameAt(long qpc) { return (long)Math.Round((qpc - Start) / 625.0); }
static void Check(int hr, string what) { if (hr < 0) throw new Failure(Recorder.Failed(what, hr)); }
public void Run() {
IntPtr parameters = IntPtr.Zero, variant = IntPtr.Zero, format = IntPtr.Zero;
var activation = new Activation(); IActivateAudioInterfaceAsyncOperation operation = null;
IAudioClient client = null; IAudioCaptureClient capture = null; AutoResetEvent ready = null;
try {
try { file = new FileStream(Pcm, FileMode.Create, FileAccess.Write, FileShare.Read, 65536); }
catch (Exception e) { throw new Failure("the PCM file couldn't be created (" + e.Message + ")"); }
var loopback = new LoopbackParams(); loopback.Type = 1; loopback.Pid = Pid; loopback.Mode = 0;
parameters = Marshal.AllocHGlobal(Marshal.SizeOf(loopback)); Marshal.StructureToPtr(loopback, parameters, false);
var blob = new BlobVariant(); blob.Vt = 65; blob.Size = Marshal.SizeOf(loopback); blob.Data = parameters;
variant = Marshal.AllocHGlobal(Marshal.SizeOf(blob)); Marshal.StructureToPtr(blob, variant, false);
Check(Native.ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, variant, activation, out operation), "ActivateAudioInterfaceAsync");
if (!activation.Done.WaitOne(3000)) throw new Failure("Windows didn't open the recording within 3 seconds");
Check(activation.Hr, "ActivateAudioInterfaceAsync");
client = (IAudioClient)activation.Client;
var wave = new WaveFormat(); wave.Tag = 1; wave.Channels = 1; wave.Rate = 16000; wave.BytesPerSecond = 32000; wave.BlockAlign = 2; wave.Bits = 16;
format = Marshal.AllocHGlobal(Marshal.SizeOf(wave)); Marshal.StructureToPtr(wave, format, false);
Check(client.Initialize(0, 0x20000u | 0x40000u | 0x8000000u | 0x80000000u, 10000000, 0, format, IntPtr.Zero), "IAudioClient.Initialize");
ready = new AutoResetEvent(false);
Check(client.SetEventHandle(ready.SafeWaitHandle.DangerousGetHandle()), "IAudioClient.SetEventHandle");
object service; Check(client.GetService(typeof(IAudioCaptureClient).GUID, out service), "IAudioClient.GetService");
capture = (IAudioCaptureClient)service;
Start = Recorder.Now(); Native.GetSystemTimePreciseAsFileTime(out Utc);
Check(client.Start(), "IAudioClient.Start");
Running = true; Started.Set();
while (!stopping || (end < stopAt && Recorder.Now() - stopAt < 300000)) { ready.WaitOne(stopping ? 10 : 100); Drain(capture); }
client.Stop();
long last = FrameAt(stopAt);
if (Frames > last) { file.SetLength(last * 2); Frames = last; } else Silence(last - Frames);
file.Flush();
} catch (Exception e) {
Error = e is Failure ? e.Message : e is IOException ? "the PCM file couldn't be written (" + e.Message + ")" : e.Message;
} finally {
if (Running) { try { client.Stop(); } catch (Exception) { } }
if (file != null) { try { file.Dispose(); } catch (Exception) { } if (!Running) try { File.Delete(Pcm); } catch (Exception) { } }
if (capture != null) Marshal.ReleaseComObject(capture);
if (client != null) Marshal.ReleaseComObject(client);
if (operation != null) Marshal.FinalReleaseComObject(operation);
if (ready != null) ready.Dispose();
if (operation == null || activation.Done.WaitOne(0)) { Marshal.FreeHGlobal(parameters); Marshal.FreeHGlobal(variant); }
Marshal.FreeHGlobal(format);
Started.Set(); Finished.Set();
}
}
void Drain(IAudioCaptureClient capture) {
while (true) {
int next; Check(capture.GetNextPacketSize(out next), "IAudioCaptureClient.GetNextPacketSize");
if (next == 0) return;
IntPtr data; int frames, flags; long position, qpc;
int hr = capture.GetBuffer(out data, out frames, out flags, out position, out qpc);
if (hr == 0x08890001) return;
Check(hr, "IAudioCaptureClient.GetBuffer");
try { Place(data, frames, flags, qpc, Recorder.Now()); } finally { capture.ReleaseBuffer(frames); }
}
}
void Place(IntPtr data, int frames, int flags, long qpc, long arrival) {
long gap = (flags & 4) != 0 ? 0 : FrameAt(qpc) - Frames;
if (gap >= 32) { if (packets > 0 && arrival - qpc - frames * 625L > 50000) Lost += gap; Silence(gap); gap = 0; }
int skip = (int)Math.Min(frames, Math.Max(0, -gap));
if ((flags & 2) != 0 || data == IntPtr.Zero) Silence(frames - skip); else Copy(data, skip, frames - skip);
end = qpc + frames * 625L; packets++;
}
void Copy(IntPtr data, int skip, int count) {
int bytes = count * 2;
if (buffer.Length < bytes) buffer = new byte[bytes];
Marshal.Copy(data + skip * 2, buffer, 0, bytes);
for (int i = 0; i < bytes; i += 2) { int sample = Math.Abs((int)(short)(buffer[i] | buffer[i + 1] << 8)); if (sample > Peak) Peak = sample; }
file.Write(buffer, 0, bytes); Frames += count;
}
void Silence(long count) {
for (long left = count * 2; left > 0; left -= Zeros.Length) file.Write(Zeros, 0, (int)Math.Min(left, Zeros.Length));
Frames += count;
}
}
public static class Recorder {
static IntPtr target = IntPtr.Zero; static int targetPid; static bool exitSaid;
static Recording current; static volatile Recording next; static Thread worker;
static readonly AutoResetEvent work = new AutoResetEvent(false);
public static long Now() { long t = Stopwatch.GetTimestamp(); return Stopwatch.Frequency == 10000000 ? t : (long)(t * (10000000.0 / Stopwatch.Frequency)); }
public static string Ready(int build) { return "{\"ready\":{\"build\":" + build + "}}"; }
public static string Error(string why) { return "{\"error\":" + Text(why) + "}"; }
public static string Target(int pid, string image) {
if (current != null) return Error("the recorder can't change programs while it records");
if (target != IntPtr.Zero) Native.CloseHandle(target);
target = IntPtr.Zero; targetPid = 0; exitSaid = false;
IntPtr process = Native.OpenProcess(0x101000, false, pid);
if (process == IntPtr.Zero) { int code = Marshal.GetLastWin32Error(); return Error(code == 87 ? "process " + pid + " isn't running" : "process " + pid + " can't be opened (Windows error " + code + ")"); }
var name = new StringBuilder(32768); int size = name.Capacity;
bool read = Native.QueryFullProcessImageName(process, 0, name, ref size);
int error = Marshal.GetLastWin32Error(); string program = name.ToString();
if (!read || !string.Equals(Full(program), Full(image), StringComparison.OrdinalIgnoreCase)) {
Native.CloseHandle(process);
return Error(read ? "process " + pid + " runs " + program + ", not " + image : "process " + pid + "'s program can't be read (Windows error " + error + ")");
}
target = process; targetPid = pid;
return "{\"targeted\":{\"pid\":" + pid + "}}";
}
public static string Start(string pcm) {
if (current != null) return Error("a recording is already running");
if (target == IntPtr.Zero) return Error("the recorder has no program to record");
if (worker == null) { worker = new Thread(Work); worker.SetApartmentState(ApartmentState.MTA); worker.Priority = ThreadPriority.AboveNormal; worker.IsBackground = true; worker.Start(); }
var recording = new Recording(targetPid, pcm);
next = recording; work.Set(); recording.Started.WaitOne();
if (!recording.Running) { recording.Finished.WaitOne(); return Error("the recording couldn't start: " + recording.Error); }
current = recording;
return "{\"started\":{\"at\":\"" + Iso(recording.Utc) + "\"}}";
}
public static string Stop(long at) {
Recording recording = current;
if (recording == null) return Error("no recording is running");
current = null; recording.Stop(at); recording.Finished.WaitOne();
if (recording.Error != null) return Error("the recording failed: " + recording.Error);
bool exited = exitSaid || Native.WaitForSingleObject(target, 0) == 0;
return "{\"stopped\":{\"frames\":" + recording.Frames + ",\"lostMs\":" + (long)Math.Round(recording.Lost / 16.0) + ",\"peak\":" + recording.Peak + ",\"firstSampleAt\":\"" + Iso(recording.Utc) + "\",\"targetExited\":" + (exited ? "true" : "false") + "}}";
}
public static string TargetExit() {
if (target == IntPtr.Zero || exitSaid || Native.WaitForSingleObject(target, 0) != 0) return null;
exitSaid = true;
return "{\"target-exited\":{\"pid\":" + targetPid + "}}";
}
public static void Quit() { Recording recording = current; current = null; if (recording != null) { recording.Stop(Now()); recording.Finished.WaitOne(); } }
public static string Failed(string what, int hr) {
string code = "0x" + hr.ToString("X8");
if (hr == unchecked((int)0x88890004)) return "the sound device changed or went away (" + code + " AUDCLNT_E_DEVICE_INVALIDATED)";
if (hr == unchecked((int)0x88890010)) return "Windows' audio service isn't running (" + code + " AUDCLNT_E_SERVICE_NOT_RUNNING)";
return what + " failed (" + code + ")";
}
static void Work() { while (true) { work.WaitOne(); Recording recording = next; next = null; if (recording != null) recording.Run(); } }
static string Full(string path) { try { return Path.GetFullPath(path); } catch (Exception) { return path; } }
static string Iso(long utc) { return DateTime.FromFileTimeUtc(utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture); }
static string Text(string value) {
var json = new StringBuilder("\"");
foreach (char c in value) {
if (c == '"' || c == '\\') json.Append('\\').Append(c);
else if (c < ' ' || c > '~') json.Append("\\u").Append(((int)c).ToString("x4"));
else json.Append(c);
}
return json.Append('"').ToString();
}
}
}`;

/** The registry's build number, which the script reads in a way Constrained Language Mode allows. */
const BUILD_LOOKUP = String.raw`[int](Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuildNumber`;

/**
 * The script the recorder runs in Windows PowerShell 5.1, given with -Command: Windows' default
 * execution policy refuses to run a .ps1 file, and Group Policy can keep it so, but no policy
 * applies to a script given with -Command. Its lines are joined with line breaks, which the C#'s
 * here-string needs.
 *
 * **Setup.** It checks the Windows build first: process loopback needs 20348 or later. That's
 * Windows 11 or Windows Server 2022, and the failure says so in those words: no desktop Windows 10
 * reaches that build (they end at 19045), so "Windows 10 build 20348" would be misread. Then it
 * compiles its C# with Add-Type. Either failure is one line, {"failed":…}, and exit code 1. Until
 * Add-Type has worked, it writes only with the cmdlets and the few methods Constrained Language Mode
 * allows (where Add-Type fails), so that line still reaches voicecap, and in ASCII. Once it's ready,
 * it says {"ready":{"build":N}}.
 *
 * **The loop.** It reads one line of JSON at a time on its input, with ReadLineAsync, waiting 20 ms
 * at a time, and between waits writes {"target-exited":{"pid":N}} when the target has exited. It
 * reads each line as data (ConvertFrom-Json) and answers it with one line:
 * - {"target":{"pid":N,"image":"…"}}: {"targeted":{"pid":N}}, or {"error":…} when the process isn't
 *   running, its program isn't `image`, or a recording is running. Unless a recording is running,
 *   the previous target is forgotten either way;
 * - {"start":{"pcm":"…"}}: {"started":{"at":"…"}}, the UTC time of frame 0, or {"error":…};
 * - {"stop":true}: {"stopped":{…RecorderStop}}, or {"error":…} when the recording failed, as it does
 *   when the sound device goes away; the next start records afresh;
 * - {"quit":true}: no answer; it stops any recording and ends, as it does when its input ends.
 * The stop's moment is taken as its line is read, before PowerShell parses it.
 */
export const RECORDER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  // The failure's line, in ASCII alone, written as Constrained Language Mode allows.
  "function Send-Failure([string]$why) {",
  "$json = ConvertTo-Json -Compress -InputObject @{ failed = $why }",
  String.raw`$ascii = ''; foreach ($c in $json.ToCharArray()) { $n = [int]$c; if ($n -gt 126) { $ascii += '\u' + $n.ToString('x4') } else { $ascii += $c } }`,
  "Write-Output $ascii",
  "exit 1",
  "}",
  "$build = 0",
  `try { $build = ${BUILD_LOOKUP} } catch {}`,
  `if ($build -lt 20348) { Send-Failure "recording one program's sound needs Windows 11 or Windows Server 2022 (Windows build 20348 or later); this is build $build" }`,
  "$source = @'",
  RECORDER_CSHARP,
  "'@",
  'try { Add-Type -TypeDefinition $source } catch { Send-Failure ("PowerShell couldn\'t compile its C#: " + $_.Exception.Message) }',
  "[Console]::Out.WriteLine([Voicecap.Recorder]::Ready($build))",
  "$in = New-Object System.IO.StreamReader([Console]::OpenStandardInput())",
  "$next = $in.ReadLineAsync()",
  "try {",
  "while ($true) {",
  "$exited = [Voicecap.Recorder]::TargetExit()",
  "if ($null -ne $exited) { [Console]::Out.WriteLine($exited) }",
  "if (-not $next.Wait(20)) { continue }",
  "$at = [Voicecap.Recorder]::Now()",
  "$line = $next.Result",
  "if ($null -eq $line) { break }",
  "$next = $in.ReadLineAsync()",
  "try {",
  "$command = ConvertFrom-Json -InputObject $line",
  "if ($command.quit) { break }",
  "if ($null -ne $command.target) { $answer = [Voicecap.Recorder]::Target([int]$command.target.pid, [string]$command.target.image) }",
  "elseif ($null -ne $command.start) { $answer = [Voicecap.Recorder]::Start([string]$command.start.pcm) }",
  "elseif ($command.stop) { $answer = [Voicecap.Recorder]::Stop($at) }",
  "else { $answer = [Voicecap.Recorder]::Error('the recorder doesn''t know the command ' + $line) }",
  "} catch { $answer = [Voicecap.Recorder]::Error('the recorder couldn''t follow the command ' + $line + ' (' + $_.Exception.Message + ')') }",
  "[Console]::Out.WriteLine($answer)",
  "}",
  // The end of the input, a quit, or a failure: any recording is stopped before PowerShell ends.
  "} finally { [Voicecap.Recorder]::Quit() }",
].join("\n");

/** How many of the lines PowerShell writes to its error output say why it stopped. */
const COMPLAINT_LINES = 3;

/**
 * What a reason calls the program the recorder is pointed at: voicecap's NVDA, never its path. The
 * path is in Guidepup's folder, and a reason is repeated word for word by the pages and the Word
 * copy of a report, where Guidepup isn't named.
 */
const NVDA_NAME = "voicecap's NVDA";

/** Why each call rejects once the helper has been ended for not answering. */
const STOPPED_ANSWERING = "the recorder stopped answering";

/** What a reason begins with when the helper couldn't start: "the recorder didn't start: …". */
const DIDNT_START = "the recorder didn't start";

/** What a reason begins with when the helper has ended: "the recorder stopped: PowerShell ended …". */
const ENDED = "the recorder stopped";

/**
 * Whether `reason`, as a page's record keeps it, says the helper is gone for the rest of the run:
 * it didn't start, stopped answering, or ended. Each call after that rejects with the same reason,
 * so every page after it has it. Any other reason the recorder gives is one page's: a target or a
 * start the helper refused, a recording that failed. The words are the messages' own, below, built
 * from the same pieces. (The run asks voiceIsGone, which counts one more reason, the driver's.)
 */
export function recorderIsGone(reason: string): boolean {
  return (
    reason.startsWith(`${DIDNT_START}:`) ||
    reason.startsWith(STOPPED_ANSWERING) ||
    reason.startsWith(`${ENDED}:`)
  );
}

/**
 * Why a page has no recording when NVDA's process couldn't be found: the driver gives it, as no
 * recorder has a say in it. It looks the process up once, as NVDA starts, so every page until NVDA
 * is started again gives it, as there is no process to point the recorder at.
 */
export const NO_NVDA_PROCESS = "NVDA's process wasn't found";

/**
 * Whether `reason`, as a page's record keeps it, says that no page after it will have a recording
 * either, until something changes: the helper is gone (recorderIsGone), or NVDA's process wasn't
 * found (NO_NVDA_PROCESS), which every page of that start of NVDA says. The run says so once in a
 * session, when the first page does (see audit.ts). Any other reason is one page's: NVDA's process
 * ending during its recording, a target or a start the helper refused, a recording that failed or
 * is empty or silent.
 */
export function voiceIsGone(reason: string): boolean {
  return recorderIsGone(reason) || reason.startsWith(NO_NVDA_PROCESS);
}

/** Why each call rejects after close(). */
const CLOSED = "the recorder was closed";

/** The answers a command waits for, by the command they answer. */
type Answer = "targeted" | "started" | "stopped";

/** A stop's answer, as the helper gives it. */
const STOPPED = z.object({
  frames: z.number().int().nonnegative(),
  lostMs: z.number().nonnegative(),
  peak: z.number().int().min(0).max(32_768),
  firstSampleAt: z.iso.datetime(),
  targetExited: z.boolean(),
});

/**
 * The recorder: one Windows PowerShell, hidden, running `script` (RECORDER_SCRIPT) for the whole run.
 *
 * It resolves once the helper says it's ready. It rejects with an EnvironmentError that says why,
 * "the recorder didn't start: …", when the helper says it can't (its reason, with the first lines
 * PowerShell wrote to its error output), PowerShell can't be started or ends first, or there's no
 * answer within `readyMs`; then it kills PowerShell.
 *
 * Each command waits for its answer, one at a time: calling another meanwhile throws an Error, as
 * that's a bug in the caller. A command the helper answers with an error rejects with an
 * EnvironmentError that says the helper's reason, and the helper goes on: the next start records
 * again. A command the helper hasn't answered within `commandMs` rejects, "the recorder stopped
 * answering", and the helper is killed. Once it's been killed, has ended, or has been closed, every
 * command rejects, with why.
 *
 * `close()` stops any recording: it sends quit, then ends PowerShell's input, which ends the script,
 * and kills PowerShell if it hasn't ended after `commandMs`.
 */
export async function startRecorder(
  options: {
    spawnRecorder?: SpawnRecorder;
    script?: string;
    readyMs?: number;
    commandMs?: number;
  } = {},
): Promise<Recorder> {
  const spawnRecorder: SpawnRecorder = options.spawnRecorder ?? spawn;
  const { script = RECORDER_SCRIPT, readyMs = 20_000, commandMs = 5_000 } = options;
  const child = spawnRecorder(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", powershellCommand(script)],
    RECORDER_SPAWN_OPTIONS,
  );
  // Writing to a program that has ended fails on its input. The end itself is heard below.
  child.stdin.on("error", () => {});

  /** The first lines with words PowerShell wrote to its error output. */
  const complaints: string[] = [];
  /** Why PowerShell stopped, as it said, in brackets after the clause it's part of; or nothing. */
  const reason = (): string =>
    complaints.length === 0 ? "" : ` (${clause(complaints.join(" "))})`;
  /** How PowerShell ended, with what it said, or why it couldn't be started. */
  const howItEnded = (ending: Ending): string =>
    "error" in ending
      ? `PowerShell couldn't be started (${clause(ending.error.message)})`
      : `${endedWith("PowerShell", ending.code)}${reason()}`;

  /** Until the helper has said whether it's ready: hears each line it writes. */
  let starting: ((answer: Record<string, unknown>) => void) | null = null;
  /** The command waiting for its answer: the answer it takes, and what settles it. */
  let waiting: {
    answer: Answer;
    take: (value: unknown) => void;
    fail: (error: Error) => void;
  } | null = null;
  /** Why every command rejects, once the helper can't answer any more. */
  let broken: string | null = null;
  /** The process the helper records, once it has said so, and whether it has said that one exited. */
  let target: number | null = null;
  let targetExited = false;
  /** The path of the program the helper was last asked to record: what no reason may give. */
  let pointedAt: string | null = null;

  /**
   * What the helper says in a reason, with the path of the program the recorder is pointed at
   * replaced by its name. The helper repeats the path it was sent: in its refusal of a target ("process
   * 4821 runs <a program>, not <that path>"), and in the line it echoes of a command it can't follow
   * or doesn't know, where the path is as JSON spells it. The program it found is left as it is.
   */
  const unnamed = (message: string): string => {
    if (pointedAt === null || pointedAt === "") return message;
    return [pointedAt, asciiJson(pointedAt).slice(1, -1)].reduce(
      (said, path) => said.split(path).join(NVDA_NAME),
      message,
    );
  };

  /** From now on, every command rejects with `why`, the waiting one too. The first reason stays. */
  const fail = (why: string): void => {
    broken ??= why;
    waiting?.fail(new EnvironmentError(broken));
  };

  const ended = watch(
    child,
    (line) => {
      const answer = answerOf(line);
      if (starting !== null) {
        starting(answer);
        return;
      }
      const exited = answer["target-exited"];
      if (isObject(exited) && exited.pid === target) targetExited = true;
      if (waiting === null) return;
      // A line that answers nothing, as a later helper might add, is skipped.
      if (typeof answer.error === "string") {
        waiting.fail(new EnvironmentError(clause(unnamed(answer.error))));
      } else if (waiting.answer in answer) {
        waiting.take(answer[waiting.answer]);
      }
    },
    (complaint) => {
      if (complaint.trim() !== "" && complaints.length < COMPLAINT_LINES) {
        complaints.push(complaint.trim());
      }
    },
  );

  const why = await new Promise<string | null>((resolve) => {
    /** The helper's own reason it can't start, once it has given one. */
    let failed: string | null = null;
    const answered = (value: string | null): void => {
      clearTimeout(timer);
      starting = null;
      resolve(value);
    };
    const timer = setTimeout(
      () => answered(`PowerShell didn't answer within ${readyMs / 1000} seconds${reason()}`),
      readyMs,
    );
    starting = (answer) => {
      if (isObject(answer.ready)) {
        answered(null);
      } else if (typeof answer.failed === "string" && failed === null) {
        failed = clause(answer.failed);
        clearTimeout(timer);
        // PowerShell can say more on its error output as it ends: it's heard until then.
        void settlesWithin(ended, commandMs).then(() => answered(`${failed}${reason()}`));
      }
    };
    void ended.then((ending) =>
      answered(failed === null ? howItEnded(ending) : `${failed}${reason()}`),
    );
  });
  if (why !== null) {
    child.kill();
    throw new EnvironmentError(`${DIDNT_START}: ${why}`);
  }
  void ended.then((ending) => fail(`${ENDED}: ${howItEnded(ending)}`));

  /**
   * Sends `command`, and settles with its answer as `read` reads it, or with the error `read` gives
   * for an answer it can't read. `read` runs as the answer's line is read, before the line after it.
   */
  const send = <T>(
    command: object,
    answer: Answer,
    read: (value: unknown) => T | EnvironmentError,
  ): Promise<T> => {
    if (waiting !== null) throw new Error("The recorder is already answering a command.");
    if (broken !== null) return Promise.reject(new EnvironmentError(broken));
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Ended, so no answer can come late.
        fail(STOPPED_ANSWERING);
        child.kill();
      }, commandMs);
      const settled = (): void => {
        clearTimeout(timer);
        waiting = null;
      };
      waiting = {
        answer,
        take: (value) => {
          settled();
          const result = read(value);
          if (result instanceof EnvironmentError) reject(result);
          else resolve(result);
        },
        fail: (error) => {
          settled();
          reject(error);
        },
      };
      child.stdin.write(`${asciiJson(command)}\n`);
    });
  };

  let closing: Promise<void> | null = null;
  return {
    target(pid, image) {
      const targeting = send({ target: { pid, image } }, "targeted", () => {
        target = pid;
        targetExited = false;
      });
      // Sent: the helper forgets its target before it looks at this one, whether or not it takes
      // it, and so does this. Its path is the one to leave out of the reasons that follow.
      target = null;
      targetExited = false;
      pointedAt = image;
      return targeting;
    },
    start(pcmPath) {
      return send({ start: { pcm: pcmPath } }, "started", () => undefined);
    },
    stop() {
      return send({ stop: true }, "stopped", (value) => {
        const stopped = STOPPED.safeParse(value);
        if (!stopped.success) {
          return new EnvironmentError("the recorder's answer to a stop couldn't be read");
        }
        // Once the helper has said the target exited, every stop says so until the next target,
        // whatever its own answer says.
        return { ...stopped.data, targetExited: stopped.data.targetExited || targetExited };
      });
    },
    close() {
      closing ??= (async () => {
        fail(CLOSED);
        child.stdin.write(`${asciiJson({ quit: true })}\n`);
        child.stdin.end();
        if (!(await settlesWithin(ended, commandMs))) child.kill();
      })();
      return closing;
    },
  };
}

/** Whether `value` is an object, as a line of JSON's parts are. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
