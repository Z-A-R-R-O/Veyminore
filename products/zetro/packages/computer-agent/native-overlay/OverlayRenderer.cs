using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;

static class OverlayRenderer {
    public static void Draw(Graphics graphics,Size size,float phase,bool pointerVisible,PointF pointer,PointF label,Font font,string activityPhase="observing",string activityText="Observing…",bool reducedMotion=false) {
        graphics.SmoothingMode=SmoothingMode.AntiAlias;
        graphics.TextRenderingHint=TextRenderingHint.AntiAliasGridFit;
        DrawAura(graphics,size,reducedMotion?0:phase);
        OrbRenderer.Draw(graphics,size,phase,font,activityPhase,activityText,reducedMotion);
        if(!pointerVisible)return;
        DrawCursor(graphics,pointer);
    }

    static void DrawAura(Graphics g,Size size,float phase) {
        float breath=.72f+.18f*(float)Math.Sin(phase);
        for(int radius=38;radius>=1;radius--) {
            float weight=1-radius/40f;
            using(var shade=new Pen(Color.FromArgb((int)(4*weight*breath),12,13,14),radius*2)) {
                g.DrawRectangle(shade,0,0,size.Width-1,size.Height-1);
            }
            using(var pearl=new Pen(Color.FromArgb((int)(3*weight*breath),255,255,255),radius*1.25f)) {
                g.DrawRectangle(pearl,0,0,size.Width-1,size.Height-1);
            }
        }
        float drift=.5f+.22f*(float)Math.Sin(phase*.47f);
        DrawBloom(g,new PointF(0,0),new PointF(size.Width,0),drift,breath);
        DrawBloom(g,new PointF(size.Width,size.Height-1),new PointF(0,size.Height-1),1-drift,breath*.8f);
        DrawBloom(g,new PointF(0,size.Height-1),new PointF(0,0),drift,breath*.55f);
        DrawBloom(g,new PointF(size.Width-1,0),new PointF(size.Width-1,size.Height),1-drift,breath*.65f);
    }

    static void DrawBloom(Graphics g,PointF start,PointF end,float center,float strength) {
        bool horizontal=Math.Abs(end.X-start.X)>Math.Abs(end.Y-start.Y);
        float length=horizontal?Math.Abs(end.X-start.X):Math.Abs(end.Y-start.Y);
        float span=Math.Max(120,length*.65f);
        var point=new PointF(start.X+(end.X-start.X)*center,start.Y+(end.Y-start.Y)*center);
        var area=horizontal?new RectangleF(point.X-span/2,point.Y-42,span,84):new RectangleF(point.X-42,point.Y-span/2,84,span);
        using(var path=new GraphicsPath()) {
            path.AddEllipse(area);
            using(var glow=new PathGradientBrush(path)) {
                glow.CenterColor=Color.FromArgb((int)(65*strength),255,255,255);
                glow.SurroundColors=new[]{Color.Transparent};
                g.FillPath(glow,path);
            }
        }
    }

    public static void DrawCursor(Graphics g,PointF pointer,float scale=.043f) {
        var saved=g.Save();g.TranslateTransform(pointer.X,pointer.Y);g.ScaleTransform(scale,scale);
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(249,252,255),Color.FromArgb(216,226,235)))
            g.FillPolygon(brush,new PointF[]{new PointF(0,0),new PointF(594,489),new PointF(378,433),new PointF(495,691),new PointF(258,503),new PointF(181,609),new PointF(77,174),new PointF(59,154)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(3,4,5),Color.FromArgb(28,32,37)))
            g.FillPolygon(brush,new PointF[]{new PointF(21,25),new PointF(525,450),new PointF(312,404),new PointF(183,591),new PointF(78,176)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(8,11,14),Color.FromArgb(82,90,99)))
            g.FillPolygon(brush,new PointF[]{new PointF(24,27),new PointF(266,291),new PointF(370,328)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(4,5,6),Color.FromArgb(16,20,24)))
            g.FillPolygon(brush,new PointF[]{new PointF(25,35),new PointF(123,201),new PointF(173,400),new PointF(156,462),new PointF(85,180)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(255,255,255),Color.FromArgb(230,237,242)))
            g.FillPolygon(brush,new PointF[]{new PointF(123,201),new PointF(146,233),new PointF(182,379),new PointF(180,410),new PointF(156,462),new PointF(173,399)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(1,2,3),Color.FromArgb(16,20,24)))
            g.FillPolygon(brush,new PointF[]{new PointF(37,52),new PointF(243,352),new PointF(278,316),new PointF(300,337),new PointF(183,576)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(66,74,82),Color.FromArgb(5,7,9)))
            g.FillPolygon(brush,new PointF[]{new PointF(183,576),new PointF(300,337),new PointF(278,316),new PointF(242,352)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(22,27,32),Color.FromArgb(6,8,10)))
            g.FillPolygon(brush,new PointF[]{new PointF(278,316),new PointF(300,337),new PointF(475,382),new PointF(370,328)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(4,6,8),Color.FromArgb(39,45,52)))
            g.FillPolygon(brush,new PointF[]{new PointF(300,337),new PointF(475,382),new PointF(525,450),new PointF(312,404)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(6,8,10),Color.FromArgb(52,59,67)))
            g.FillPolygon(brush,new PointF[]{new PointF(260,496),new PointF(315,414),new PointF(476,661)});
        using(var brush=new LinearGradientBrush(new Point(0,0),new Point(510,650),Color.FromArgb(2,3,4),Color.FromArgb(20,25,30)))
            g.FillPolygon(brush,new PointF[]{new PointF(315,414),new PointF(370,430),new PointF(374,454),new PointF(476,661)});
        using(var seam=new Pen(Color.FromArgb(205,199,208,219),1.2f))
            g.DrawLines(seam,new PointF[]{new PointF(24,27),new PointF(266,291),new PointF(370,328)});
        using(var seam=new Pen(Color.FromArgb(205,186,199,210),1.2f))
            g.DrawLines(seam,new PointF[]{new PointF(183,576),new PointF(300,337),new PointF(475,382)});
        using(var seam=new Pen(Color.FromArgb(205,248,251,255),5f))
            g.DrawLines(seam,new PointF[]{new PointF(260,496),new PointF(476,661)});
        using(var seam=new Pen(Color.FromArgb(205,255,255,255),2f))
            g.DrawLines(seam,new PointF[]{new PointF(378,433),new PointF(495,691)});
        using(var slit=new LinearGradientBrush(new Point(123,201),new Point(180,410),Color.White,Color.FromArgb(226,234,243)))
            g.FillPolygon(slit,new PointF[]{new PointF(123,201),new PointF(146,233),new PointF(182,379),new PointF(180,410),new PointF(156,462),new PointF(173,399)});
        g.Restore(saved);
    }

}

