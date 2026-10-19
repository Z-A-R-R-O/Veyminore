using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

// A separate process restores the cursor if the overlay exits or stops responding.
static class CursorLease {
    [DllImport("user32.dll")] static extern IntPtr CreateCursor(IntPtr instance,int x,int y,int width,int height,byte[] andMask,byte[] xorMask);
    [DllImport("user32.dll")] static extern bool SetSystemCursor(IntPtr cursor,uint id);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint action,uint parameter,IntPtr value,uint flags);
    [DllImport("user32.dll")] static extern bool DestroyCursor(IntPtr cursor);
    [StructLayout(LayoutKind.Sequential)] struct IconInfo {public bool icon;public uint x,y;public IntPtr mask,color;}
    [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr name);
    [DllImport("user32.dll")] static extern bool GetIconInfo(IntPtr cursor,out IconInfo info);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr value);
    public static string Fingerprint() {
        IconInfo info;
        if(!GetIconInfo(LoadCursor(IntPtr.Zero,new IntPtr(32512)),out info))throw new Exception("Cursor readback failed");
        try {
            using(var bitmap=System.Drawing.Image.FromHbitmap(info.mask))
            using(var stream=new System.IO.MemoryStream())
            using(var hash=System.Security.Cryptography.SHA256.Create()) {
                bitmap.Save(stream,System.Drawing.Imaging.ImageFormat.Bmp);
                return Convert.ToBase64String(hash.ComputeHash(stream.ToArray()));
            }
        }finally {DeleteObject(info.mask);if(info.color!=IntPtr.Zero)DeleteObject(info.color);}
    }
    static readonly uint[] Shapes={32512,32513,32514,32515,32516,32642,32643,32644,32645,32646,32648,32649,32650,32651};
    static volatile bool finished,hide;
    static long received;

    public static void Run(int parentId,long expiry) {
        using(var mutex=new Mutex(false,"Local\\ZetroNativeCursorLease")) {
            bool owns=false;
            try {owns=mutex.WaitOne(0);}catch(AbandonedMutexException){owns=true;}
            if(!owns)return;
            bool hidden=false;
            try {
                using(var parent=Process.GetProcessById(parentId)) {
                    Interlocked.Exchange(ref received,DateTime.UtcNow.Ticks);
                    new Thread(()=>{
                        try {string line;while((line=Console.ReadLine())!=null){
                            if(line!="hide"&&line!="show")break;
                            hide=line=="hide";Interlocked.Exchange(ref received,DateTime.UtcNow.Ticks);
                        }}finally{finished=true;}
                    }){IsBackground=true}.Start();
                    while(!finished&&!parent.HasExited&&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()<expiry&&
                          new TimeSpan(DateTime.UtcNow.Ticks-Interlocked.Read(ref received)).TotalSeconds<3) {
                        if(hide&&!hidden){hidden=true;Hide();}
                        if(!hide&&hidden){Restore();hidden=false;}
                        Thread.Sleep(50);
                    }
                }
            } finally {if(hidden)Restore();mutex.ReleaseMutex();}
        }
    }

    static void Hide() {
        byte[] andMask=new byte[128],xorMask=new byte[128];
        for(int index=0;index<andMask.Length;index++)andMask[index]=255;
        foreach(uint shape in Shapes) {
            IntPtr cursor=CreateCursor(IntPtr.Zero,0,0,32,32,andMask,xorMask);
            if(cursor==IntPtr.Zero)throw new InvalidOperationException("Transparent cursor unavailable");
            if(!SetSystemCursor(cursor,shape)){DestroyCursor(cursor);throw new InvalidOperationException("Cursor replacement failed");}
        }
    }

    static void Restore() {
        for(int attempt=0;attempt<3;attempt++) {
            if(SystemParametersInfo(0x57,0,IntPtr.Zero,0))return;
            Thread.Sleep(50);
        }
    }
}
