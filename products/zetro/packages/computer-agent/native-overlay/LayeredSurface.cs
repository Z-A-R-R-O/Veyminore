using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.ComponentModel;

// Uploads our own pixels. It never reads screen pixels or sends input.
sealed class LayeredSurface : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Point { public int X,Y; }
    [StructLayout(LayoutKind.Sequential)] struct Size { public int Width,Height; }
    [StructLayout(LayoutKind.Sequential,Pack=1)] struct Blend { public byte Operation,Flags,Opacity,Format; }
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
    [DllImport("user32.dll",SetLastError=true)] static extern bool UpdateLayeredWindow(IntPtr window,IntPtr palette,ref Point position,ref Size size,IntPtr source,ref Point origin,uint key,ref Blend blend,uint flags);
    readonly IntPtr dc=CreateCompatibleDC(IntPtr.Zero);

    public void Present(IntPtr window,Bitmap bitmap,Rectangle bounds) {
        IntPtr image=bitmap.GetHbitmap(Color.FromArgb(0));
        IntPtr previous=SelectObject(dc,image);
        try {
            var position=new Point {X=bounds.X,Y=bounds.Y};
            var size=new Size {Width=bitmap.Width,Height=bitmap.Height};
            var origin=new Point();
            var blend=new Blend {Operation=0,Flags=0,Opacity=255,Format=1};
            if(!UpdateLayeredWindow(window,IntPtr.Zero,ref position,ref size,dc,ref origin,0,ref blend,2)) {
                throw new Win32Exception(Marshal.GetLastWin32Error(),"Overlay alpha composition failed");
            }
        } finally {SelectObject(dc,previous);DeleteObject(image);}
    }
    public void Dispose(){DeleteDC(dc);}
}
