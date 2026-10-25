import AppKit
import WebKit

// 使用独立剪贴板，测试不会覆盖用户刚截取的图片，也不写入用户工程。
final class TextPasteTarget: NSTextView {
    var receivedPaste = false
    override func paste(_ sender: Any?) { receivedPaste = true }
}

final class ClipboardSmoke: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let workshop = AppDelegate()
    let board = NSPasteboard.withUniqueName()
    let textOnly = CommandLine.arguments.contains("--text-only")
    let assistantOnly = CommandLine.arguments.contains("--assistant-only")
    var png = Data()
    var tiff = Data()
    var assistantPasteRequests = 0
    let waitForIdle = """
    async function waitFor(test) {
      const deadline=Date.now()+60000;
      while(!test()) {
        if(Date.now()>deadline)throw Error('等待粘贴导入超时：'+document.getElementById('status').textContent+'；助手：'+document.getElementById('assistantMessages').textContent);
        await new Promise(resolve=>setTimeout(resolve,50));
      }
    }
    function checkSplit() {
      if(\(CommandLine.arguments.contains("--text-only") ? "true" : "false")){checkLabels();return;}
      const project=Workshop.getState(),axis=project.options.mirrorAxis;
      if(project.keys.length!==42||!Number.isFinite(axis))throw Error('未检测到42键分体：'+JSON.stringify({api:typeof Recognition.alignSplit,axis,keys:project.keys,status:document.getElementById('status').textContent}));
      const left=project.keys.filter(k=>k.x<axis),right=project.keys.filter(k=>k.x>axis),used=new Set();
      if(left.length!==21||right.length!==21)throw Error('左右键数');
      for(const a of left){
        const b=right.find(b=>Math.abs(a.x+b.x-2*axis)<.000003&&a.y===b.y&&a.angle===-b.angle);
        if(!b||used.has(b.id))throw Error('左右对应键未同水平或未镜像');
        used.add(b.id);
      }
      if(!document.getElementById('status').textContent.includes('21 对'))throw Error('缺少分体识别提示');
      checkLabels();
    }
    function checkLabels() {
      const labels=Workshop.getState().keys.map(k=>k.label);
      const expected=['Tab','Q','W','E','R','T','Ctrl','A','S','D','F','G','Shift','Z','X','C','V','B','GUI','Lower','Space','Y','U','I','O','P','Bksp','H','J','K','L',';',"'",'N','M',',','.','/','Esc','Enter','Raise','Alt'];
      for(const l of expected)if(!labels.includes(l))throw Error('未识别键帽文字 '+l+'：'+labels.join(' '));
      if(labels.length!==expected.length||new Set(labels).size!==labels.length)throw Error('键帽文字数量或重复：'+labels.join(' '));
      if(!document.getElementById('status').textContent.includes('个键帽文字'))throw Error('缺少键帽文字提示');
    }
    """

    func fail(_ message: String) -> Never {
        board.releaseGlobally()
        print("FAIL: \(message)"); exit(1)
    }
    func check(_ value: Bool, _ message: String) {
        if !value { fail(message) }
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let fixture = URL(fileURLWithPath: CommandLine.arguments[2])
            png = try Data(contentsOf: fixture)
            tiff = NSImage(data: png)!.tiffRepresentation!
            for (type, data) in [(NSPasteboard.PasteboardType.png, png), (.tiff, tiff)] {
                board.clearContents(); board.setData(data, forType: type)
                guard let source = try ImageAnalyzer.clipboardSource(board) else { fail("未读取 \(type)") }
                let (image, _) = try ImageAnalyzer.load(source)
                check(image.width > 100 && image.height > 100, "图片解码")
            }
            board.clearContents(); board.writeObjects([fixture as NSURL])
            guard let source = try ImageAnalyzer.clipboardSource(board), case .file = source else { fail("访达图片文件未识别") }
            _ = try ImageAnalyzer.load(source)
            board.clearContents(); board.setString("普通文字", forType: .string)
            check(try ImageAnalyzer.clipboardSource(board) == nil, "文字不应识别为图片")
            board.clearContents()
            check(try ImageAnalyzer.clipboardSource(board) == nil, "空剪贴板不应识别为图片")
        } catch { fail(error.localizedDescription) }

        workshop.pasteboard = board
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "workshop")
        workshop.web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1380, height: 900), configuration: config)
        workshop.web.navigationDelegate = self
        workshop.window = NSWindow(contentRect: workshop.web.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        workshop.window.contentView = workshop.web
        workshop.window.isReleasedWhenClosed = false
        workshop.makeApplicationMenu()
        workshop.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        board.clearContents(); board.setData(png, forType: .png)
        if !assistantOnly {
            workshop.pasteClipboard(nil)
            check(workshop.pendingImageImport != nil, "页面加载前的粘贴没有排队")
        }
        let root = URL(fileURLWithPath: CommandLine.arguments[1])
        workshop.web.loadFileURL(root.appendingPathComponent("index.html"), allowingReadAccessTo: root)
        // 全流程连续执行多轮本机识别；各步骤仍独立受 60 秒等待限制。
        DispatchQueue.main.asyncAfter(deadline: .now()+600) { self.fail("测试超时") }
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let action = (message.body as? [String: Any])?["action"] as? String
        if action == "autosave" { return }
        if ["assistantState", "assistantSettings", "assistantRequest", "assistantCancel"].contains(action ?? "") { return }
        if let body = message.body as? [String: Any], action == "assistantWorkflow", body["kind"] as? String == "image", body["operation"] as? String == "paste" { assistantPasteRequests += 1 }
        if let body = message.body as? [String: Any], action == "assistantWorkflow" {
            print("本机截图步骤：\(body["kind"] as? String ?? "")")
        }
        if action == "readLabels", let body = message.body as? [String: Any], body["data"] != nil,
           let path = ProcessInfo.processInfo.environment["LEGEND_REGIONS"], let regions = body["regions"],
           let data = try? JSONSerialization.data(withJSONObject: regions, options: [.prettyPrinted, .sortedKeys]) {
            try? data.write(to: URL(fileURLWithPath: path))
        }
        if action == "ready" {
            // 不恢复或归档用户真实工程，仍验证页面加载前排队的粘贴。
            workshop.webReady = true
            if let pending = workshop.pendingImageImport {
                workshop.pendingImageImport = nil
                workshop.importImage(pending.source, name: pending.name)
            }
            return
        }
        workshop.userContentController(controller, didReceive: message)
    }
    func run(_ script: String, _ completion: @escaping (Any) -> Void) {
        workshop.web.callAsyncJavaScript(waitForIdle + script, arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success(let value): completion(value)
            case .failure(let error): self.fail("\(error.localizedDescription) \((error as NSError).userInfo)")
            }
        }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if assistantOnly {
            run("""
            Workshop.loadText(JSON.stringify({version:1,name:'聊天图片入口测试',keys:[KB.key({label:'人工键',x:0,y:0})],options:{},features:[]}));
            await waitFor(()=>window.WorkshopAssistant && document.readyState==='complete');
            return true;
            """) { _ in self.testAssistantPaste() }
            return
        }
        print("检查：启动排队 PNG 粘贴")
        run("""
        await waitFor(()=>Workshop.getState().image && document.getElementById('busy').hidden);
        if(Workshop.getState().keys.length!==42)throw Error('PNG 识别键数');
        checkSplit();
        document.getElementById('canvas').focus();
        return Workshop.getState().keys[0].id;
        """) { value in
            print("检查：TIFF ⌘V 粘贴")
            let oldID = value as! String
            self.board.clearContents(); self.board.setData(self.tiff, forType: .tiff)
            let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command,
                timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: self.workshop.window.windowNumber,
                context: nil, characters: "v", charactersIgnoringModifiers: "v", isARepeat: false, keyCode: 9)!
            self.check(NSApp.mainMenu!.performKeyEquivalent(with: event), "⌘V 菜单没有处理粘贴")
            self.run("""
            await waitFor(()=>Workshop.getState().keys[0]?.id!=='\(oldID)' && document.getElementById('busy').hidden);
            if(Workshop.getState().keys.length!==42)throw Error('TIFF 识别键数');
            checkSplit();
            return Workshop.getState().keys[0].id;
            """) { value in self.testButton(oldID: value as! String) }
        }
    }
    func testButton(oldID: String) {
        print("检查：PNG 按钮粘贴")
        board.clearContents(); board.setData(png, forType: .png)
        run("""
        document.getElementById('pasteImage').click();
        await waitFor(()=>Workshop.getState().keys[0]?.id!=='\(oldID)' && document.getElementById('busy').hidden);
        if(Workshop.getState().keys.length!==42)throw Error('按钮粘贴识别键数');
        checkSplit();
        return Workshop.getState().keys[0].id;
        """) { _ in self.testSymmetry() }
    }
    func testSymmetry() {
        print("检查：对称开关、重新识别和撤销重做")
        run("""
        const toggle=document.getElementById('recognitionSymmetry'),before=JSON.stringify(Workshop.getState());
        if(!toggle.checked)throw Error('分体自动校正默认未开启');
        toggle.click();
        if(JSON.stringify(Workshop.getState())!==before)throw Error('切换选项不应直接修改工程');
        let oldID=Workshop.getState().keys[0].id;
        document.getElementById('recognize').click();
        await waitFor(()=>Workshop.getState().keys[0]?.id!==oldID && document.getElementById('busy').hidden);
        const raw=Workshop.getState();
        if(raw.keys.length!==42||raw.options.mirrorAxis!==null)throw Error('关闭自动校正未保留原识别');
        document.getElementById('undo').click();
        if(JSON.stringify(Workshop.getState())!==before)throw Error('识别撤销没有恢复工程');
        document.getElementById('redo').click();
        if(JSON.stringify(Workshop.getState())!==JSON.stringify(raw))throw Error('识别重做');
        const geometry=p=>p.keys.map(({id,...key})=>key);
        Workshop.loadText(JSON.stringify(raw));
        if(JSON.stringify(geometry(Workshop.getState()))!==JSON.stringify(geometry(raw))||Workshop.getState().options.mirrorAxis!==null)throw Error('打开旧工程自动改动了配列');
        toggle.click();oldID=Workshop.getState().keys[0].id;
        document.getElementById('recognize').click();
        await waitFor(()=>Workshop.getState().keys[0]?.id!==oldID && document.getElementById('busy').hidden);
        checkSplit();
        return Workshop.getState().keys[0].id;
        """) { _ in self.testReadLabels() }
    }
    func testReadLabels() {
        print("检查：按当前键位补读全部文字")
        run("""
        const project=Workshop.getState();
        window.clipboardOriginalProject=project;
        Workshop.loadText(JSON.stringify({...project,keys:project.keys.map((k,i)=>({...k,label:i===0?'自定义':String(i+1),labelSource:i===0?'manual':'placeholder'}))}),'编号工程',{archive:false});
        const geometry=()=>JSON.stringify(Workshop.getState().keys.map(({id,label,labelSource,...k})=>k)),shape=geometry(),before=Workshop.getState().keys.map(k=>k.label).join(' ');
        document.getElementById('readKeyLabels').click();
        if(document.getElementById('busy').hidden)throw Error('识别键帽文字未显示忙碌');
        await waitFor(()=>document.getElementById('busy').hidden);
        if(geometry()!==shape)throw Error('识别键帽文字改动了键位');
        if(Workshop.getState().keys[0].label!=='自定义')throw Error('覆盖了已有键帽文字');
        if(!document.getElementById('status').textContent.includes('⌘Z'))throw Error('缺少撤销提示');
        const after=Workshop.getState().keys,labels=after.map(k=>k.label).join(' ');
        for(let i=1;i<after.length;i++)if(after[i].label!==project.keys[i].label)throw Error('按当前键位补读不一致：'+project.keys[i].label+' → '+after[i].label);
        document.getElementById('undo').click();
        if(Workshop.getState().keys.map(k=>k.label).join(' ')!==before)throw Error('识别键帽文字撤销');
        document.getElementById('redo').click();
        if(Workshop.getState().keys.map(k=>k.label).join(' ')!==labels)throw Error('识别键帽文字重做');
        return Workshop.getState().keys[0].id;
        """) { _ in self.testFirmware() }
    }
    func testFirmware() {
        print("检查：截图文字自动进入第0层、Lower/Raise、补读保留手动动作")
        run("""
        Workshop.loadText(JSON.stringify(window.clipboardOriginalProject));
        const set=(id,value)=>{const el=document.getElementById(id);el.value=String(value);el.dispatchEvent(new Event('change'));};
        set('firmwareTarget','qmk');
        if(state.firmware.layers.length!==3||state.keys.some(k=>k.fw.bindings[0].t==='none'))throw Error('识别文字未自动带入第0层');
        for(const [label,layer] of [['Lower',1],['Raise',2]])if(state.keys.find(k=>k.label===label).fw.bindings[0].l!==layer)throw Error(label+'层错误');
        const q=state.keys.find(k=>k.label==='Q'),a=state.keys.find(k=>k.label==='A');
        selected=new Set([q.id]);inspector();set('bindingType','none');document.getElementById('applyBinding').click();
        selected=new Set([a.id]);inspector();set('bindingType','kc');set('bindingKey','C');document.getElementById('applyBinding').click();
        for(const [i,k] of state.keys.entries())if(['Q','A','Lower','Raise','Space'].includes(k.label)){k.label=String(i+1);k.labelSource='placeholder';if(!k.fw.baseBindingManual)k.fw.bindings[0]={t:'none'};}
        changed();const before=JSON.stringify(Workshop.getState());
        document.getElementById('readKeyLabels').click();await waitFor(()=>document.getElementById('busy').hidden);
        checkLabels();
        if(q.fw.bindings[0].t!=='none'||a.fw.bindings[0].k!=='C')throw Error('覆盖了用户手动动作');
        if(state.keys.filter(k=>!k.fw.baseBindingManual).some(k=>k.fw.bindings[0].t==='none'))throw Error('固件启用后补读未带入第0层');
        const after=JSON.stringify(Workshop.getState());undo();if(JSON.stringify(Workshop.getState())!==before)throw Error('文字和键码未一起撤销');redo();if(JSON.stringify(Workshop.getState())!==after)throw Error('文字和键码未一起重做');
        const saved=Workshop.getState();Workshop.loadText(JSON.stringify(saved));
        if(state.keys.find(k=>k.label==='Q').fw.bindings[0].t!=='none'||state.keys.find(k=>k.label==='A').fw.bindings[0].k!=='C')throw Error('手动动作持久化失败');
        return Workshop.getState().keys[0].id;
        """) { _ in self.testAssistantPaste() }
    }
    func testAssistantPaste() {
        print("检查：聊天输入框原生 ⌘V 先生成识别草稿")
        board.clearContents(); board.setData(png, forType: .png)
        workshop.window.makeKeyAndOrderFront(nil)
        check(workshop.window.makeFirstResponder(workshop.web), "聊天 WebView 焦点")
        run("""
        window.beforeAssistantPaste=JSON.stringify(Workshop.getState());
        if(document.getElementById('assistantDrawer').hidden)document.getElementById('assistantToggle').click();
        document.getElementById('assistantInput').focus();
        if(document.activeElement!==document.getElementById('assistantInput'))throw Error('聊天输入框未获得焦点');
        return true;
        """) { _ in
            self.workshop.pasteClipboard(nil)
            self.run("""
            await waitFor(()=>document.querySelector('.assistant-proposal[data-state="pending"]'));
            if(JSON.stringify(Workshop.getState())!==window.beforeAssistantPaste)throw Error('聊天粘贴未经确认改动了工程');
            const card=document.querySelector('.assistant-proposal[data-state="pending"]');
            const apply=[...card.querySelectorAll('button')].find(b=>b.textContent==='应用提案');
            if(apply.disabled)throw Error('聊天识别草稿不可应用');
            apply.click();
            if(card.dataset.state!=='applied'||Workshop.getState().keys.length!==42)throw Error('聊天识别未应用42键');
            const labels=Workshop.getState().keys.map(k=>k.label);
            for(const label of ['Tab','Q','Space','Enter','Raise'])if(!labels.includes(label))throw Error('聊天粘贴未补读文字：'+label);
            [...card.querySelectorAll('button')].find(b=>b.textContent==='撤销本次修改').click();
            if(JSON.stringify(Workshop.getState())!==window.beforeAssistantPaste)throw Error('聊天粘贴不能一次完整撤销');
            document.getElementById('assistantClose').click();
            return Workshop.getState().keys[0].id;
            """) { value in
                self.check(self.assistantPasteRequests == 1, "原生菜单未通过受控聊天粘贴入口")
                self.testText(oldID: value as! String)
            }
        }
    }
    func testText(oldID: String) {
        board.clearContents(); board.setString("普通文字", forType: .string)
        let target = TextPasteTarget(frame: NSRect(x: 0, y: 0, width: 100, height: 30))
        workshop.window.contentView!.addSubview(target)
        NSApp.activate(ignoringOtherApps: true)
        workshop.window.makeKeyAndOrderFront(nil)
        check(workshop.window.makeFirstResponder(target), "输入框焦点")
        workshop.pasteClipboard(nil)
        check(target.receivedPaste, "普通文字没有交回标准粘贴")
        target.removeFromSuperview()
        run("""
        document.getElementById('pasteImage').click();
        await waitFor(()=>document.getElementById('status').textContent.includes('剪贴板里没有图片'));
        if(Workshop.getState().keys[0].id!=='\(oldID)')throw Error('无图片时改动了配列');
        if(!document.getElementById('busy').hidden)throw Error('无图片时仍显示忙碌');
        return true;
        """) { _ in
            self.board.releaseGlobally()
            let geometry = self.textOnly ? "42键（文字专项，不检查分体几何）" : "42键及21对水平镜像"
            if self.assistantOnly {
                print("PASS: 聊天输入框原生⌘V使用隔离剪贴板，本机识别42键和文字，应用前不改工程，确认应用及一次完整撤销，普通文字粘贴与无图片提示；未调用模型、账号或钥匙串。")
            } else {
                print("PASS: PNG/TIFF/访达图片文件、启动即粘贴、⌘V、按钮自动识别\(geometry)、逐键键帽文字、按当前键位补读文字、自动带入第0层、Lower/Raise、手动动作及无功能保留、识别开关、撤销重做、旧工程恢复、聊天原生⌘V草稿预览应用与一次撤销、文字粘贴与无图片提示。")
            }
            exit(0)
        }
    }
}

@main
enum ClipboardSmokeMain {
    static func main() {
        let app = NSApplication.shared
        let smoke = ClipboardSmoke(); app.delegate = smoke
        app.setActivationPolicy(.accessory); app.run()
    }
}
