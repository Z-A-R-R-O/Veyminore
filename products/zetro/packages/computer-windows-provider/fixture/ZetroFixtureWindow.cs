// ==++==
//
//   ZETRO Disposable Windows Fixture Application
//   Known Window Title, Text & UI Automation Elements for Native Inspection
//
//   SAFETY: This fixture window is designed for controlled, coordinator-qualified
//   testing ONLY. It auto-closes after a timeout (default 30s) to prevent leaked processes.
//
// ==--==

using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace Zetro.Computer.Fixture
{
    public class FixtureForm : Form
    {
        public const string KNOWN_WINDOW_TITLE = "ZETRO_NATIVE_FIXTURE_WINDOW";
        public const string KNOWN_LABEL_TEXT = "ZETRO Controlled Fixture Body";
        public const string KNOWN_BUTTON_TEXT = "ZETRO Fixture Button";
        public const string KNOWN_TEXTBOX_TEXT = "ZETRO Fixture Field Value";

        private readonly Label _label;
        private readonly Button _button;
        private readonly TextBox _textBox;
        private readonly System.Windows.Forms.Timer _autoCloseTimer;

        public FixtureForm(int autoCloseSeconds = 30)
        {
            this.Text = KNOWN_WINDOW_TITLE;
            this.Name = "ZetroFixtureForm";
            this.Size = new Size(600, 400);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;

            _label = new Label
            {
                Name = "ZetroFixtureLabel",
                Text = KNOWN_LABEL_TEXT,
                Location = new Point(30, 30),
                Size = new Size(500, 30),
                Font = new Font("Arial", 12, FontStyle.Regular)
            };

            _textBox = new TextBox
            {
                Name = "ZetroFixtureTextBox",
                Text = KNOWN_TEXTBOX_TEXT,
                Location = new Point(30, 80),
                Size = new Size(300, 30),
                ReadOnly = true
            };

            _button = new Button
            {
                Name = "ZetroFixtureButton",
                Text = KNOWN_BUTTON_TEXT,
                Location = new Point(30, 130),
                Size = new Size(160, 40),
                Enabled = true
            };

            this.Controls.Add(_label);
            this.Controls.Add(_textBox);
            this.Controls.Add(_button);

            // Auto-close safety timer so fixture never stays running indefinitely
            if (autoCloseSeconds > 0)
            {
                _autoCloseTimer = new System.Windows.Forms.Timer
                {
                    Interval = autoCloseSeconds * 1000
                };
                _autoCloseTimer.Tick += (s, e) =>
                {
                    _autoCloseTimer.Stop();
                    this.Close();
                };
                _autoCloseTimer.Start();
            }
        }

        [STAThread]
        public static int Main(string[] args)
        {
            try
            {
                int timeoutSec = 30;
                for (int i = 0; i < args.Length; i++)
                {
                    if (args[i] == "--timeout" && i + 1 < args.Length)
                    {
                        int.TryParse(args[++i], out timeoutSec);
                    }
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new FixtureForm(timeoutSec));
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Fixture failed to start: " + ex.Message);
                return 1;
            }
        }
    }
}
