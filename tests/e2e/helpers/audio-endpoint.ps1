param([string]$Action = 'get', [int]$Percent = 80, [int]$Muted = 0, [string]$Flow = 'render', [int]$Role = 1)
# Real Windows audio endpoint control for the mic journeys (QA-032).
# The fixture WAV is played through the REAL speakers, so the default render
# endpoint must actually be audible: this machine was found with
# "Speakers (2- Realtek(R) Audio)" at volume 0% and muted, which is why the
# real microphone never heard the fixture (BUGS.md QA-032).
# Reads/writes the Core Audio IAudioEndpointVolume of the default render device.
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  int RegisterEndpointNotificationCallback(IntPtr client);
  int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  int OpenPropertyStore(int access, out IntPtr store);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  int GetState(out int state);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation {
  int GetPeakValue(out float peak);
  int GetMeteringChannelCount(out uint count);
  int GetChannelsPeakValues(uint count, [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 0)] float[] peaks);
  int QueryHardwareSupport(out uint mask);
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr p);
  int UnregisterControlChangeNotify(IntPtr p);
  int GetChannelCount(out uint c);
  int SetMasterVolumeLevel(float level, Guid ctx);
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int GetMasterVolumeLevel(out float level);
  int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint ch, float level, Guid ctx);
  int SetChannelVolumeLevelScalar(uint ch, float level, Guid ctx);
  int GetChannelVolumeLevel(uint ch, out float level);
  int GetChannelVolumeLevelScalar(uint ch, out float level);
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  int GetVolumeStepInfo(out uint step, out uint count);
  int VolumeStepUp(Guid ctx);
  int VolumeStepDown(Guid ctx);
  int QueryHardwareSupport(out uint mask);
  int GetVolumeRange(out float min, out float max, out float inc);
}

public static class Endpoint {
  public static IAudioMeterInformation Meter(int flow, int role) {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice device;
    int hr = enumerator.GetDefaultAudioEndpoint(flow, role, out device);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    Guid iid = typeof(IAudioMeterInformation).GUID;
    object iface;
    hr = device.Activate(ref iid, 23, IntPtr.Zero, out iface);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    return (IAudioMeterInformation)iface;
  }
  public static float Peak(int flow, int role) {
    float p;
    Marshal.ThrowExceptionForHR(Meter(flow, role).GetPeakValue(out p));
    return p;
  }
  private static IAudioEndpointVolume Vol(int flow, int role) {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
    IMMDevice device;
    // eRender = 0, eCapture = 1; eMultimedia = 1
    int hr = enumerator.GetDefaultAudioEndpoint(flow, role, out device);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    object iface;
    // CLSCTX_ALL = 23
    hr = device.Activate(ref iid, 23, IntPtr.Zero, out iface);
    if (hr != 0) Marshal.ThrowExceptionForHR(hr);
    return (IAudioEndpointVolume)iface;
  }
  public static bool GetMute(int flow, int role) {
    bool m;
    Marshal.ThrowExceptionForHR(Vol(flow, role).GetMute(out m));
    return m;
  }
  public static int GetVolumePercent(int flow, int role) {
    float v;
    Marshal.ThrowExceptionForHR(Vol(flow, role).GetMasterVolumeLevelScalar(out v));
    return (int)Math.Round(v * 100);
  }
  public static void Set(int flow, int role, int percent, bool muted) {
    var vol = Vol(flow, role);
    Marshal.ThrowExceptionForHR(vol.SetMute(muted, Guid.Empty));
    Marshal.ThrowExceptionForHR(vol.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, percent)) / 100f, Guid.Empty));
  }
}
'@
Add-Type -TypeDefinition $code -Language CSharp | Out-Null
$flow = if ($Flow -eq 'capture') { 1 } else { 0 }
if ($Action -eq 'set') { [Endpoint]::Set($flow, $Role, $Percent, ($Muted -ne 0)) | Out-Null }
if ($Action -eq 'meter') {
  @{ action = 'meter'; flow = $Flow; peak = [Math]::Round([Endpoint]::Peak($flow, $Role), 4) } | ConvertTo-Json -Compress
  return
}
@{ muted = [Endpoint]::GetMute($flow, $Role); volume = [Endpoint]::GetVolumePercent($flow, $Role); action = $Action; flow = $Flow } | ConvertTo-Json -Compress
