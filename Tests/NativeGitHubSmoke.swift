import AppKit
import WebKit

// 非持久化 WebView，截获所有桥接动作；不会接触用户工程、钥匙串或 GitHub。
final class GitHubSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var web: WKWebView!, window: NSWindow!
    var messages = [[String: Any]]()
    var output: URL { URL(fileURLWithPath: CommandLine.arguments[2]) }
    func applicationDidFinishLaunching(_ note: Notification) {
        let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent(); config.userContentController.add(self, name: "workshop")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config); web.navigationDelegate = self
        window = NSWindow(contentRect: web.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false); window.title = "独立 GitHub 编译测试"; window.contentView = web; window.orderFront(nil)
        let root = URL(fileURLWithPath: CommandLine.arguments[1]); web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        DispatchQueue.main.asyncAfter(deadline: .now() + 50) { print("FAIL: timeout"); exit(1) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) { if let body = message.body as? [String: Any] { messages.append(body) } }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let root = URL(fileURLWithPath: CommandLine.arguments[1]).deletingLastPathComponent()
        let script = try! String(contentsOf: root.appendingPathComponent("Tests/native-github-smoke.js"), encoding: .utf8)
        web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            do {
                let result = try result.get()
                let uploads = self.messages.filter { $0["action"] as? String == "githubPublish" }
                guard uploads.count == 2, uploads[0]["create"] as? Bool == true, uploads[0]["private"] as? Bool == true, uploads[1]["create"] as? Bool == false, uploads[1]["repo"] as? String == "existing-qmk" else { throw FirmwareExport.problem("upload bridge flags") }
                let files = uploads[0]["files"] as! [[String: String]]
                let keyboard = try JSONSerialization.jsonObject(with: Data(files.first(where: { $0["path"]?.hasSuffix("keyboard.json") == true })!["content"]!.utf8)) as! [String: Any]
                let usb = keyboard["usb"] as! [String: String]
                guard usb["vid"] == "0xBEEF", usb["pid"] == "0x0023" else { throw FirmwareExport.problem("upload lost custom USB IDs") }
                guard files == uploads[1]["files"] as? [[String: String]], files.contains(where: { $0["path"] == ".github/workflows/build.yml" }), files.first(where: { $0["path"]?.hasSuffix("keymap.json") == true })?["content"]?.contains("KC_A") == true else { throw FirmwareExport.problem("upload snapshot lost original binding/workflow") }
                for action in ["githubState", "githubConnect", "githubRefresh", "githubOpenRun", "githubDownload"] { guard self.messages.contains(where: { $0["action"] as? String == action }) else { throw FirmwareExport.problem("missing " + action) } }
                print("PASS: \(result); native upload payloads verified; all actions intercepted, no real writes")
                self.capture("github-success") {
                    self.window.setContentSize(NSSize(width: 1100, height: 720))
                    self.run("return document.documentElement.scrollWidth<=innerWidth && $('githubDialog').scrollWidth<=$('githubDialog').clientWidth") { value in
                        guard value as? Bool == true else { print("FAIL: dialog overflow"); exit(1) }
                        self.capture("github-minimum") {
                            self.run("await window.nativeEvent({event:'githubState',payload:{connected:false,busy:false,repositories:[],message:'连接 GitHub 后可上传固件并自动编译。'}});return true") { _ in
                                self.capture("github-disconnected") {
                                    self.run("$('closeGitHub').click();$('uploadGitHub').scrollIntoView({block:'end'});return document.querySelector('.inspector').scrollWidth<=document.querySelector('.inspector').clientWidth") { value in
                                        guard value as? Bool == true else { print("FAIL: entry overflow"); exit(1) }
                                        self.capture("github-entry") { print("PASS: 1380/1100 UI screenshots and overflow checks"); exit(0) }
                                    }
                                }
                            }
                        }
                    }
                }
            } catch { print("FAIL: \(error)"); exit(1) }
        }
    }
    func run(_ script: String, then: @escaping (Any) -> Void) { web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in do { then(try result.get() as Any) } catch { print("FAIL: \(error)"); exit(1) } } }
    func capture(_ name: String, then: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            self.web.takeSnapshot(with: nil) { image, error in
                guard let tiff = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else { print("FAIL: snapshot \(String(describing: error))"); exit(1) }
                do { try png.write(to: self.output.appendingPathComponent(name + ".png")); then() } catch { print("FAIL: \(error)"); exit(1) }
            }
        }
    }
}
@main enum GitHubSmokeMain { static func main() { let app = NSApplication.shared; let smoke = GitHubSmoke(); app.delegate = smoke; app.setActivationPolicy(.accessory); app.run() } }
