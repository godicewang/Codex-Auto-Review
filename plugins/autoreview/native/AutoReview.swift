import AppKit
import WebKit

func shouldShowCompanion(frontIsCodex: Bool, frontIsCompanion: Bool, companionCameFromCodex: Bool, codexWindowVisible: Bool) -> Bool {
    codexWindowVisible && (frontIsCodex || (frontIsCompanion && companionCameFromCodex))
}

final class ReviewPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    var panel: ReviewPanel!
    var launcher: ReviewPanel!
    var launcherButton: NSButton!
    var web: WKWebView!
    var status: NSStatusItem!
    var allowedOrigin: URL?
    var loading = false
    var collapsed = UserDefaults.standard.bool(forKey:"AutoReviewCollapsed")
    var cameFromCodex = false
    var visibilityTimer: Timer?
    var visibilityStatePath: URL?
    var lastVisibility = ""
    let codexBundleIDs: Set<String> = ["com.openai.codex", "com.openai.Codex"]

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x:0,y:0,width:1200,height:800)
        panel = ReviewPanel(contentRect:NSRect(x:screen.maxX-446,y:screen.minY+30,width:420,height:min(690,screen.height-70)),styleMask:[.titled,.closable,.resizable,.nonactivatingPanel],backing:.buffered,defer:false)
        panel.title = "AutoReview"
        panel.delegate = self
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.minSize = NSSize(width:360,height:420)
        panel.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
        panel.setFrameAutosaveName("AutoReviewPanel")
        let config = WKWebViewConfiguration()
        config.userContentController.add(self,name:"autoreview")
        web = WKWebView(frame:panel.contentView!.bounds,configuration:config)
        web.autoresizingMask = [.width,.height]
        web.navigationDelegate = self
        panel.contentView = web
        launcher = ReviewPanel(contentRect:NSRect(x:screen.maxX-198,y:screen.minY+26,width:172,height:50),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        launcher.level = .floating
        launcher.hidesOnDeactivate = false
        launcher.isReleasedWhenClosed = false
        launcher.isOpaque = false
        launcher.backgroundColor = .clear
        launcher.hasShadow = true
        launcher.isMovableByWindowBackground = true
        launcher.collectionBehavior = [.canJoinAllSpaces,.fullScreenAuxiliary]
        launcher.setFrameAutosaveName("AutoReviewLauncher")
        let backing = NSVisualEffectView(frame:launcher.contentView!.bounds)
        backing.material = .popover
        backing.blendingMode = .behindWindow
        backing.state = .active
        backing.wantsLayer = true
        backing.layer?.cornerRadius = 15
        backing.layer?.masksToBounds = true
        launcherButton = NSButton(title:"◉  AutoReview",target:self,action:#selector(showPanel))
        launcherButton.frame = NSRect(x:8,y:7,width:156,height:36)
        launcherButton.isBordered = false
        launcherButton.font = .systemFont(ofSize:12,weight:.medium)
        launcherButton.contentTintColor = .labelColor
        launcherButton.toolTip = "打开 AutoReview 审计面板；拖动边缘可移动入口"
        backing.addSubview(launcherButton)
        launcher.contentView = backing
        status = NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
        status.button?.title = "◉ AutoReview"
        let menu = NSMenu()
        for (title,action) in [("打开审计面板",#selector(showPanel)),("收起到屏幕小入口",#selector(collapse)),("重新连接本地服务",#selector(reload)),("退出配套窗口（后台审计继续）",#selector(quit))] {
            let item=NSMenuItem(title:title,action:action,keyEquivalent:"");item.target=self;menu.addItem(item)
        }
        status.menu = menu
        let center=NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didHideApplicationNotification, NSWorkspace.didUnhideApplicationNotification, NSWorkspace.didTerminateApplicationNotification, NSWorkspace.activeSpaceDidChangeNotification] {
            center.addObserver(self,selector:#selector(updateVisibility),name:name,object:nil)
        }
        visibilityTimer=Timer.scheduledTimer(timeInterval:0.3,target:self,selector:#selector(updateVisibility),userInfo:nil,repeats:true)
        updateVisibility()
        loadDashboard()
    }
    @objc func updateVisibility() {
        let front=NSWorkspace.shared.frontmostApplication
        let frontIsCodex=codexBundleIDs.contains(front?.bundleIdentifier ?? "")
        let frontIsCompanion=front?.processIdentifier==ProcessInfo.processInfo.processIdentifier
        if frontIsCodex {cameFromCodex=true} else if !frontIsCompanion {cameFromCodex=false}
        let codexPIDs=Set(NSWorkspace.shared.runningApplications.filter{codexBundleIDs.contains($0.bundleIdentifier ?? "") && !$0.isHidden}.map{$0.processIdentifier})
        // Inspect window ownership/geometry only; no window titles, screenshots or accessibility permission.
        let windows=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]] ?? []
        let visible=windows.contains { item in
            guard let pid=item[kCGWindowOwnerPID as String] as? Int32,codexPIDs.contains(pid),
                  let layer=item[kCGWindowLayer as String] as? Int,layer==0,
                  let bounds=item[kCGWindowBounds as String] as? [String:Any],
                  let width=bounds["Width"] as? Double,let height=bounds["Height"] as? Double else{return false}
            return width>=240 && height>=160 && (item[kCGWindowAlpha as String] as? Double ?? 1)>0
        }
        let show=shouldShowCompanion(frontIsCodex:frontIsCodex,frontIsCompanion:frontIsCompanion,companionCameFromCodex:cameFromCodex,codexWindowVisible:visible)
        if !show {panel.orderOut(nil);launcher.orderOut(nil)}
        else if collapsed {panel.orderOut(nil);if !launcher.isVisible{launcher.orderFrontRegardless()}}
        else {launcher.orderOut(nil);if !panel.isVisible{panel.orderFrontRegardless()}}
        let mode=panel.isVisible ? "panel" : launcher.isVisible ? "launcher" : "hidden"
        if let file=visibilityStatePath,mode != lastVisibility {
            lastVisibility=mode
            if let data=try? JSONSerialization.data(withJSONObject:["mode":mode,"updatedAt":Date().timeIntervalSince1970]) {
                try? data.write(to:file,options:.atomic)
                try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
            }
        }
    }
    @objc func showPanel() { collapsed=false;UserDefaults.standard.set(false,forKey:"AutoReviewCollapsed");updateVisibility() }
    @objc func collapse() { collapsed=true;UserDefaults.standard.set(true,forKey:"AutoReviewCollapsed");updateVisibility() }
    @objc func reload() { showPanel();loadDashboard() }
    @objc func quit() { NSApp.terminate(nil) }
    func windowShouldClose(_ sender:NSWindow) -> Bool { if sender === panel {collapse();return false};return true }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool { reload();return true }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender:NSApplication) -> Bool { false }
    func loadDashboard() {
        guard !loading else {return}
        loading = true
        DispatchQueue.global(qos:.userInitiated).async {
            do {
                guard let file=Bundle.main.url(forResource:"bootstrap",withExtension:"json") else {throw NSError(domain:"AutoReview",code:1)}
                let cfg=try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as! [String:String]
                let task=Process(), pipe=Pipe()
                task.executableURL=URL(fileURLWithPath:cfg["node"]!)
                task.arguments=[cfg["cli"]!,"dashboard","--no-open"]
                var env=ProcessInfo.processInfo.environment
                env["PATH"]=cfg["path"]
                env["AUTOREVIEW_CODEX_BIN"]=cfg["codex"]
                env["AUTOREVIEW_HOME"]=cfg["dataDir"]
                task.environment=env;task.standardOutput=pipe;task.standardError=FileHandle.nullDevice
                try task.run()
                let output=pipe.fileHandleForReading.readDataToEndOfFile();task.waitUntilExit()
                let text=String(data:output,encoding:.utf8)?.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""
                guard task.terminationStatus==0, let url=URL(string:text), url.host=="127.0.0.1",url.scheme=="http" else {throw NSError(domain:"AutoReview",code:1)}
                DispatchQueue.main.async {self.loading=false;self.visibilityStatePath=cfg["dataDir"].map{URL(fileURLWithPath:$0).appendingPathComponent("visibility.json")};self.updateVisibility();self.allowedOrigin=url;self.web.load(URLRequest(url:url))}
            } catch {
                DispatchQueue.main.async {self.loading=false;self.web.loadHTMLString("<html><meta charset='utf-8'><body style='font:14px -apple-system;padding:24px'><h3>AutoReview 暂未连接</h3><p>请在顶部菜单栏 AutoReview 选择“重新连接本地服务”，或点击 Codex 顶部 Actions 中的 AutoReview。</p></body></html>",baseURL:nil)}
            }
        }
    }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.host=="127.0.0.1",message.frameInfo.securityOrigin.protocol=="http",message.frameInfo.securityOrigin.port==allowedOrigin?.port,let value=message.body as? [String:Any],let action=value["action"] as? String else{return}
        if action=="collapse" {collapse()}
        if action=="status",let pending=value["pending"] as? Int,pending>=0,pending<=1000,let reviewing=value["reviewing"] as? Bool {
            launcherButton.title = pending>0 ? "◉  AutoReview · \(pending)" : reviewing ? "◌  AutoReview · 审计中" : "◉  AutoReview"
        }
    }
    func webView(_ webView:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        guard let url=action.request.url else{decisionHandler(.cancel);return}
        if url.scheme=="about" || (url.scheme=="http" && url.host=="127.0.0.1" && url.port==allowedOrigin?.port){decisionHandler(.allow)}else{decisionHandler(.cancel)}
    }
}
if CommandLine.arguments.contains("--test-visibility") {
    for front in 0...2 { for visible in [false,true] { for previous in [false,true] {
        let actual=shouldShowCompanion(frontIsCodex:front==0,frontIsCompanion:front==1,companionCameFromCodex:previous,codexWindowVisible:visible)
        precondition(actual == (visible && (front==0 || (front==1 && previous))))
    } } }
    print("PASS: Codex foreground, other app, companion interaction, hidden/minimized/other Space visibility states.")
    exit(0)
}
let app=NSApplication.shared
let delegate=AppDelegate()
app.delegate=delegate
app.run()
