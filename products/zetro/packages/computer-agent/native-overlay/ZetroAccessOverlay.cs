using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using System.Collections.Generic;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Presentation only. No hooks, input injection, capture or window enumeration.
class ZetroAccessOverlay : Form {
    [StructLayout(LayoutKind.Sequential)] struct CursorPoint {public int X,Y;}
    [DllImport("user32.dll")] static extern bool GetCursorPos(out CursorPoint point);
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterHotKey(IntPtr window,int id,uint modifiers,uint key);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr window,int id);
    bool hotkeyRegistered;
    const int StopHotkey=23124;
    protected override void WndProc(ref Message message) {
        if(message.Msg==0x312&&message.WParam.ToInt32()==StopHotkey) {
            Console.WriteLine("{\"event\":\"stop_requested\",\"reason\":\"escape\"}");
            ClearVisual();Close();return;
        }
        base.WndProc(ref message);
    }
    readonly string session;
    readonly JavaScriptSerializer json=new JavaScriptSerializer {MaxJsonLength=8192,RecursionLimit=8};
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    readonly System.Drawing.Text.PrivateFontCollection fonts=new System.Drawing.Text.PrivateFontCollection();
    readonly LayeredSurface surface=new LayeredSurface();
    readonly Stopwatch elapsed=Stopwatch.StartNew();
    DateTime received=DateTime.MinValue;
    long sequence=-1,expiry=0;
    double previousTick;
    float phase;
    string state="off",activityPhase="observing",activityText="Locating target\u2026";
    PointF pointer,label;
    bool pointerVisible,reducedMotion,painted,disposed;
    Process cursorLease;
    Font labelFont;
    Bitmap frame;

    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var value=base.CreateParams;value.ExStyle|=0x20|0x80000|0x08000000|0x80;return value;}}
    protected override void OnPaintBackground(PaintEventArgs e){}
    protected override void OnPaint(PaintEventArgs e){}

    ZetroAccessOverlay(string id) {
        session=id;FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;
        AutoScaleMode=AutoScaleMode.None;Bounds=new Rectangle(-20000,-20000,1,1);
        LoadLabelFont();
        timer.Interval=33;timer.Tick+=(sender,args)=>{try{TickFrame();}catch{Close();}};timer.Start();
        Shown+=(sender,args)=>new Thread(ReadEvents){IsBackground=true}.Start();
    }

    void LoadLabelFont() {
        try {
            string path=System.IO.Path.GetFullPath(System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"../../../apps/control-center/public/fonts/Satoshi-Variable.ttf"));
            fonts.AddFontFile(path);labelFont=new Font(fonts.Families[0],9.5f,FontStyle.Bold,GraphicsUnit.Pixel);
        } catch {labelFont=new Font("Segoe UI",9.5f,FontStyle.Bold,GraphicsUnit.Pixel);}
    }

    void ReadEvents() {
        try {
            string line;
            while((line=Console.ReadLine())!=null) {
                if(line.Length>8192)break;
                var value=json.Deserialize<Dictionary<string,object>>(line);
                BeginInvoke((Action)(()=>Apply(value)));
            }
        } catch { }
        try {BeginInvoke((Action)(()=>Close()));} catch { }
    }

    void Apply(Dictionary<string,object> value) {
        try {
            if(Convert.ToString(value["sessionId"])!=session)return;
            long nextSequence=Convert.ToInt64(value["sequence"]);
            if(nextSequence<sequence)return;
            sequence=nextSequence;
            string next=Convert.ToString(value["state"]);
            if(next!="observing"&&next!="acting"&&next!="thinking"&&next!="intention"){ClearVisual();return;}
            long until=Convert.ToInt64(value["expiresAt"]);
            if(until<=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()||(expiry>0&&until>expiry)){ClearVisual();return;}
            var display=value["controlledDisplay"] as Dictionary<string,object>;
            if(display==null){ClearVisual();return;}
            int x=Convert.ToInt32(display["x"]),y=Convert.ToInt32(display["y"]);
            int width=Convert.ToInt32(display["width"]),height=Convert.ToInt32(display["height"]);
            if(width<100||height<100||width>16384||height>16384||(long)width*height>40000000){ClearVisual();return;}
            if(!hotkeyRegistered) {
                hotkeyRegistered=RegisterHotKey(Handle,StopHotkey,0x4000,0x1B);
                if(!hotkeyRegistered) {
                    Console.WriteLine("{\"event\":\"stop_requested\",\"reason\":\"escape_unavailable\"}");Close();return;
                }
                Console.WriteLine("{\"event\":\"kill_switch_ready\"}");
            }
            Bounds=new Rectangle(x,y,width,height);state=next;expiry=until;received=DateTime.UtcNow;
            reducedMotion=value.ContainsKey("reducedMotion")&&Convert.ToBoolean(value["reducedMotion"]);
            var activity=value.ContainsKey("activity")?value["activity"] as Dictionary<string,object>:null;
            activityPhase=activity!=null&&activity.ContainsKey("phase")?Convert.ToString(activity["phase"]):next;
            activityText=activity!=null&&activity.ContainsKey("text")?Convert.ToString(activity["text"]):"Locating target\u2026";
            if(activityPhase.Length>32||activityText.Length>120||activityText.IndexOfAny(new[]{'\r','\n','\0'})>=0)throw new Exception("Invalid activity label");
            UpdatePointer();
            PresentFrame();
            UpdateCursorLease();
            Console.WriteLine(json.Serialize(new Dictionary<string,object>{{"event","presented"},{"sequence",sequence},{"pointerVisible",pointerVisible},{"activityPhase",activityPhase}}));
        } catch(Exception error) {
            Console.Error.WriteLine("Overlay presentation failed: "+error.GetType().Name);
            ClearVisual();
        }
    }

    void TickFrame() {
        double time=elapsed.Elapsed.TotalSeconds;
        float delta=(float)Math.Min(.08,Math.Max(0,time-previousTick));previousTick=time;
        if((DateTime.UtcNow-received).TotalSeconds>3||DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()>=expiry){ClearVisual();return;}
        UpdatePointer();
        if(!reducedMotion)phase+=delta*1.256637f;
        float follow=reducedMotion?1f:1-(float)Math.Exp(-delta/.125);
        label.X+=(pointer.X+20-label.X)*follow;label.Y+=(pointer.Y+19-label.Y)*follow;
        PresentFrame();
        UpdateCursorLease();
    }

    void UpdatePointer() {
        bool wasVisible=pointerVisible;
        CursorPoint actual;
        pointerVisible=GetCursorPos(out actual);
        if(pointerVisible) {
            pointer=new PointF(actual.X-Bounds.X,actual.Y-Bounds.Y);
            pointerVisible=pointer.X>=0&&pointer.Y>=0&&pointer.X<Width&&pointer.Y<Height;
            if(pointerVisible&&!wasVisible)label=new PointF(pointer.X+20,pointer.Y+19);
        }
    }

    void PresentFrame() {
        if(state=="off")return;
        if(frame==null||frame.Width!=Width||frame.Height!=Height) {
            if(frame!=null)frame.Dispose();
            frame=new Bitmap(Width,Height,PixelFormat.Format32bppPArgb);
        }
        using(var graphics=Graphics.FromImage(frame)) {
            graphics.Clear(Color.Transparent);
            OverlayRenderer.Draw(graphics,Size,phase,pointerVisible,pointer,label,labelFont,activityPhase,activityText,reducedMotion);
        }
        surface.Present(Handle,frame,Bounds);painted=true;
    }

    void UpdateCursorLease() {
        if(cursorLease==null) {
            cursorLease=Process.Start(new ProcessStartInfo(Application.ExecutablePath,
                "--cursor-lease "+Process.GetCurrentProcess().Id+" "+expiry) {
                UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true
            });
        }
        if(cursorLease.HasExited)throw new InvalidOperationException("Cursor lease stopped");
        cursorLease.StandardInput.WriteLine(pointerVisible?"hide":"show");
        cursorLease.StandardInput.Flush();
    }

    void RestoreCursor() {
        if(cursorLease==null)return;
        try{cursorLease.StandardInput.Close();cursorLease.WaitForExit(1000);}catch{}
        cursorLease.Dispose();cursorLease=null;
    }

    void ClearVisual() {
        RestoreCursor();
        if(hotkeyRegistered){UnregisterHotKey(Handle,StopHotkey);hotkeyRegistered=false;}
        state="off";pointerVisible=false;
        if(!painted||frame==null)return;
        using(var graphics=Graphics.FromImage(frame))graphics.Clear(Color.Transparent);
        try{surface.Present(Handle,frame,Bounds);Console.WriteLine("{\"event\":\"cleared\",\"sequence\":"+sequence+"}");}catch{Close();}painted=false;
    }

    protected override void Dispose(bool disposing) {
        if(disposing&&!disposed) {
            disposed=true;RestoreCursor();if(hotkeyRegistered){UnregisterHotKey(Handle,StopHotkey);hotkeyRegistered=false;}timer.Dispose();labelFont.Dispose();fonts.Dispose();surface.Dispose();
            if(frame!=null)frame.Dispose();
        }
        base.Dispose(disposing);
    }

    static Bitmap Render(Font font,float phase,Color background) {
        var bitmap=new Bitmap(480,280,PixelFormat.Format32bppPArgb);
        using(var graphics=Graphics.FromImage(bitmap)) {
            graphics.Clear(background);
            OverlayRenderer.Draw(graphics,bitmap.Size,phase,true,new PointF(60,60),new PointF(80,79),font);
        }
        return bitmap;
    }

    [STAThread]static void Main(string[] args) {
        if(args.Length==1&&args[0]=="--cursor-fingerprint"){Console.WriteLine(CursorLease.Fingerprint());return;}
        if(args.Length==3&&args[0]=="--cursor-lease") {
            int parent;long until;
            if(int.TryParse(args[1],out parent)&&long.TryParse(args[2],out until))CursorLease.Run(parent,until);
            return;
        }
        Application.EnableVisualStyles();
        if(args.Length==2&&args[0]=="--render-cursor-detail") {
            using(var bitmap=new Bitmap(800,900,PixelFormat.Format32bppPArgb)) {
                using(var graphics=Graphics.FromImage(bitmap)) {
                    graphics.Clear(Color.Black);graphics.SmoothingMode=SmoothingMode.AntiAlias;
                    OverlayRenderer.DrawCursor(graphics,new PointF(100,100),1f);
                }
                bitmap.Save(args[1],ImageFormat.Png);
            }
            return;
        }
        if(args.Length>=2&&args[0]=="--render-preview") {
            using(var form=new ZetroAccessOverlay("render-only")) {
                form.timer.Stop();
                Color background=Array.IndexOf(args,"--transparent")>=0?Color.Transparent:Array.IndexOf(args,"--dark")>=0?Color.FromArgb(20,21,23):Color.FromArgb(249,249,249);
                float phase=Array.IndexOf(args,"--peak")>=0?1.57f:0f;
                using(var bitmap=Render(form.labelFont,phase,background))bitmap.Save(args[1],ImageFormat.Png);
            }
            return;
        }
        if(args.Length==1&&args[0]=="--self-test") {
            using(var form=new ZetroAccessOverlay("render-only")) {
                form.timer.Stop();
                using(var bitmap=Render(form.labelFont,0,Color.Transparent)) {
                    if(bitmap.GetPixel(130,80).A!=0)throw new Exception("Interior must remain transparent");
                    if(bitmap.GetPixel(0,30).A==0||bitmap.GetPixel(0,30).A>=240)throw new Exception("Aura must remain translucent");
                    int captionPixels=0;
                    for(int y=218;y<245;y++)for(int x=150;x<330;x++)if(bitmap.GetPixel(x,y).A>=150)captionPixels++;
                    if(captionPixels<20)throw new Exception("Orb activity must remain legible");
                    if(bitmap.GetPixel(105,88).A!=0)throw new Exception("Cursor label must be absent");
                    using(var peak=Render(form.labelFont,1.57f,Color.Transparent)) {
                        if(bitmap.GetPixel(0,30)==peak.GetPixel(0,30))throw new Exception("Aura animation frames must differ");
                    }
                }
            }
            Console.WriteLine("{\"passed\":5,\"checks\":[\"transparent_interior\",\"translucent_aura\",\"legible_orb_activity\",\"no_cursor_label\",\"different_animation_frames\"]}");return;
        }
        if(args.Length!=2||args[0]!="--session"||!System.Text.RegularExpressions.Regex.IsMatch(args[1],@"^[\w-]{1,128}$"))return;
        Application.Run(new ZetroAccessOverlay(args[1]));
    }
}

