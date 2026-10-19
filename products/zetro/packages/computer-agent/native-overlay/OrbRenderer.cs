using System;
using System.Drawing;
using System.Drawing.Drawing2D;

static class OrbRenderer {
    public static void Draw(Graphics g,Size size,float phase,Font font,string activityPhase,string activityText,bool reducedMotion) {
        if(size.Width<160||size.Height<150)return;
        float time=reducedMotion?0:phase;
        bool thinking=activityPhase=="thinking"||activityPhase=="checking";
        float breath=1+.015f*(float)Math.Sin(time);
        float drift=3.5f*(float)Math.Sin(time*.42f);
        float centerX=size.Width/2f,centerY=size.Height-105;
        var saved=g.Save();
        g.TranslateTransform(centerX,centerY);
        g.ScaleTransform(breath,breath);
        DrawAtmosphere(g,time);
        DrawBody(g);
        g.RotateTransform(drift);
        for(int index=0;index<3;index++)DrawSurface(g,index,time,thinking);
        DrawCore(g,time,thinking);
        g.Restore(saved);
        DrawCaption(g,size,font,activityText);
    }

    static void DrawAtmosphere(Graphics g,float phase) {
        using(var path=new GraphicsPath()) {
            path.AddEllipse(-48,-48,96,96);
            using(var brush=new PathGradientBrush(path)) {
                brush.CenterColor=Color.FromArgb(48,235,240,245);
                brush.SurroundColors=new[]{Color.Transparent};
                g.FillPath(brush,path);
            }
        }
        using(var shade=new SolidBrush(Color.FromArgb(12,0,0,0)))g.FillEllipse(shade,-32,31,64,6);
    }

    static void DrawBody(Graphics g) {
        using(var path=new GraphicsPath()) {
            path.AddEllipse(-32,-32,64,64);
            using(var body=new PathGradientBrush(path)) {
                body.CenterPoint=new PointF(-10,-14);
                body.CenterColor=Color.FromArgb(220,80,87,95);
                body.SurroundColors=new[]{Color.FromArgb(230,13,15,18)};
                g.FillPath(body,path);
            }
        }
        using(var rim=new Pen(Color.FromArgb(90,224,230,235),.7f))g.DrawEllipse(rim,-32,-32,64,64);
        using(var rim=new Pen(Color.FromArgb(135,255,255,255),.8f))g.DrawArc(rim,-31.5f,-31.5f,63,63,202,65);
    }

    static void DrawSurface(Graphics g,int index,float phase,bool thinking) {
        var saved=g.Save();
        float shift=(float)Math.Sin(phase*(thinking?1.35f:.52f)+index*2.1f);
        g.RotateTransform(index*120+shift*(thinking?5:1.8f));
        using(var path=new GraphicsPath()) {
            path.AddBezier(-4,-25,18,-31,32,-10,19,13);
            path.AddBezier(19,13,12,24,-4,21,-10,9);
            path.AddBezier(-10,9,8,14,15,-6,-4,-25);
            path.CloseFigure();
            using(var glass=new LinearGradientBrush(new PointF(-12,-25),new PointF(24,22),Color.FromArgb(165,244,248,252),Color.FromArgb(22,128,142,155)))g.FillPath(glass,path);
            using(var rim=new Pen(Color.FromArgb(100,245,248,252),.65f))g.DrawPath(rim,path);
        }
        using(var seam=new GraphicsPath()) {
            seam.AddBezier(-3,-24,11,-19,22,-5,14,12);
            int light=(int)(95+(shift+1)*45);
            using(var highlight=new Pen(Color.FromArgb(light,255,255,255),.85f))g.DrawPath(highlight,seam);
        }
        g.Restore(saved);
    }

    static void DrawCore(Graphics g,float phase,bool thinking) {
        float x=thinking?2*(float)Math.Sin(phase*.72f):0;
        float y=thinking?1.5f*(float)Math.Cos(phase*.53f):0;
        using(var path=new GraphicsPath()) {
            path.AddEllipse(x-10,y-10,20,20);
            using(var light=new PathGradientBrush(path)) {
                light.CenterColor=Color.FromArgb(190,255,255,255);
                light.SurroundColors=new[]{Color.Transparent};
                g.FillPath(light,path);
            }
        }
        using(var core=new SolidBrush(Color.FromArgb(250,255,255,255)))g.FillEllipse(core,x-1.25f,y-1.25f,2.5f,2.5f);
    }

    static void DrawCaption(Graphics g,Size size,Font font,string text) {
        string caption=String.IsNullOrWhiteSpace(text)?"Observing\u2026":text;
        using(var format=new StringFormat())
        using(var stateFont=new Font(font.FontFamily,14,FontStyle.Regular,GraphicsUnit.Pixel)) {
            format.Alignment=StringAlignment.Center;
            format.LineAlignment=StringAlignment.Center;
            format.Trimming=StringTrimming.EllipsisCharacter;
            format.FormatFlags=StringFormatFlags.NoWrap;
            var area=new RectangleF(16,size.Height-67,size.Width-32,28);
            // A fine light edge keeps unboxed text readable on dark and light windows.
            using(var path=new GraphicsPath()) {
                path.AddString(caption,stateFont.FontFamily,(int)FontStyle.Regular,14,area,format);
                using(var edge=new Pen(Color.FromArgb(210,255,255,255),2.5f))g.DrawPath(edge,path);
                using(var ink=new SolidBrush(Color.FromArgb(255,35,39,39)))g.FillPath(ink,path);
            }
            using(var path=new GraphicsPath()) {
                path.AddString("ESC  \u00b7  Stop",font.FontFamily,(int)FontStyle.Regular,9.5f,
                    new RectangleF(16,size.Height-33,size.Width-32,18),format);
                using(var edge=new Pen(Color.FromArgb(200,255,255,255),2))g.DrawPath(edge,path);
                using(var ink=new SolidBrush(Color.FromArgb(235,78,84,79)))g.FillPath(ink,path);
            }
        }
    }
}
