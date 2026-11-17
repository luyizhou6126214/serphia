$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public static class SerphiaDesktopFixture
{
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);

    private sealed class Fixture : Form
    {
        public int Clicks;
        public readonly TextBox Input = new TextBox { AccessibleName = "Fixture input", Left = 25, Top = 85, Width = 250 };

        public Fixture(string title, Color color)
        {
            Text = title;
            AccessibleName = title;
            FormBorderStyle = FormBorderStyle.None;
            ClientSize = new Size(520, 370);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = color;
            var button = new Button {
                Text = "Run fixture action", AccessibleName = "Run fixture action",
                Left = 25, Top = 25, Width = 160, Height = 37, BackColor = Color.White
            };
            button.Click += delegate { Clicks++; };
            Controls.Add(button);
            Controls.Add(Input);
        }
    }

    private static void Focus(Fixture form)
    {
        form.Show();
        uint ignored;
        uint activeThread = GetWindowThreadProcessId(GetForegroundWindow(), out ignored);
        uint caller = GetCurrentThreadId();
        // Activate only the fixture window, even if the test runner is in the background.
        bool attached = activeThread != 0 && activeThread != caller && AttachThreadInput(caller, activeThread, true);
        try
        {
            SetForegroundWindow(form.Handle);
            form.Activate();
        }
        finally { if (attached) AttachThreadInput(caller, activeThread, false); }
        Console.WriteLine(GetForegroundWindow() == form.Handle ? "focused" : "focus-failed");
    }

    public static void Run()
    {
        Console.InputEncoding = new System.Text.UTF8Encoding(false);
        Console.OutputEncoding = new System.Text.UTF8Encoding(false);
        Application.EnableVisualStyles();
        using (var target = new Fixture("Serphia Desktop Fixture", Color.FromArgb(32, 116, 201)))
        using (var other = new Fixture("Serphia Focus Switch Fixture", Color.FromArgb(201, 35, 116)))
        {
            target.Shown += delegate {
                new Thread(() => {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        string command = line;
                        target.Invoke((Action)(() => {
                            if (command == "target") Focus(target);
                            if (command == "other") Focus(other);
                            if (command == "state") {
                                Console.WriteLine("{\"target\":" + State(target) + ",\"other\":" + State(other) + "}");
                            }
                        }));
                    }
                    target.BeginInvoke((Action)Application.Exit);
                }) { IsBackground = true }.Start();
                Console.WriteLine("started");
            };
            Application.Run(target);
        }
    }

    private static string State(Fixture form)
    {
        string text = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(form.Input.Text));
        return "{\"clicks\":" + form.Clicks + ",\"base64\":\"" + text + "\"}";
    }
}
'@
[SerphiaDesktopFixture]::Run()
