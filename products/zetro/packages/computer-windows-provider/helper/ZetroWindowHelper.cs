// ==++==
//
//   ZETRO Windows Native Read-Only Observation & Target-Scoped Text Helper
//   Bounded Win32 & UIAutomation Window Discovery, Inspection & Text Operation Provider
//
// ==--==

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace Zetro.Computer.Native
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct MOUSEKEYBDHARDWAREINPUT
    {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
        [FieldOffset(0)]
        public MOUSEINPUT mi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT
    {
        public uint type;
        public MOUSEKEYBDHARDWAREINPUT mkhi;
    }

    public static class NativeMethods
    {
        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_HWHEEL = 0x1000;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        public const uint KEYEVENTF_KEYDOWN = 0x0000;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint KEYEVENTF_SCANCODE = 0x0008;

        public const uint WM_GETTEXT = 0x000D;
        public const uint WM_GETTEXTLENGTH = 0x000E;
        public const uint WM_SETTEXT = 0x000C;

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int GetWindowTextLength(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint GetDpiForWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, StringBuilder lParam);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, [In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetThreadDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr GetDC(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll", SetLastError = true)]
        public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);
    }

    public class WindowRecord
    {
        public long Hwnd { get; set; }
        public int ProcessId { get; set; }
        public string ProcessName { get; set; }
        public bool Minimized { get; set; }
        public bool Visible { get; set; }
        public string Generation { get; set; }
        public string Title { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
        public int Dpi { get; set; }
    }

    public class Program
    {
        static string admittedLocation=null,admittedFocusClass=null;
        public const int MAX_TEXT_LENGTH = 4096;
        public const int MAX_TEXT_BYTES = 16384;

        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                string command = "enumerate";
                int limit = 256;
                bool includeTitles = false;
                bool explorerOnly = false;
                long targetHwnd = 0;
                string targetText = null;
                int expectedPid = 0;
                string expectedStart = null;
                string sessionId = null;
                long grantExpiry = 0;
                bool inputEnabled = false;

                string mouseActionType = "click";
                int mouseX = 0;
                int mouseY = 0;
                int mouseEndX = 0;
                int mouseEndY = 0;
                int mouseDeltaX = 0;
                int mouseDeltaY = 0;
                int mouseDuration = 200;
                string mouseButton = "left";
                string mouseClickType = "single";
                string pressKeysList = null;
                string captureOutputFile = null;

                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--enumerate")
                    {
                        command = "enumerate";
                    }
                    else if (args[i] == "--inspect" && i + 1 < args.Length)
                    {
                        command = "inspect";
                        long.TryParse(args[++i], out targetHwnd);
                    }
                    else if (args[i] == "--read-text" && i + 1 < args.Length)
                    {
                        command = "read-text";
                        long.TryParse(args[++i], out targetHwnd);
                    }
                    else if (args[i] == "--write-text" && i + 1 < args.Length)
                    {
                        command = "write-text";
                        long.TryParse(args[++i], out targetHwnd);
                    }
                    else if(args[i]=="--expected-location" && i+1<args.Length){admittedLocation=args[++i];}
                    else if(args[i]=="--expected-focus-class" && i+1<args.Length){admittedFocusClass=args[++i];}
                    else if (args[i] == "--hwnd" && i + 1 < args.Length) { long.TryParse(args[++i], out targetHwnd); }
                    else if (args[i] == "--explorer-state" && i + 1 < args.Length) {command="explorer-state";long.TryParse(args[++i],out targetHwnd);}
                    else if (args[i] == "--focus-window" && i + 1 < args.Length) {command="focus-window";long.TryParse(args[++i],out targetHwnd);}
                    else if (args[i] == "--downloads-path") {command="downloads-path";}
                    else if (args[i] == "--mouse-action")
                    {
                        command = "mouse-action";
                    }
                    else if (args[i] == "--action-type" && i + 1 < args.Length)
                    {
                        mouseActionType = args[++i];
                    }
                    else if (args[i] == "--x" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseX);
                    }
                    else if (args[i] == "--y" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseY);
                    }
                    else if (args[i] == "--end-x" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseEndX);
                    }
                    else if (args[i] == "--end-y" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseEndY);
                    }
                    else if (args[i] == "--delta-x" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseDeltaX);
                    }
                    else if (args[i] == "--delta-y" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseDeltaY);
                    }
                    else if (args[i] == "--duration" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out mouseDuration);
                    }
                    else if (args[i] == "--button" && i + 1 < args.Length)
                    {
                        mouseButton = args[++i];
                    }
                    else if (args[i] == "--click-type" && i + 1 < args.Length)
                    {
                        mouseClickType = args[++i];
                    }
                    else if (args[i] == "--press-keys")
                    {
                        command = "press-keys";
                    }
                    else if (args[i] == "--type-text")
                    {
                        command = "type-text";
                    }
                    else if (args[i] == "--keys" && i + 1 < args.Length)
                    {
                        pressKeysList = args[++i];
                    }
                    else if (args[i] == "--capture-screen")
                    {
                        command = "capture-screen";
                    }
                    else if (args[i] == "--output-file" && i + 1 < args.Length)
                    {
                        captureOutputFile = args[++i];
                    }
                    else if (args[i] == "--text" && i + 1 < args.Length)
                    {
                        targetText = args[++i];
                    }
                    else if (args[i] == "--expected-pid" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out expectedPid);
                    }
                    else if (args[i] == "--expected-start" && i + 1 < args.Length)
                    {
                        expectedStart = args[++i];
                    }
                    else if (args[i] == "--session" && i + 1 < args.Length)
                    {
                        sessionId = args[++i];
                    }
                    else if (args[i] == "--grant-expiry" && i + 1 < args.Length)
                    {
                        long.TryParse(args[++i], out grantExpiry);
                    }
                    else if (args[i] == "--input-enabled")
                    {
                        inputEnabled = true;
                    }
                    else if (args[i] == "--limit" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out limit);
                    }
                    else if (args[i] == "--explorer-windows") {explorerOnly=true;}
                    else if (args[i] == "--include-titles")
                    {
                        includeTitles = true;
                    }
                }

                if(command=="downloads-path") return RunDownloadsPath();
                if(command=="explorer-state") return RunExplorerState(targetHwnd,expectedPid,expectedStart);
                if(command=="focus-window") {
                    int gate=CheckScopedInput(targetHwnd,expectedPid,expectedStart,sessionId,grantExpiry,inputEnabled,false);
                    if(gate!=0)return gate;
                    var handle=new IntPtr(targetHwnd);
                    if(NativeMethods.GetForegroundWindow()!=handle){
                        NativeMethods.SetForegroundWindow(handle);
                        Thread.Sleep(50);
                        if(NativeMethods.GetForegroundWindow()!=handle){
                            try {AutomationElement.FromHandle(handle).SetFocus();}catch{}
                            Thread.Sleep(50);
                        }
                    }
                    gate=CheckScopedInput(targetHwnd,expectedPid,expectedStart,sessionId,grantExpiry,inputEnabled,true);
                    if(gate!=0)return gate;
                    Console.WriteLine("{\"status\":\"focused\"}");return 0;
                }
                if (command == "enumerate")
                {
                    return RunEnumerate(limit, includeTitles, explorerOnly);
                }
                else if (command == "inspect")
                {
                    return RunInspect(targetHwnd);
                }
                else if (command == "read-text")
                {
                    return RunReadText(targetHwnd, expectedPid, expectedStart);
                }
                else if (command == "write-text")
                {
                    return RunWriteText(targetHwnd, targetText, expectedPid, expectedStart, sessionId, grantExpiry, inputEnabled);
                }
                else if (command == "mouse-action")
                {
                    int gate=CheckScopedInput(targetHwnd,expectedPid,expectedStart,sessionId,grantExpiry,inputEnabled,mouseActionType!="move"&&mouseActionType!="mousemove");
                    if(gate!=0)return gate;
                    return RunMouseAction(mouseActionType, mouseX, mouseY, mouseEndX, mouseEndY, mouseDeltaX, mouseDeltaY, mouseDuration, mouseButton, mouseClickType, sessionId, grantExpiry, inputEnabled);
                }
                else if (command == "press-keys")
                {
                    int gate=CheckScopedInput(targetHwnd,expectedPid,expectedStart,sessionId,grantExpiry,inputEnabled,true);
                    if(gate!=0)return gate;
                    return RunPressKeys(pressKeysList, sessionId, grantExpiry, inputEnabled,targetHwnd,expectedPid,expectedStart);
                }
                else if (command == "type-text")
                {
                    int gate=CheckScopedInput(targetHwnd,expectedPid,expectedStart,sessionId,grantExpiry,inputEnabled,true);
                    if(gate!=0)return gate;
                    if(string.IsNullOrEmpty(targetText)||targetText.Length>MAX_TEXT_LENGTH||Encoding.UTF8.GetByteCount(targetText)>MAX_TEXT_BYTES)return 1;
                    return RunTypeText(targetText, sessionId, grantExpiry, inputEnabled,targetHwnd,expectedPid,expectedStart);
                }
                else if (command == "capture-screen")
                {
                    return RunCaptureScreen(captureOutputFile);
                }

                Console.Error.WriteLine("Unknown command: " + command);
                return 1;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Helper fatal error: " + ex.Message);
                return 2;
            }
        }

        private static int RunEnumerate(int limit, bool includeTitles, bool explorerOnly)
        {
            var windows = new List<WindowRecord>();
            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

            NativeMethods.EnumWindows((hWnd, lParam) =>
            {
                if (windows.Count >= limit) return false;

                try
                {
                    var record = CollectWindowRecord(hWnd, includeTitles);
                    if (record != null && (!explorerOnly || (record.ProcessName.ToLowerInvariant()=="explorer" && record.Visible && !record.Minimized && record.Width>200 && record.Height>100)))
                    {
                        windows.Add(record);
                    }
                }
                catch
                {
                    // Fail safe on single window query exception; continue enumeration
                }

                return true;
            }, IntPtr.Zero);

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"generation\":\"").Append(nowMs).Append("\",");
            sb.Append("\"observedAt\":").Append(nowMs).Append(",");
            sb.Append("\"windows\":[");

            for (int i = 0; i < windows.Count; i++)
            {
                if (i > 0) sb.Append(",");
                AppendWindowJson(sb, windows[i]);
            }

            sb.Append("]}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        private static int RunInspect(long hwndVal)
        {
            if (hwndVal <= 0)
            {
                Console.Error.WriteLine("Invalid HWND for inspect: " + hwndVal);
                return 1;
            }

            IntPtr hWnd = new IntPtr(hwndVal);
            var record = CollectWindowRecord(hWnd, true);
            if (record == null)
            {
                Console.Error.WriteLine("Window not found or inaccessible: " + hwndVal);
                return 3;
            }

            string uiaName = record.Title;
            string uiaType = "Window";
            bool uiaSupported = false;

            try
            {
                AutomationElement el = AutomationElement.FromHandle(hWnd);
                if (el != null)
                {
                    uiaSupported = true;
                    uiaName = el.Current.Name ?? record.Title;
                    uiaType = el.Current.ControlType != null ? el.Current.ControlType.ProgrammaticName : "Window";
                }
            }
            catch
            {
                uiaSupported = false;
            }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"status\":\"inspected\",");
            sb.Append("\"window\":");
            AppendWindowJson(sb, record);
            sb.Append(",");
            sb.Append("\"automation\":{");
            sb.Append("\"supported\":").Append(uiaSupported ? "true" : "false").Append(",");
            sb.Append("\"controlType\":").Append(JsonEscape(uiaType)).Append(",");
            sb.Append("\"name\":").Append(JsonEscape(uiaName));
            sb.Append("}");
            sb.Append("}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        [DllImport("shell32.dll")]
        static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid id,uint flags,IntPtr token,out IntPtr path);

        private static int RunDownloadsPath() {
            IntPtr pointer;
            int result=SHGetKnownFolderPath(new Guid("374DE290-123F-4565-9164-39C4925E467B"),0,IntPtr.Zero,out pointer);
            if(result!=0)return 3;
            try {Console.OutputEncoding=Encoding.UTF8;Console.WriteLine("{\"path\":"+JsonEscape(Marshal.PtrToStringUni(pointer))+"}");}
            finally {Marshal.FreeCoTaskMem(pointer);}return 0;
        }

        private static int CheckScopedInput(long hwnd,int pid,string start,string session,long expiry,bool enabled,bool foreground) {
            if(!enabled)return 10;
            if(string.IsNullOrWhiteSpace(session)||expiry<=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds())return 11;
            if(hwnd<=0||pid<=0||string.IsNullOrWhiteSpace(start))return 4;
            var record=CollectWindowRecord(new IntPtr(hwnd),false);
            if(record==null||record.ProcessId!=pid||record.Generation!=start)return 5;
            if(!record.Visible||record.Minimized)return 6;
            if(foreground&&NativeMethods.GetForegroundWindow()!=new IntPtr(hwnd))return 7;
            if(admittedLocation!=null) {
                string actual=GetExplorerLocation(hwnd);
                if(actual==null||!string.Equals(Path.GetFullPath(actual).TrimEnd('\\'),Path.GetFullPath(admittedLocation).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))return 5;
            }
            if(admittedFocusClass!=null) {
                var focused=AutomationElement.FocusedElement;
                if(focused==null||focused.Current.ClassName!=admittedFocusClass)return 7;
                var current=focused;bool owned=false;
                for(int i=0;i<24&&current!=null;i++){
                    if(current.Current.NativeWindowHandle==hwnd){owned=true;break;}
                    current=TreeWalker.ControlViewWalker.GetParent(current);
                }
                if(!owned)return 7;
            }
            if(CheckHumanInterruption())return 13;
            return 0;
        }

        private static string GetExplorerLocation(long hwnd) {
            dynamic shell=Activator.CreateInstance(Type.GetTypeFromProgID("Shell.Application"));
            try {
                foreach(dynamic window in shell.Windows()) {
                    if((long)window.HWND==hwnd)return (string)window.Document.Folder.Self.Path;
                }
                return null;
            } finally {Marshal.FinalReleaseComObject(shell);}
        }

        private static int RunExplorerState(long hwnd,int pid,string start) {
            var record=CollectWindowRecord(new IntPtr(hwnd),true);
            if(record==null||record.ProcessId!=pid||record.Generation!=start||record.ProcessName.ToLowerInvariant()!="explorer")return 5;
            string folder=null,editValue=null,controlType=null,focusId=null,focusClass=null,ancestors="";
            bool rename=false;
            folder=GetExplorerLocation(hwnd);
            if(folder==null)return 3;
            var focused=AutomationElement.FocusedElement;
            if(focused!=null&&NativeMethods.GetForegroundWindow()==new IntPtr(hwnd)) {
                focusId=focused.Current.AutomationId;focusClass=focused.Current.ClassName;
                var current=focused;bool owned=false;
                for(int i=0;i<24&&current!=null;i++) {
                    ancestors+=current.Current.ControlType.ProgrammaticName+":"+current.Current.ClassName+":"+current.Current.AutomationId+"/";
                    if(current.Current.NativeWindowHandle==hwnd){owned=true;break;}
                    if(current.Current.ControlType==ControlType.ListItem||current.Current.ControlType==ControlType.DataItem||
                       (focused.Current.ClassName=="UIRenameTextElement"&&current.Current.ClassName=="UIItemsView"))rename=true;
                    current=TreeWalker.ControlViewWalker.GetParent(current);
                }
                if(owned&&focused.Current.ControlType==ControlType.Edit) {
                    object pattern;
                    controlType="Edit";
                    if(focused.TryGetCurrentPattern(ValuePattern.Pattern,out pattern))editValue=((ValuePattern)pattern).Current.Value;
                } else rename=false;
            }
            var bounds=Screen.FromHandle(new IntPtr(hwnd)).Bounds;
            POINT cursor;NativeMethods.GetCursorPos(out cursor);
            var sb=new StringBuilder();sb.Append("{\"status\":\"explorer_state\",\"window\":");AppendWindowJson(sb,record);
            sb.Append(",\"location\":").Append(JsonEscape(folder));
            sb.Append(",\"focusedEdit\":").Append(JsonEscape(editValue));
            sb.Append(",\"pointer\":{\"x\":").Append(cursor.X).Append(",\"y\":").Append(cursor.Y).Append("}");
            sb.Append(",\"renameActive\":").Append(rename&&controlType=="Edit"?"true":"false");
            sb.Append(",\"focusId\":").Append(JsonEscape(focusId));
            sb.Append(",\"focusClass\":").Append(JsonEscape(focusClass));
            sb.Append(",\"focusAncestors\":").Append(JsonEscape(ancestors));
            sb.Append(",\"displayBounds\":{\"x\":").Append(bounds.X).Append(",\"y\":").Append(bounds.Y).Append(",\"width\":").Append(bounds.Width).Append(",\"height\":").Append(bounds.Height).Append("}}");
            Console.OutputEncoding=Encoding.UTF8;Console.WriteLine(sb.ToString());return 0;
        }

        private static int RunReadText(long hwndVal, int expectedPid, string expectedStart)
        {
            if (hwndVal <= 0)
            {
                Console.Error.WriteLine("Invalid HWND for read-text: " + hwndVal);
                return 1;
            }

            IntPtr hWnd = new IntPtr(hwndVal);
            var record = CollectWindowRecord(hWnd, true);
            if (record == null)
            {
                Console.Error.WriteLine("Target window not found: " + hwndVal);
                return 3;
            }

            // Target identity validation
            if (expectedPid > 0 && record.ProcessId != expectedPid)
            {
                Console.Error.WriteLine("PID mismatch: expected " + expectedPid + ", actual " + record.ProcessId);
                return 4;
            }

            if (!string.IsNullOrEmpty(expectedStart) && record.Generation != expectedStart.Trim())
            {
                Console.Error.WriteLine("Start identity mismatch: expected exact '" + expectedStart.Trim() + "', actual '" + record.Generation + "'");
                return 5;
            }

            string text = "";
            string method = "none";

            // 1. Try UIAutomation ValuePattern or TextPattern on target or descendant edit control
            try
            {
                AutomationElement root = AutomationElement.FromHandle(hWnd);
                if (root != null)
                {
                    // Find edit control in target window
                    var cond = new OrCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document)
                    );

                    AutomationElement edit = root.FindFirst(TreeScope.Element | TreeScope.Descendants, cond);
                    if (edit != null)
                    {
                        object valPatternObj;
                        if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out valPatternObj))
                        {
                            var vp = (ValuePattern)valPatternObj;
                            text = vp.Current.Value ?? "";
                            method = "UIA_ValuePattern";
                        }
                        else
                        {
                            object textPatternObj;
                            if (edit.TryGetCurrentPattern(TextPattern.Pattern, out textPatternObj))
                            {
                                var tp = (TextPattern)textPatternObj;
                                text = tp.DocumentRange.GetText(-1) ?? "";
                                method = "UIA_TextPattern";
                            }
                        }
                    }
                }
            }
            catch
            {
                // UIAutomation traversal error; fallback to Win32 edit message
            }

            // 2. Fallback: Win32 WM_GETTEXT on child Edit control
            if (method == "none")
            {
                IntPtr editHwnd = NativeMethods.FindWindowEx(hWnd, IntPtr.Zero, "Edit", null);
                if (editHwnd != IntPtr.Zero)
                {
                    var sbText = new StringBuilder(65536);
                    NativeMethods.SendMessage(editHwnd, NativeMethods.WM_GETTEXT, new IntPtr(sbText.Capacity), sbText);
                    text = sbText.ToString();
                    method = "WM_GETTEXT";
                }
                else
                {
                    // Check if top-level window itself handles WM_GETTEXT
                    var sbText = new StringBuilder(65536);
                    NativeMethods.SendMessage(hWnd, NativeMethods.WM_GETTEXT, new IntPtr(sbText.Capacity), sbText);
                    text = sbText.ToString();
                    method = "WM_GETTEXT_TOPLEVEL";
                }
            }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"status\":\"read\",");
            sb.Append("\"hwnd\":").Append(record.Hwnd).Append(",");
            sb.Append("\"processId\":").Append(record.ProcessId).Append(",");
            sb.Append("\"method\":").Append(JsonEscape(method)).Append(",");
            sb.Append("\"text\":").Append(JsonEscape(text)).Append(",");
            sb.Append("\"charCount\":").Append(text.Length);
            sb.Append("}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        private static int RunWriteText(long hwndVal, string text, int expectedPid, string expectedStart, string sessionId, long grantExpiry, bool inputEnabled)
        {
            if (hwndVal <= 0)
            {
                Console.Error.WriteLine("Invalid HWND for write-text: " + hwndVal);
                return 1;
            }

            // 1. Policy check: input must be explicitly authorized
            if (!inputEnabled)
            {
                Console.Error.WriteLine("Input is disabled by policy (default inputdisabled). Explicit authorization required.");
                return 10;
            }

            // 2. Full non-empty exact identity required
            if (expectedPid <= 0)
            {
                Console.Error.WriteLine("Missing or invalid expectedPid for write-text: positive integer required");
                return 4;
            }

            if (string.IsNullOrEmpty(expectedStart) || string.IsNullOrEmpty(expectedStart.Trim()))
            {
                Console.Error.WriteLine("Missing or empty expectedStart generation token for write-text");
                return 5;
            }

            if (string.IsNullOrEmpty(sessionId) || string.IsNullOrEmpty(sessionId.Trim()))
            {
                Console.Error.WriteLine("Missing or empty sessionId for write-text");
                return 12;
            }

            // 3. Text content and length limits
            if (text == null || text.Length == 0)
            {
                Console.Error.WriteLine("Missing or empty text to write");
                return 1;
            }

            if (text.Length > MAX_TEXT_LENGTH || Encoding.UTF8.GetByteCount(text) > MAX_TEXT_BYTES)
            {
                Console.Error.WriteLine("Text exceeds declared limit (" + MAX_TEXT_LENGTH + " characters / " + MAX_TEXT_BYTES + " UTF-8 bytes)");
                return 1;
            }

            // 4. Policy check: grant expiry must be non-zero and in the future
            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (grantExpiry <= 0 || nowMs >= grantExpiry)
            {
                Console.Error.WriteLine("Authorization grant expired (now=" + nowMs + ", expiry=" + grantExpiry + "). Execution prohibited.");
                return 11;
            }

            IntPtr hWnd = new IntPtr(hwndVal);
            var record = CollectWindowRecord(hWnd, true);
            if (record == null)
            {
                Console.Error.WriteLine("Target window not found: " + hwndVal);
                return 3;
            }

            // 5. Target identity validation: exact PID and exact process start generation
            if (record.ProcessId != expectedPid)
            {
                Console.Error.WriteLine("Process PID mismatch: expected " + expectedPid + ", got " + record.ProcessId);
                return 4;
            }

            if (record.Generation != expectedStart.Trim())
            {
                Console.Error.WriteLine("Start identity mismatch: expected exact '" + expectedStart.Trim() + "', got '" + record.Generation + "'");
                return 5;
            }

            if (!record.Visible || record.Minimized)
            {
                Console.Error.WriteLine("Target window must be visible and not minimized to accept text");
                return 6;
            }

            string method = "none";
            bool uiaAttempted = false;

            // 1. Primary: UIAutomation ValuePattern.SetValue
            try
            {
                AutomationElement root = AutomationElement.FromHandle(hWnd);
                if (root != null)
                {
                    var cond = new OrCondition(
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                        new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document)
                    );

                    AutomationElement edit = root.FindFirst(TreeScope.Element | TreeScope.Descendants, cond);
                    if (edit != null)
                    {
                        object valPatternObj;
                        if (edit.TryGetCurrentPattern(ValuePattern.Pattern, out valPatternObj) && valPatternObj != null)
                        {
                            var vp = (ValuePattern)valPatternObj;

                            // Recheck identity and grant expiry immediately before native effect
                            nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                            if (nowMs >= grantExpiry)
                            {
                                Console.Error.WriteLine("Authorization grant expired prior to ValuePattern invocation");
                                return 11;
                            }

                            var preEffectRecord = CollectWindowRecord(hWnd, false);
                            if (preEffectRecord == null || preEffectRecord.ProcessId != expectedPid || preEffectRecord.Generation != expectedStart.Trim())
                            {
                                Console.Error.WriteLine("Target identity changed prior to ValuePattern invocation");
                                return 5;
                            }

                            uiaAttempted = true;
                            vp.SetValue(text);
                            method = "UIA_ValuePattern";
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                // If UIA was attempted, it might have partially executed.
                // Strictly fail closed: uncertain state -> stop immediately, NO fallback to SendInput.
                if (uiaAttempted)
                {
                    Console.Error.WriteLine("UIAutomation ValuePattern invocation failed or uncertain: " + ex.Message + ". Fallback SendInput prohibited to prevent duplicate/corrupted input.");
                    return 14;
                }
            }

            // 2. Fallback: Scoped SendInput with KEYEVENTF_UNICODE only if UIA was not found / not attempted
            if (method == "none")
            {
                // If UIA was attempted and failed, do not reach here
                if (uiaAttempted)
                {
                    Console.Error.WriteLine("UIAutomation was attempted; cannot proceed with fallback SendInput due to uncertain control state");
                    return 14;
                }

                IntPtr fg = NativeMethods.GetForegroundWindow();
                if (fg != hWnd)
                {
                    NativeMethods.SetForegroundWindow(hWnd);
                    Thread.Sleep(50);
                    fg = NativeMethods.GetForegroundWindow();
                }

                if (fg != hWnd)
                {
                    Console.Error.WriteLine("Cannot send input: failed to verify target window is in foreground");
                    return 7;
                }

                // Recheck identity and grant expiry immediately before SendInput
                nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (nowMs >= grantExpiry)
                {
                    Console.Error.WriteLine("Authorization grant expired prior to SendInput invocation");
                    return 11;
                }

                var fgRecheck = CollectWindowRecord(hWnd, false);
                if (fgRecheck == null || fgRecheck.ProcessId != expectedPid || fgRecheck.Generation != expectedStart.Trim())
                {
                    Console.Error.WriteLine("Target identity changed prior to SendInput invocation");
                    return 5;
                }

                if (!fgRecheck.Visible || fgRecheck.Minimized)
                {
                    Console.Error.WriteLine("Target window is no longer visible or active prior to SendInput");
                    return 6;
                }

                // Send each Unicode character cleanly via SendInput
                var inputs = new List<INPUT>();
                foreach (char c in text)
                {
                    var down = new INPUT
                    {
                        type = NativeMethods.INPUT_KEYBOARD,
                        mkhi = new MOUSEKEYBDHARDWAREINPUT
                        {
                            ki = new KEYBDINPUT
                            {
                                wVk = 0,
                                wScan = (ushort)c,
                                dwFlags = NativeMethods.KEYEVENTF_UNICODE,
                                time = 0,
                                dwExtraInfo = IntPtr.Zero
                            }
                        }
                    };

                    var up = new INPUT
                    {
                        type = NativeMethods.INPUT_KEYBOARD,
                        mkhi = new MOUSEKEYBDHARDWAREINPUT
                        {
                            ki = new KEYBDINPUT
                            {
                                wVk = 0,
                                wScan = (ushort)c,
                                dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP,
                                time = 0,
                                dwExtraInfo = IntPtr.Zero
                            }
                        }
                    };

                    inputs.Add(down);
                    inputs.Add(up);
                }

                uint sent = NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
                if (sent == 0)
                {
                    Console.Error.WriteLine("SendInput failed to inject characters");
                    return 8;
                }
                method = "Scoped_SendInput_Unicode";
            }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"status\":\"written\",");
            sb.Append("\"hwnd\":").Append(record.Hwnd).Append(",");
            sb.Append("\"processId\":").Append(record.ProcessId).Append(",");
            sb.Append("\"method\":").Append(JsonEscape(method)).Append(",");
            sb.Append("\"charsWritten\":").Append(text.Length);
            sb.Append("}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        private static bool CheckHumanInterruption()
        {
            const int VK_LBUTTON = 0x01;
            const int VK_RBUTTON = 0x02;
            const int VK_ESCAPE = 0x1B;
            if ((NativeMethods.GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0 ||
                (NativeMethods.GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0 ||
                (NativeMethods.GetAsyncKeyState(VK_ESCAPE) & 0x8000) != 0)
            {
                return true;
            }
            return false;
        }

        private static void SendMouseClick(uint downFlag, uint upFlag)
        {
            SendMouseDown(downFlag);
            Thread.Sleep(50);
            SendMouseUp(upFlag);
        }

        private static void SendMouseDown(uint downFlag)
        {
            var inputs = new INPUT[1];
            inputs[0] = new INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                mkhi = new MOUSEKEYBDHARDWAREINPUT
                {
                    mi = new MOUSEINPUT { dwFlags = downFlag }
                }
            };
            NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendMouseUp(uint upFlag)
        {
            var inputs = new INPUT[1];
            inputs[0] = new INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                mkhi = new MOUSEKEYBDHARDWAREINPUT
                {
                    mi = new MOUSEINPUT { dwFlags = upFlag }
                }
            };
            NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static void SendMouseScroll(uint flag, int amount)
        {
            var inputs = new INPUT[1];
            inputs[0] = new INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                mkhi = new MOUSEKEYBDHARDWAREINPUT
                {
                    mi = new MOUSEINPUT { dwFlags = flag, mouseData = (uint)amount }
                }
            };
            NativeMethods.SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        private static int RunMouseAction(string actionType, int x, int y, int endX, int endY, int deltaX, int deltaY, int duration, string button, string clickType, string sessionId, long grantExpiry, bool inputEnabled)
        {
            if (!inputEnabled)
            {
                Console.Error.WriteLine("Input execution is not enabled on this endpoint");
                return 10;
            }

            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (grantExpiry > 0 && nowMs >= grantExpiry)
            {
                Console.Error.WriteLine("Authorization grant expired (now=" + nowMs + ", expiry=" + grantExpiry + "). Execution prohibited.");
                return 11;
            }

            if (CheckHumanInterruption())
            {
                Console.Error.WriteLine("Human interruption detected (physical input during execution)");
                return 13;
            }

            Rectangle screenBounds = Screen.PrimaryScreen.Bounds;
            x = Math.Max(0, Math.Min(screenBounds.Width - 1, x));
            y = Math.Max(0, Math.Min(screenBounds.Height - 1, y));

            uint downFlag = NativeMethods.MOUSEEVENTF_LEFTDOWN;
            uint upFlag = NativeMethods.MOUSEEVENTF_LEFTUP;
            string btn = (button ?? "left").ToLowerInvariant();
            if (btn == "right")
            {
                downFlag = NativeMethods.MOUSEEVENTF_RIGHTDOWN;
                upFlag = NativeMethods.MOUSEEVENTF_RIGHTUP;
            }
            else if (btn == "middle")
            {
                downFlag = NativeMethods.MOUSEEVENTF_MIDDLEDOWN;
                upFlag = NativeMethods.MOUSEEVENTF_MIDDLEUP;
            }

            string act = (actionType ?? "click").ToLowerInvariant();
            if (act == "click")
            {
                NativeMethods.SetCursorPos(x, y);
                Thread.Sleep(20);

                int clicks = 1;
                string ct = (clickType ?? "single").ToLowerInvariant();
                if (ct == "double") clicks = 2;
                else if (ct == "triple") clicks = 3;

                for (int c = 0; c < clicks; c++)
                {
                    if (CheckHumanInterruption())
                    {
                        Console.Error.WriteLine("Human interruption detected during click sequence");
                        return 13;
                    }
                    SendMouseClick(downFlag, upFlag);
                    if (c < clicks - 1) Thread.Sleep(60);
                }
            }
            else if (act == "move" || act == "mousemove")
            {
                POINT curPos;
                NativeMethods.GetCursorPos(out curPos);
                int steps = Math.Max(5, Math.Min(50, duration / 10));
                int sleepPerStep = Math.Max(5, duration / steps);

                for (int i = 1; i <= steps; i++)
                {
                    if (CheckHumanInterruption())
                    {
                        Console.Error.WriteLine("Human interruption detected during mouse move");
                        return 13;
                    }
                    double t = (double)i / steps;
                    int curX = (int)(curPos.X + (x - curPos.X) * t);
                    int curY = (int)(curPos.Y + (y - curPos.Y) * t);
                    NativeMethods.SetCursorPos(curX, curY);
                    Thread.Sleep(sleepPerStep);
                }
                NativeMethods.SetCursorPos(x, y);
            }
            else if (act == "drag")
            {
                NativeMethods.SetCursorPos(x, y);
                Thread.Sleep(30);

                SendMouseDown(downFlag);
                Thread.Sleep(40);

                endX = Math.Max(0, Math.Min(screenBounds.Width - 1, endX));
                endY = Math.Max(0, Math.Min(screenBounds.Height - 1, endY));

                int steps = Math.Max(10, Math.Min(60, duration / 10));
                int sleepPerStep = Math.Max(5, duration / steps);

                for (int i = 1; i <= steps; i++)
                {
                    if (CheckHumanInterruption())
                    {
                        SendMouseUp(upFlag);
                        Console.Error.WriteLine("Human interruption detected during drag");
                        return 13;
                    }
                    double t = (double)i / steps;
                    int curX = (int)(x + (endX - x) * t);
                    int curY = (int)(y + (endY - y) * t);
                    NativeMethods.SetCursorPos(curX, curY);
                    Thread.Sleep(sleepPerStep);
                }
                NativeMethods.SetCursorPos(endX, endY);
                Thread.Sleep(40);

                SendMouseUp(upFlag);
            }
            else if (act == "scroll")
            {
                if (x >= 0 && y >= 0)
                {
                    NativeMethods.SetCursorPos(x, y);
                    Thread.Sleep(20);
                }
                if (deltaY != 0)
                {
                    SendMouseScroll(NativeMethods.MOUSEEVENTF_WHEEL, deltaY * 120);
                }
                if (deltaX != 0)
                {
                    SendMouseScroll(NativeMethods.MOUSEEVENTF_HWHEEL, deltaX * 120);
                }
            }
            else
            {
                Console.Error.WriteLine("Unknown mouse action type: " + act);
                return 1;
            }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"status\":\"completed\",");
            sb.Append("\"action\":\"mouse-action\",");
            sb.Append("\"type\":").Append(JsonEscape(act)).Append(",");
            sb.Append("\"x\":").Append(x).Append(",");
            sb.Append("\"y\":").Append(y);
            sb.Append("}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        private static int RunPressKeys(string keysList, string sessionId, long grantExpiry, bool inputEnabled,long hwnd,int pid,string start)
        {
            if (!inputEnabled)
            {
                Console.Error.WriteLine("Input execution is not enabled on this endpoint");
                return 10;
            }

            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (grantExpiry > 0 && nowMs >= grantExpiry)
            {
                Console.Error.WriteLine("Authorization grant expired (now=" + nowMs + ", expiry=" + grantExpiry + "). Execution prohibited.");
                return 11;
            }

            if (string.IsNullOrEmpty(keysList))
            {
                Console.Error.WriteLine("No keys specified for press-keys");
                return 1;
            }

            if (CheckHumanInterruption())
            {
                Console.Error.WriteLine("Human interruption detected before key press");
                return 13;
            }

            string[] parts;
            if (keysList.Contains("+"))
            {
                parts = keysList.Split(new char[] { '+' }, StringSplitOptions.RemoveEmptyEntries);
            }
            else
            {
                parts = keysList.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            }

            var vkList = new List<ushort>();
            foreach (var part in parts)
            {
                ushort vk = ResolveVirtualKey(part.Trim());
                if (vk == 0)
                {
                    Console.Error.WriteLine("Unrecognized key name: " + part.Trim());
                    return 1;
                }
                vkList.Add(vk);
            }

            var downInputs = new List<INPUT>();
            foreach (var vk in vkList)
            {
                ushort scan = (ushort)NativeMethods.MapVirtualKey((uint)vk, 0);
                downInputs.Add(new INPUT
                {
                    type = NativeMethods.INPUT_KEYBOARD,
                    mkhi = new MOUSEKEYBDHARDWAREINPUT
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = vk,
                            wScan = scan,
                            dwFlags = NativeMethods.KEYEVENTF_KEYDOWN,
                            time = 0,
                            dwExtraInfo = IntPtr.Zero
                        }
                    }
                });
            }

            int gate=CheckScopedInput(hwnd,pid,start,sessionId,grantExpiry,inputEnabled,true);if(gate!=0)return gate;
            uint downSent=NativeMethods.SendInput((uint)downInputs.Count, downInputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
            Thread.Sleep(30);

            var upInputs = new List<INPUT>();
            for (int i = vkList.Count - 1; i >= 0; i--)
            {
                ushort vk = vkList[i];
                ushort scan = (ushort)NativeMethods.MapVirtualKey((uint)vk, 0);
                upInputs.Add(new INPUT
                {
                    type = NativeMethods.INPUT_KEYBOARD,
                    mkhi = new MOUSEKEYBDHARDWAREINPUT
                    {
                        ki = new KEYBDINPUT
                        {
                            wVk = vk,
                            wScan = scan,
                            dwFlags = NativeMethods.KEYEVENTF_KEYUP,
                            time = 0,
                            dwExtraInfo = IntPtr.Zero
                        }
                    }
                });
            }

            uint upSent=NativeMethods.SendInput((uint)upInputs.Count, upInputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
            if(downSent!=downInputs.Count||upSent!=upInputs.Count){Console.Error.WriteLine("Partial keyboard input; outcome uncertain");return 14;}

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"status\":\"completed\",");
            sb.Append("\"action\":\"press-keys\",");
            sb.Append("\"keys\":").Append(JsonEscape(keysList)).Append(",");
            sb.Append("\"count\":").Append(vkList.Count);
            sb.Append("}");

            Console.OutputEncoding = Encoding.UTF8;
            Console.WriteLine(sb.ToString());
            return 0;
        }

        private static int RunTypeText(string text, string sessionId, long grantExpiry, bool inputEnabled,long hwnd,int pid,string start)
        {
            if (!inputEnabled)
            {
                Console.Error.WriteLine("Input execution is not enabled on this endpoint");
                return 10;
            }

            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (grantExpiry > 0 && nowMs >= grantExpiry)
            {
                Console.Error.WriteLine("Authorization grant expired (now=" + nowMs + ", expiry=" + grantExpiry + "). Execution prohibited.");
                return 11;
            }

            if (string.IsNullOrEmpty(text))
            {
                Console.Error.WriteLine("Missing or empty text for type-text");
                return 1;
            }

            if (CheckHumanInterruption())
            {
                Console.Error.WriteLine("Human interruption detected before typing text");
                return 13;
            }

            try
            {
                var inputs = new List<INPUT>();
                foreach (char c in text)
                {
                    inputs.Add(new INPUT
                    {
                        type = NativeMethods.INPUT_KEYBOARD,
                        mkhi = new MOUSEKEYBDHARDWAREINPUT
                        {
                            ki = new KEYBDINPUT
                            {
                                wVk = 0,
                                wScan = (ushort)c,
                                dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYDOWN,
                                time = 0,
                                dwExtraInfo = IntPtr.Zero
                            }
                        }
                    });
                    inputs.Add(new INPUT
                    {
                        type = NativeMethods.INPUT_KEYBOARD,
                        mkhi = new MOUSEKEYBDHARDWAREINPUT
                        {
                            ki = new KEYBDINPUT
                            {
                                wVk = 0,
                                wScan = (ushort)c,
                                dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP,
                                time = 0,
                                dwExtraInfo = IntPtr.Zero
                            }
                        }
                    });
                }

                int gate=CheckScopedInput(hwnd,pid,start,sessionId,grantExpiry,inputEnabled,true);if(gate!=0)return gate;
                uint sent = NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
                if (sent != inputs.Count)
                {
                    Console.Error.WriteLine("SendInput failed to type characters");
                    return 8;
                }

                var sb = new StringBuilder();
                sb.Append("{");
                sb.Append("\"status\":\"completed\",");
                sb.Append("\"action\":\"type-text\",");
                sb.Append("\"charsTyped\":").Append(text.Length);
                sb.Append("}");

                Console.OutputEncoding = Encoding.UTF8;
                Console.WriteLine(sb.ToString());
                return 0;
            }
            finally { }
        }

        private static ushort ResolveVirtualKey(string keyName)
        {
            string k = keyName.ToLowerInvariant();
            switch (k)
            {
                case "ctrl":
                case "control": return 0x11;
                case "lctrl":
                case "lcontrol": return 0xA2;
                case "rctrl":
                case "rcontrol": return 0xA3;
                case "alt":
                case "menu": return 0x12;
                case "lalt":
                case "ralt": return 0xA4;
                case "shift": return 0x10;
                case "lshift": return 0xA0;
                case "rshift": return 0xA1;
                case "win":
                case "windows":
                case "super":
                case "meta": return 0x5B;
                case "enter":
                case "return": return 0x0D;
                case "tab": return 0x09;
                case "space": return 0x20;
                case "backspace":
                case "back": return 0x08;
                case "escape":
                case "esc": return 0x1B;
                case "del":
                case "delete": return 0x2E;
                case "ins":
                case "insert": return 0x2D;
                case "home": return 0x24;
                case "end": return 0x23;
                case "pageup":
                case "pgup": return 0x21;
                case "pagedown":
                case "pgdn": return 0x22;
                case "up":
                case "arrowup": return 0x26;
                case "down":
                case "arrowdown": return 0x28;
                case "left":
                case "arrowleft": return 0x25;
                case "right":
                case "arrowright": return 0x27;
                case "f1": return 0x70;
                case "f2": return 0x71;
                case "f3": return 0x72;
                case "f4": return 0x73;
                case "f5": return 0x74;
                case "f6": return 0x75;
                case "f7": return 0x76;
                case "f8": return 0x77;
                case "f9": return 0x78;
                case "f10": return 0x79;
                case "f11": return 0x7A;
                case "f12": return 0x7B;
                default:
                    if (k.Length == 1)
                    {
                        char ch = k[0];
                        if (ch >= 'a' && ch <= 'z') return (ushort)(0x41 + (ch - 'a'));
                        if (ch >= '0' && ch <= '9') return (ushort)(0x30 + (ch - '0'));
                    }
                    return 0;
            }
        }

        private static int RunCaptureScreen(string outputFile)
        {
            IntPtr inputDesk = IntPtr.Zero;
            try
            {
                try
                {
                    inputDesk = NativeMethods.OpenInputDesktop(0, false, 0x01FF);
                    if (inputDesk != IntPtr.Zero)
                    {
                        NativeMethods.SetThreadDesktop(inputDesk);
                    }
                }
                catch
                {
                    // Fall back if desktop switch is not available
                }

                Rectangle bounds = SystemInformation.VirtualScreen;
                if (bounds.Width <= 0 || bounds.Height <= 0)
                {
                    bounds = Screen.PrimaryScreen.Bounds;
                }

                Bitmap bmp = null;
                IntPtr hdcSrc = NativeMethods.GetDC(IntPtr.Zero);
                if (hdcSrc != IntPtr.Zero)
                {
                    IntPtr hdcDest = NativeMethods.CreateCompatibleDC(hdcSrc);
                    if (hdcDest != IntPtr.Zero)
                    {
                        IntPtr hBitmap = NativeMethods.CreateCompatibleBitmap(hdcSrc, bounds.Width, bounds.Height);
                        if (hBitmap != IntPtr.Zero)
                        {
                            IntPtr hOld = NativeMethods.SelectObject(hdcDest, hBitmap);
                            bool ok = NativeMethods.BitBlt(hdcDest, 0, 0, bounds.Width, bounds.Height, hdcSrc, bounds.X, bounds.Y, 0x00CC0020);
                            NativeMethods.SelectObject(hdcDest, hOld);
                            NativeMethods.DeleteDC(hdcDest);
                            NativeMethods.ReleaseDC(IntPtr.Zero, hdcSrc);
                            if (ok)
                            {
                                bmp = Image.FromHbitmap(hBitmap);
                            }
                            NativeMethods.DeleteObject(hBitmap);
                        }
                        else
                        {
                            NativeMethods.DeleteDC(hdcDest);
                            NativeMethods.ReleaseDC(IntPtr.Zero, hdcSrc);
                        }
                    }
                    else
                    {
                        NativeMethods.ReleaseDC(IntPtr.Zero, hdcSrc);
                    }
                }

                if (bmp == null)
                {
                    bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size, CopyPixelOperation.SourceCopy);
                    }
                }

                using (bmp)
                {
                    string base64Data = null;
                    if (!string.IsNullOrEmpty(outputFile))
                    {
                        string dir = Path.GetDirectoryName(outputFile);
                        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        {
                            Directory.CreateDirectory(dir);
                        }
                        bmp.Save(outputFile, ImageFormat.Png);
                    }
                    else
                    {
                        using (var ms = new MemoryStream())
                        {
                            bmp.Save(ms, ImageFormat.Png);
                            base64Data = Convert.ToBase64String(ms.ToArray());
                        }
                    }

                    var sb = new StringBuilder();
                    sb.Append("{");
                    sb.Append("\"status\":\"captured\",");
                    sb.Append("\"bounds\":{");
                    sb.Append("\"x\":").Append(bounds.X).Append(",");
                    sb.Append("\"y\":").Append(bounds.Y).Append(",");
                    sb.Append("\"width\":").Append(bounds.Width).Append(",");
                    sb.Append("\"height\":").Append(bounds.Height);
                    sb.Append("}");
                    if (!string.IsNullOrEmpty(outputFile))
                    {
                        sb.Append(",\"outputFile\":").Append(JsonEscape(outputFile));
                    }
                    if (base64Data != null)
                    {
                        sb.Append(",\"base64Length\":").Append(base64Data.Length);
                        sb.Append(",\"base64\":").Append(JsonEscape(base64Data));
                    }
                    sb.Append("}");

                    Console.OutputEncoding = Encoding.UTF8;
                    Console.WriteLine(sb.ToString());
                    return 0;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Screen capture failed: " + ex.Message);
                return 20;
            }
            finally
            {
                if (inputDesk != IntPtr.Zero)
                {
                    try { NativeMethods.CloseDesktop(inputDesk); } catch { }
                }
            }
        }

        private static WindowRecord CollectWindowRecord(IntPtr hWnd, bool includeTitle, string forcedGeneration = null)
        {
            uint pid;
            NativeMethods.GetWindowThreadProcessId(hWnd, out pid);
            if (pid == 0) return null;

            bool isVisible = NativeMethods.IsWindowVisible(hWnd);
            bool isMinimized = NativeMethods.IsIconic(hWnd);

            RECT rect;
            NativeMethods.GetWindowRect(hWnd, out rect);
            int width = Math.Max(0, rect.Right - rect.Left);
            int height = Math.Max(0, rect.Bottom - rect.Top);

            uint dpi = 96;
            try
            {
                dpi = NativeMethods.GetDpiForWindow(hWnd);
                if (dpi == 0) dpi = 96;
            }
            catch
            {
                dpi = 96;
            }

            string processName = "unknown";
            string procStartTimeTicks = "0";
            try
            {
                using (var proc = Process.GetProcessById((int)pid))
                {
                    processName = proc.ProcessName ?? "unknown";
                    try
                    {
                        procStartTimeTicks = proc.StartTime.ToUniversalTime().Ticks.ToString();
                    }
                    catch
                    {
                        // Restricted processes (e.g. System, Audiodg) may deny StartTime access
                        procStartTimeTicks = "system";
                    }
                }
            }
            catch
            {
                // Process may have exited between EnumWindows and inspection
            }

            string title = "";
            if (includeTitle)
            {
                int len = NativeMethods.GetWindowTextLength(hWnd);
                if (len > 0)
                {
                    var titleSb = new StringBuilder(len + 1);
                    NativeMethods.GetWindowText(hWnd, titleSb, titleSb.Capacity);
                    title = titleSb.ToString();
                }
            }

            long hwndLong = hWnd.ToInt64();
            string generation = !string.IsNullOrEmpty(forcedGeneration)
                ? forcedGeneration
                : hwndLong + ":" + pid + ":" + procStartTimeTicks;

            return new WindowRecord
            {
                Hwnd = hwndLong,
                ProcessId = (int)pid,
                ProcessName = processName,
                Minimized = isMinimized,
                Visible = isVisible,
                Generation = generation,
                Title = title,
                X = rect.Left,
                Y = rect.Top,
                Width = width,
                Height = height,
                Dpi = (int)dpi
            };
        }

        private static void AppendWindowJson(StringBuilder sb, WindowRecord w)
        {
            sb.Append("{");
            sb.Append("\"hwnd\":").Append(w.Hwnd).Append(",");
            sb.Append("\"processId\":").Append(w.ProcessId).Append(",");
            sb.Append("\"processName\":").Append(JsonEscape(w.ProcessName)).Append(",");
            sb.Append("\"minimized\":").Append(w.Minimized ? "true" : "false").Append(",");
            sb.Append("\"visible\":").Append(w.Visible ? "true" : "false").Append(",");
            sb.Append("\"generation\":").Append(JsonEscape(w.Generation)).Append(",");
            sb.Append("\"title\":").Append(JsonEscape(w.Title)).Append(",");
            sb.Append("\"bounds\":{");
            sb.Append("\"x\":").Append(w.X).Append(",");
            sb.Append("\"y\":").Append(w.Y).Append(",");
            sb.Append("\"width\":").Append(w.Width).Append(",");
            sb.Append("\"height\":").Append(w.Height);
            sb.Append("},");
            sb.Append("\"dpi\":").Append(w.Dpi);
            sb.Append("}");
        }

        private static string JsonEscape(string text)
        {
            if (text == null) return "\"\"";
            var sb = new StringBuilder("\"");
            foreach (char c in text)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '\"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            sb.AppendFormat("\\u{0:x4}", (int)c);
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append("\"");
            return sb.ToString();
        }
    }
}
